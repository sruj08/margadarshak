// Package clock is the case clock (MD-125/126/129/130, F-09, BACKEND §7): the job steps the
// Render Workflows task case_clock_sweep calls (clock.plan_pages, clock.fire_batch), the inline
// sweep, and the messaging rules (≤ 1 nudge a day, quiet hours 21:00-08:00 IST, STOP, fallback
// channels). Timers are TimelineEvent rows; firing one is idempotent per key "caseId:type:dueOn"
// and each notification per "{key}:{channel}", so a retried batch, a retried sweep or a second
// sweep on the same day sends nothing twice. n8n only delivers (D-16).
package clock

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	adnotify "github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
	"github.com/sruj08/margadarshak/services/api/internal/cases"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/journey"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/rules"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// Quiet hours (MD-130): no nudge between 21:00 and 08:00 IST. The account holder's own wider
// quiet_hours are honoured too.
const (
	QuietStartHour = 21
	QuietEndHour   = 8
	MaxPageSize    = 250
	DefaultPage    = 200
)

// ErrRetryable means a batch had a retryable delivery failure after committing the rest.
var ErrRetryable = errors.New("clock: retryable delivery failure")

// Service runs the case clock.
type Service struct {
	DB       *store.DB
	Vault    *privacy.Vault
	Clock    servertime.Clock
	Cases    *cases.Service
	Accounts *accounts.Service
	N8n      *adnotify.N8n
	// Email delivers the e-mail channel (SMTP, or the console in dev); WebPush the web push
	// channel (VAPID sender not built yet: messages are recorded queued).
	Email      ports.NotificationPort
	WebPush    ports.NotificationPort
	Log        *slog.Logger
	WebBaseURL string
}

func (s *Service) now() time.Time { return s.Clock.Now() }

// InQuietHours reports whether t falls in the product quiet window or the personal one
// ("HH:MM" start/end, IST).
func InQuietHours(t time.Time, personal map[string]string) bool {
	in := t.In(servertime.IST)
	h := in.Hour()
	if h >= QuietStartHour || h < QuietEndHour {
		return true
	}
	start, end := personal["start"], personal["end"]
	if start == "" || end == "" {
		return false
	}
	cur := in.Format("15:04")
	if start <= end {
		return cur >= start && cur < end
	}
	return cur >= start || cur < end
}

// serverDate clamps a caller's as_of to the server's IST date: a later date is ignored (EC-15),
// an earlier one is kept (a sweep that started before midnight finishes on its own date).
func (s *Service) serverDate(arg any) rules.Date {
	today := rules.TodayIST(s.now())
	if v, ok := arg.(string); ok && len(v) >= 10 {
		if d, err := rules.ParseDate(v[:10]); err == nil && d.Before(today) {
			return d
		}
	}
	return today
}

// ---- clock.plan_pages ------------------------------------------------------------------------

func encodeCursor(due string, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(due + "|" + id.String()))
}

func decodeCursor(c string) (string, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return "", uuid.Nil, err
	}
	due, idStr, ok := strings.Cut(string(raw), "|")
	if !ok {
		return "", uuid.Nil, errors.New("bad cursor")
	}
	id, err := uuid.Parse(idStr)
	if _, perr := rules.ParseDate(due); perr != nil || err != nil {
		return "", uuid.Nil, errors.New("bad cursor")
	}
	return due, id, nil
}

func stringList(v any) []string {
	var out []string
	if l, ok := v.([]any); ok {
		for _, x := range l {
			if s, ok := x.(string); ok {
				out = append(out, strings.ToUpper(s))
			}
		}
	}
	return out
}

func intArg(v any, def int) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return def
}

// PlanPages is the clock.plan_pages step: one keyset page of due TimelineEvents (server date).
func (s *Service) PlanPages(ctx context.Context, args map[string]any) (map[string]any, error) {
	asOf := s.serverDate(args["as_of"])
	limit := intArg(args["limit"], DefaultPage)
	if limit < 1 || limit > MaxPageSize {
		limit = DefaultPage
	}
	var afterDue string
	afterID := uuid.Nil
	if c, ok := args["after"].(string); ok && c != "" {
		d, id, err := decodeCursor(c)
		if err != nil {
			return nil, &StepInputError{Field: "after", Code: "invalid_cursor"}
		}
		afterDue, afterID = d, id
	}
	tenants := stringList(args["tenants"])
	var refs []store.DueRef
	err := s.DB.System(ctx, func(tx pgx.Tx) error {
		var err error
		refs, err = store.DueTimelinePage(ctx, tx, asOf.String(), tenants, afterDue, afterID, limit)
		return err
	})
	if err != nil {
		return nil, err
	}
	events := make([]any, 0, len(refs))
	for _, r := range refs {
		events = append(events, map[string]any{"case_id": ids.Encode(ids.Case, r.CaseID), "type": r.Code, "due_on": r.DueOn})
	}
	var next any
	if len(refs) == limit {
		last := refs[len(refs)-1]
		next = encodeCursor(last.DueOn, last.ID)
	}
	return map[string]any{"as_of": asOf.String(), "events": events, "next_cursor": next}, nil
}

// StepInputError is a 422 for a step argument.
type StepInputError struct{ Field, Code string }

func (e *StepInputError) Error() string { return "clock: " + e.Field + " " + e.Code }

// ---- clock.fire_batch ------------------------------------------------------------------------

var keyRe = regexp.MustCompile(`^cas_[0-9A-Z]{26}:[A-Z0-9_]{3,40}:\d{4}-\d{2}-\d{2}$`)

// BatchResult counts what a batch did. The first four fields are the Workflows contract.
type BatchResult struct {
	Fired              int `json:"fired"`
	SkippedOptOut      int `json:"skipped_opt_out"`
	Failed             int `json:"failed"`
	AlreadyFired       int `json:"already_fired"`
	DeferredQuietHours int `json:"deferred_quiet_hours"`
	DeferredDailyCap   int `json:"deferred_daily_cap"`
	SkippedCancelled   int `json:"skipped_cancelled"`
	NotDue             int `json:"not_due"`
}

// Map renders the result for the step response.
func (b BatchResult) Map() map[string]any {
	return map[string]any{"fired": b.Fired, "skipped_opt_out": b.SkippedOptOut, "failed": b.Failed, "already_fired": b.AlreadyFired,
		"deferred_quiet_hours": b.DeferredQuietHours, "deferred_daily_cap": b.DeferredDailyCap, "skipped_cancelled": b.SkippedCancelled, "not_due": b.NotDue}
}

// pending is a notification committed in a batch and waiting for delivery.
type pending struct {
	tenant string
	n      *store.Notification
	to     string
	lang   string
	vars   map[string]string
}

// FireBatch is the clock.fire_batch step. Events are taken most urgent first so the daily cap
// keeps the deadline; each fires at most once (row lock + status + notification key).
func (s *Service) FireBatch(ctx context.Context, args map[string]any) (BatchResult, error) {
	var res BatchResult
	asOf := s.serverDate(args["as_of"])
	var keys []string
	if l, ok := args["event_keys"].([]any); ok {
		for _, x := range l {
			if k, ok := x.(string); ok {
				keys = append(keys, k)
			}
		}
	}
	if len(keys) > MaxPageSize {
		return res, &StepInputError{Field: "event_keys", Code: "too_many"}
	}
	sort.SliceStable(keys, func(i, j int) bool {
		ci, cj := codeOf(keys[i]), codeOf(keys[j])
		if journey.Priority(ci) != journey.Priority(cj) {
			return journey.Priority(ci) < journey.Priority(cj)
		}
		return keys[i] < keys[j]
	})
	var outbox []pending
	for _, key := range keys {
		if !keyRe.MatchString(key) {
			res.Failed++
			continue
		}
		p, outcome, err := s.fireOne(ctx, key, asOf)
		if err != nil {
			s.Log.WarnContext(ctx, "clock event failed", "key", key, "err", err)
			res.Failed++
			continue
		}
		switch outcome {
		case "fired":
			outbox = append(outbox, p...)
		case "redeliver":
			outbox = append(outbox, p...)
		case "already":
			res.AlreadyFired++
		case "opt_out":
			res.SkippedOptOut++
		case "quiet":
			res.DeferredQuietHours++
		case "cap":
			res.DeferredDailyCap++
		case "cancelled":
			res.SkippedCancelled++
		case "not_due":
			res.NotDue++
		case "unknown":
			res.Failed++
		}
	}
	delivered, failed, retryable := s.deliver(ctx, "clock_batch", fmt.Sprintf("clock:%s:%v", asOf.String(), args["page"]), outbox)
	res.Fired += delivered
	res.Failed += failed
	if retryable {
		return res, ErrRetryable
	}
	return res, nil
}

func codeOf(key string) string {
	parts := strings.Split(key, ":")
	if len(parts) == 3 {
		return parts[1]
	}
	return ""
}

// fireOne handles one event key. It returns the notifications to deliver and an outcome.
func (s *Service) fireOne(ctx context.Context, key string, asOf rules.Date) ([]pending, string, error) {
	var row *store.TimelineEvent
	if err := s.DB.System(ctx, func(tx pgx.Tx) error {
		var err error
		row, err = store.TimelineByKey(ctx, tx, key)
		return err
	}); errors.Is(err, store.ErrNotFound) {
		return nil, "unknown", nil
	} else if err != nil {
		return nil, "", err
	}
	switch row.Status {
	case "sent":
		p, err := s.undelivered(ctx, row)
		if err != nil || len(p) == 0 {
			return nil, "already", err
		}
		return p, "redeliver", nil
	case "done":
		return nil, "already", nil
	case "cancelled", "superseded":
		return nil, "cancelled", nil
	}
	if row.DueOn == nil {
		return nil, "unknown", nil
	}
	due, err := rules.ParseDate(*row.DueOn)
	if err != nil {
		return nil, "unknown", nil
	}
	if due.After(asOf) {
		return nil, "not_due", nil
	}
	// Clock transitions (day-30 unlock, LL expiry, renewal window) are applied first: the case is
	// settled against the server date before the message about it goes out.
	if _, ok := journey.ClockEvent(row.Code); ok && s.Cases != nil {
		if err := s.Cases.Rebuild(ctx, row.TenantID, row.CaseID); err != nil && !errors.Is(err, cases.ErrParentConsent) && !errors.Is(err, store.ErrNotFound) {
			return nil, "", err
		}
	}
	now := s.now()
	today := rules.TodayIST(now).String()
	var out []pending
	outcome := ""
	err = s.DB.Tenant(ctx, row.TenantID, func(tx pgx.Tx) error {
		cur, err := store.LockTimelineByKey(ctx, tx, key)
		if err != nil {
			return err
		}
		if cur.Status != "scheduled" {
			outcome = "already"
			if cur.Status == "cancelled" || cur.Status == "superseded" {
				outcome = "cancelled"
			}
			return nil
		}
		c, err := store.GetCaseAny(ctx, tx, cur.CaseID)
		if err != nil {
			return err
		}
		app, err := store.GetApplicant(ctx, tx, c.ApplicantID)
		if err != nil {
			return err
		}
		// EC-26: a deleted case or account never gets a message.
		if c.DeletedAt != nil || app.DeletedAt != nil {
			outcome = "cancelled"
			return store.SetTimelineStatus(ctx, tx, cur.ID, "cancelled")
		}
		if c.FamilyMemberID != nil {
			if err := accounts.RequireMemberAllowed(ctx, tx, c.ApplicantID, *c.FamilyMemberID); err != nil {
				outcome = "opt_out" // no processing of a minor's case without parental consent
				return nil
			}
		}
		if InQuietHours(now, app.QuietHours) {
			outcome = "quiet"
			return nil
		}
		// One nudge per applicant per IST day (MD-130); the unique index enforces it too.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('nudge:' || $1::text))`, app.ID); err != nil {
			return err
		}
		sent, err := store.NudgeSentOn(ctx, tx, app.ID, today)
		if err != nil {
			return err
		}
		if sent {
			outcome = "cap"
			return nil
		}
		chans, err := s.channels(ctx, tx, c.TenantID, app.ID)
		if err != nil {
			return err
		}
		if len(chans) == 0 {
			outcome = "opt_out"
			return store.SetTimelineStatus(ctx, tx, cur.ID, "done")
		}
		ch := chans[0]
		vars := s.milestoneVars(cur, c)
		stored := map[string]any{}
		for k, v := range vars {
			stored[k] = v
		}
		day := today
		n := &store.Notification{ID: ids.New(), TenantID: c.TenantID, ApplicantID: &app.ID, ContactID: ch.contactID, TimelineEventID: &cur.ID,
			Channel: ch.channel, TemplateID: journey.TemplateID(cur.Code), TemplateVars: stored, Status: ports.DeliveryQueued,
			IdempotencyKey: key + ":" + ch.channel, Kind: "nudge", NudgeDay: &day}
		created, err := store.InsertNotification(ctx, tx, n)
		if err != nil {
			return err
		}
		if err := store.SetTimelineStatus(ctx, tx, cur.ID, "sent"); err != nil {
			return err
		}
		if !created {
			outcome = "already"
			return nil
		}
		outcome = "fired"
		out = append(out, pending{tenant: c.TenantID, n: n, to: ch.to, lang: app.Language, vars: vars})
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	return out, outcome, nil
}

// undelivered returns the notifications of a fired event that never left (queued, or failed
// with a retryable error), so a retried batch delivers them.
func (s *Service) undelivered(ctx context.Context, row *store.TimelineEvent) ([]pending, error) {
	var out []pending
	err := s.DB.Tenant(ctx, row.TenantID, func(tx pgx.Tx) error {
		list, err := store.NotificationsForTimelineEvent(ctx, tx, row.ID)
		if err != nil {
			return err
		}
		for _, n := range list {
			retryable := n.Status == ports.DeliveryFailed && n.ErrorCode != nil &&
				(*n.ErrorCode == string(ports.KindUnavailable) || *n.ErrorCode == string(ports.KindTimeout))
			if n.Kind != "nudge" || (n.Status != ports.DeliveryQueued && !retryable) {
				continue
			}
			if n.ApplicantID == nil {
				continue
			}
			app, err := store.GetApplicant(ctx, tx, *n.ApplicantID)
			if err != nil || app.DeletedAt != nil {
				continue
			}
			to := ""
			if n.ContactID != nil {
				to, _ = s.contactValue(ctx, tx, row.TenantID, *n.ContactID)
			}
			vars := map[string]string{}
			for k, v := range n.TemplateVars {
				vars[k] = fmt.Sprint(v)
			}
			out = append(out, pending{tenant: row.TenantID, n: n, to: to, lang: app.Language, vars: vars})
		}
		return nil
	})
	return out, err
}

func (s *Service) milestoneVars(e *store.TimelineEvent, c *store.Case) map[string]string {
	v := map[string]string{"milestone": e.Code, "link": strings.TrimRight(s.WebBaseURL, "/") + "/case"}
	if e.DueOn != nil {
		v["due_on"] = *e.DueOn
	}
	if d := c.KeyDates["ll_expires_on"]; d != "" {
		v["ll_expires_on"] = d
	}
	if d := c.KeyDates["slot_date"]; d != "" && e.Code == journey.MTestEve {
		v["test_date"] = d
	}
	if d := c.KeyDates["dl_valid_to"]; d != "" {
		v["dl_valid_to"] = d
	}
	return v
}

// ---- Inline sweep (JobRunner task case_clock_sweep) ------------------------------------------

// Sweep runs the same steps as the TypeScript task: plan pages, then fire each page.
func (s *Service) Sweep(ctx context.Context, args map[string]any) (map[string]any, error) {
	dry, _ := args["dry_run"].(bool)
	sum := BatchResult{}
	pages, due := 0, 0
	var cursor any
	asOf := s.serverDate(args["as_of"]).String()
	for pages < 5000 {
		page, err := s.PlanPages(ctx, map[string]any{"tenants": args["tenants"], "as_of": asOf, "after": cursor, "limit": float64(DefaultPage)})
		if err != nil {
			return nil, err
		}
		evs, _ := page["events"].([]any)
		var keys []any
		for _, e := range evs {
			m := e.(map[string]any)
			keys = append(keys, fmt.Sprintf("%s:%s:%s", m["case_id"], m["type"], m["due_on"]))
		}
		due += len(keys)
		if !dry && len(keys) > 0 {
			r, err := s.FireBatch(ctx, map[string]any{"as_of": asOf, "page": float64(pages), "event_keys": keys})
			if err != nil && !errors.Is(err, ErrRetryable) {
				return nil, err
			}
			sum.Fired += r.Fired
			sum.SkippedOptOut += r.SkippedOptOut
			sum.Failed += r.Failed
			sum.AlreadyFired += r.AlreadyFired
			sum.DeferredQuietHours += r.DeferredQuietHours
			sum.DeferredDailyCap += r.DeferredDailyCap
			sum.SkippedCancelled += r.SkippedCancelled
			sum.NotDue += r.NotDue
		}
		pages++
		cursor = page["next_cursor"]
		if cursor == nil {
			break
		}
	}
	out := sum.Map()
	out["as_of"], out["pages"], out["due"], out["dry_run"], out["sweep_id"] = asOf, pages, due, dry, args["sweep_id"]
	return out, nil
}

// blindHex renders a blind index for logs-free comparisons.
func blindHex(b []byte) string { return hex.EncodeToString(b) }
