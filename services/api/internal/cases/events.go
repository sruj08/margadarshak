package cases

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/audit"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/journey"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/rulekit"
	"github.com/sruj08/margadarshak/services/api/internal/rules"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/tenant"
	"github.com/sruj08/margadarshak/services/api/internal/wire"
)

// actor is who causes a change (event store actor_kind, audit actor).
type actor struct {
	kind    string // applicant | helper | system | adapter
	id      *uuid.UUID
	subject string
	scope   string
}

var systemActor = actor{kind: "system", subject: "system:clock", scope: "system"}

// EventInput is the API-15 input (and the internal shape of existing LL onboarding).
type EventInput struct {
	Type          string
	OccurredOn    time.Time // IST date
	Classes       []string
	ClassCode     string
	Test          string
	OfficeID      string
	SlotDate      *time.Time
	ReasonCodes   []string
	NumberLast4   string
	ReceiptNumber string
	ValidTo       *time.Time
	RemedialAck   bool
}

// EventResult is the API-15 result.
type EventResult struct {
	Seq        int
	Type       string
	OccurredOn string
	RecordedAt time.Time
	View       *View
	Scheduled  []string
	Cancelled  []string
	Warnings   []wire.Blocker
	Replay     bool
}

func date(t time.Time) rules.Date { return rules.DateFromYMD(t.Year(), int(t.Month()), t.Day()) }

func parseDate(s string) *rules.Date {
	if s == "" {
		return nil
	}
	d, err := rules.ParseDate(s)
	if err != nil {
		return nil
	}
	return &d
}

func dstr(d *rules.Date) *string {
	if d == nil {
		return nil
	}
	s := d.String()
	return &s
}

// istMidnight converts an IST calendar date to a UTC instant at 00:00 IST plus a clock time.
func istAt(d rules.Date, hour, minute int) time.Time {
	y, m, dd := d.YMD()
	return time.Date(y, time.Month(m), dd, hour, minute, 0, 0, servertime.IST).UTC()
}

var last4Re = regexp.MustCompile(`^[0-9A-Z]{4}$`)

// RecordEvent appends a client status update (API-15), idempotent per key.
func (s *Service) RecordEvent(ctx context.Context, p *accounts.Principal, t *tenant.Tenant, caseRef string, in EventInput, idemKey string) (*EventResult, error) {
	id, err := decodeRef(caseRef)
	if err != nil {
		return nil, err
	}
	in.Type = string(journey.Normalize(journey.Event(in.Type)))
	if !journey.IsClient(journey.Event(in.Type)) {
		return nil, &ValidationError{Pointer: "/type", Code: "invalid_enum"}
	}
	if in.NumberLast4 != "" && !last4Re.MatchString(in.NumberLast4) {
		return nil, &ValidationError{Pointer: "/payload/number_last4", Code: "invalid_last4"}
	}
	now := s.now()
	today := rules.TodayIST(now)
	if date(in.OccurredOn).After(today.AddDays(1)) {
		return nil, &ValidationError{Pointer: "/occurred_on", Code: "future_date", Detail: "the server date is " + today.String() + " (EC-15)"}
	}
	key := idemKey
	if key == "" {
		b, _ := json.Marshal(in)
		sum := sha256.Sum256(b)
		key = "auto:" + hex.EncodeToString(sum[:12])
	}
	key = "client:" + key
	var res *EventResult
	var notice *EventNotice
	err = s.DB.Tenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		sn, err := s.load(ctx, tx, p, id, true)
		if err != nil {
			return err
		}
		act := actor{kind: "applicant", id: &p.ApplicantID, subject: p.Subject(), scope: p.Scope}
		if prev, err := store.CaseEventByKey(ctx, tx, id, key); err == nil {
			res = &EventResult{Seq: prev.Seq, Type: prev.Type, OccurredOn: deref(prev.OccurredOn), RecordedAt: prev.RecordedAt, Replay: true}
			res.View = s.view(sn, now, t)
			return nil
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		// occurred_on must not be before the case's previous client event (BACKEND §5.2).
		events, err := store.ListCaseEvents(ctx, tx, id)
		if err != nil {
			return err
		}
		for _, e := range events {
			if e.ActorKind == "applicant" && e.OccurredOn != nil {
				if d := parseDate(*e.OccurredOn); d != nil && date(in.OccurredOn).Before(*d) {
					return &ValidationError{Pointer: "/occurred_on", Code: "before_previous_event", Detail: "the previous update is dated " + d.String()}
				}
			}
		}
		ev, err := s.applyClientEvent(ctx, tx, sn, act, in, key, nil, now)
		if err != nil {
			return err
		}
		sched, canc, err := s.settle(ctx, tx, sn, now, act)
		if err != nil {
			return err
		}
		if err := s.auditCase(ctx, tx, sn, act, "case.event", map[string]any{"type": in.Type, "seq": ev.Seq, "state": sn.Case.State}); err != nil {
			return err
		}
		res = &EventResult{Seq: ev.Seq, Type: ev.Type, OccurredOn: deref(ev.OccurredOn), RecordedAt: ev.RecordedAt, Scheduled: sched, Cancelled: canc}
		res.View = s.view(sn, now, t)
		res.Warnings = res.View.Warnings
		notice = &EventNotice{Tenant: t.TenantID, CaseID: id, CaseRef: sn.Ref, ApplicantID: sn.Case.ApplicantID, Event: in.Type, Seq: ev.Seq, Minor: sn.IsMinor()}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if notice != nil && s.OnEvent != nil {
		s.OnEvent(context.WithoutCancel(ctx), *notice)
	}
	return res, nil
}

// applyClientEvent validates the transition, applies the effects to the projection and appends
// the event. llExpires overrides the computed LL expiry (EC-22 onboarding with the LL's date).
func (s *Service) applyClientEvent(ctx context.Context, tx pgx.Tx, sn *Snapshot, act actor, in EventInput, key string, llExpires *rules.Date, now time.Time) (*store.CaseEvent, error) {
	today := rules.TodayIST(now)
	from := journey.State(sn.Case.State)
	jin := journey.Input{Event: journey.Event(in.Type), On: date(in.OccurredOn)}
	if in.SlotDate != nil {
		d := date(*in.SlotDate)
		jin.SlotDate = &d
	}
	if in.RemedialAck {
		sn.Case.Flags = addFlag(sn.Case.Flags, "remedial_training_ack")
	}
	to, err := journey.Apply(from, s.guardFacts(sn, today), jin)
	if err != nil {
		var je *journey.Error
		if errors.As(err, &je) {
			return nil, &ConflictError{Code: je.Code, Detail: je.Detail, Pointer: "/type"}
		}
		return nil, err
	}
	if err := s.effects(ctx, tx, sn, in, llExpires); err != nil {
		return nil, err
	}
	payload := map[string]any{}
	if len(in.Classes) > 0 {
		payload["classes"] = in.Classes
	}
	for k, v := range map[string]string{"class_code": in.ClassCode, "test": in.Test, "office_id": in.OfficeID} {
		if v != "" {
			payload[k] = v
		}
	}
	if in.SlotDate != nil {
		payload["slot_date"] = in.SlotDate.Format(time.DateOnly)
	}
	if len(in.ReasonCodes) > 0 {
		payload["reason_codes"] = in.ReasonCodes
	}
	if in.ValidTo != nil {
		payload["valid_to"] = in.ValidTo.Format(time.DateOnly)
	}
	if in.RemedialAck {
		payload["remedial_training_ack"] = true
	}
	// number_last4 and receipt_number are kept out of the event store (C3): the last 4 sits
	// encrypted in the LL mirror and receipts stay on the device.
	sn.Case.State = string(to)
	on := in.OccurredOn.Format(time.DateOnly)
	return s.appendEvent(ctx, tx, sn, act, in.Type, &on, payload, key, now, string(from), string(to))
}

// appendEvent writes the next event (gapless seq under the row lock taken by load).
func (s *Service) appendEvent(ctx context.Context, tx pgx.Tx, sn *Snapshot, act actor, typ string, occurredOn *string, payload map[string]any,
	key string, now time.Time, from, to string) (*store.CaseEvent, error) {
	ev := &store.CaseEvent{CaseID: sn.Case.ID, Seq: sn.Case.LastSeq + 1, TenantID: sn.Case.TenantID, Type: typ, Payload: payload, OccurredOn: occurredOn,
		RecordedAt: now, ActorKind: act.kind, ActorID: act.id, IdempotencyKey: key, RulePackVersion: sn.Case.RulePackVersion}
	if from != "" {
		ev.FromState = &from
	}
	if to != "" {
		ev.ToState = &to
	}
	created, err := store.InsertCaseEvent(ctx, tx, ev)
	if err != nil {
		return nil, err
	}
	if created {
		sn.Case.LastSeq = ev.Seq
		sn.dirty = true
	}
	return ev, nil
}

// guardFacts are the dated facts the machine's guards read.
func (s *Service) guardFacts(sn *Snapshot, today rules.Date) journey.Facts {
	p := rulekit.ParamsOf(sn.Pack)
	f := journey.Facts{Today: today, RetestGap: p.RetestGapDays, RemedialRule: p.RemedialAfter, RemedialAck: hasFlag(sn.Case.Flags, "remedial_training_ack")}
	f.DLTestUnlock = parseDate(sn.Case.KeyDates["dl_test_unlock"])
	if sn.LL != nil {
		f.LLExpiresOn = parseDate(sn.LL.ExpiresOn)
	}
	f.LastFailOn = parseDate(sn.Case.KeyDates["last_fail_on"])
	for _, c := range sn.Classes {
		if c.Attempts > f.Fails {
			f.Fails = c.Attempts
		}
	}
	return f
}

func hasFlag(flags []string, f string) bool {
	for _, x := range flags {
		if x == f {
			return true
		}
	}
	return false
}

func addFlag(flags []string, f string) []string {
	if hasFlag(flags, f) {
		return flags
	}
	return append(flags, f)
}

func (s *Service) setClassStatus(sn *Snapshot, only string, status string, bumpAttempts bool) {
	for i := range sn.Classes {
		if only != "" && sn.Classes[i].ClassCode != only {
			continue
		}
		if sn.Classes[i].Status == "withdrawn" {
			continue
		}
		sn.Classes[i].Status = status
		if bumpAttempts {
			sn.Classes[i].Attempts++
		}
	}
}

// effects updates the projection for an event (mirrors, key dates, class selections).
func (s *Service) effects(ctx context.Context, tx pgx.Tx, sn *Snapshot, in EventInput, llExpires *rules.Date) error {
	c := sn.Case
	on := date(in.OccurredOn)
	kd := c.KeyDates
	switch journey.Event(in.Type) {
	case journey.LLApplicationStarted:
		s.setClassStatus(sn, "", "ll_applied", false)
		kd["applied_on"] = on.String()
	case journey.HandoffDone:
		kd["handed_off_on"] = on.String()
		s.setClassStatus(sn, "", "ll_applied", false)
	case journey.PaymentPendingEv:
		kd["payment_pending_on"] = on.String()
	case journey.PaymentConfirmed:
		kd["payment_confirmed_on"] = on.String()
		delete(kd, "payment_pending_on")
	case journey.LLIssued:
		unlock, expires := rulekit.LLDates(sn.Pack, on)
		if llExpires != nil && llExpires.After(on) {
			expires = *llExpires
		}
		classes := in.Classes
		if len(classes) == 0 {
			classes = c.Classes
		}
		m := store.LLMirror{IssuedOn: on.String(), ExpiresOn: expires.String(), Classes: classes, Source: "user_entered"}
		if in.NumberLast4 != "" {
			enc, err := s.Vault.EncryptString(c.TenantID, "ll_mirrors.number_last4", in.NumberLast4)
			if err != nil {
				return err
			}
			m.NumberLast4Enc = enc
		}
		if err := store.UpsertLLMirror(ctx, tx, c.TenantID, c.ID, m); err != nil {
			return err
		}
		sn.LL = &m
		kd["ll_issued_on"], kd["ll_expires_on"], kd["dl_test_unlock"] = on.String(), expires.String(), unlock.String()
		s.setClassStatus(sn, "", "ll_issued", false)
	case journey.SlotBooked:
		if in.SlotDate != nil {
			kd["slot_date"] = date(*in.SlotDate).String()
		} else {
			delete(kd, "slot_date")
		}
		kd["slot_booked_on"] = on.String()
		s.setClassStatus(sn, in.ClassCode, "dl_test_booked", false)
	case journey.TestFailedEv:
		kd["last_fail_on"] = on.String()
		p := rulekit.ParamsOf(sn.Pack)
		kd["retest_from"] = on.AddDays(p.RetestGapDays).String()
		delete(kd, "slot_date")
		s.setClassStatus(sn, in.ClassCode, "dl_failed", true)
	case journey.TestPassed:
		kd["passed_on"] = on.String()
		delete(kd, "slot_date")
		s.setClassStatus(sn, in.ClassCode, "dl_passed", false)
	case journey.Approved:
		kd["approved_on"] = on.String()
		s.setClassStatus(sn, "", "dl_issued", false)
	case journey.CardReceived, journey.Renewed:
		kd["card_received_on"] = on.String()
		s.setClassStatus(sn, "", "dl_issued", false)
		issued := kd["approved_on"]
		if issued == "" {
			issued = on.String()
		}
		if in.ValidTo != nil {
			vt := date(*in.ValidTo)
			rw := journey.RenewalWindowOpens(vt)
			m := store.DLMirror{IssuedOn: &issued, ValidToNT: vt.String(), Classes: c.Classes, RenewalWindowOpens: dstr(&rw), Source: "user_entered"}
			if journey.Event(in.Type) == journey.Renewed {
				r := on.String()
				m.IssuedOn = &r
			}
			if err := store.UpsertDLMirror(ctx, tx, c.TenantID, c.ID, m); err != nil {
				return err
			}
			sn.DL = &m
			kd["dl_valid_to"], kd["renewal_window_opens"] = vt.String(), rw.String()
		}
		kd["dl_issued_on"] = issued
	case journey.Reapply:
		for _, k := range []string{"ll_issued_on", "ll_expires_on", "dl_test_unlock", "slot_date", "last_fail_on", "retest_from"} {
			delete(kd, k)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM core.ll_mirrors WHERE case_id = $1`, c.ID); err != nil {
			return err
		}
		sn.LL = nil
		kd["applied_on"] = on.String()
		s.setClassStatus(sn, "", "ll_applied", false)
	}
	if err := store.ReplaceClassSelections(ctx, tx, c.TenantID, c.ID, sn.Classes); err != nil {
		return err
	}
	sn.dirty = true
	return nil
}

// onboardDL creates a DL-holder case directly (existing_dl).
func (s *Service) onboardDL(ctx context.Context, tx pgx.Tx, sn *Snapshot, act actor, dl DLInput, now time.Time) error {
	c := sn.Case
	vt := date(dl.ValidToNT)
	rw := journey.RenewalWindowOpens(vt)
	m := store.DLMirror{ValidToNT: vt.String(), Classes: dl.Classes, RenewalWindowOpens: dstr(&rw), Source: "user_entered"}
	if len(m.Classes) == 0 {
		m.Classes = c.Classes
	}
	if dl.Source == "digilocker" {
		m.Source = "digilocker"
	}
	if dl.IssuedOn != nil {
		v := date(*dl.IssuedOn).String()
		m.IssuedOn = &v
		c.KeyDates["dl_issued_on"] = v
	}
	if dl.ValidToTR != nil {
		v := date(*dl.ValidToTR).String()
		m.ValidToTR = &v
	}
	if dl.NumberLast4 != "" {
		if !last4Re.MatchString(dl.NumberLast4) {
			return &ValidationError{Pointer: "/existing_dl/number_last4", Code: "invalid_last4"}
		}
		enc, err := s.Vault.EncryptString(c.TenantID, "dl_mirrors.number_last4", dl.NumberLast4)
		if err != nil {
			return err
		}
		m.NumberLast4Enc = enc
	}
	if err := store.UpsertDLMirror(ctx, tx, c.TenantID, c.ID, m); err != nil {
		return err
	}
	sn.DL = &m
	c.KeyDates["dl_valid_to"], c.KeyDates["renewal_window_opens"] = vt.String(), rw.String()
	from := c.State
	c.State = string(journey.DLHolder)
	s.setClassStatus(sn, "", "dl_issued", false)
	if err := store.ReplaceClassSelections(ctx, tx, c.TenantID, c.ID, sn.Classes); err != nil {
		return err
	}
	today := rules.TodayIST(now).String()
	_, err := s.appendEvent(ctx, tx, sn, act, "dl_onboarded", &today, map[string]any{"source": m.Source}, "existing_dl", now, from, c.State)
	return err
}

// ApplySystemEvent applies a clock or adapter event (sweep, payment callback). An event the
// machine does not allow in the case's current state is a no-op (applied=false).
func (s *Service) ApplySystemEvent(ctx context.Context, tenantID string, caseID uuid.UUID, ev journey.Event, key, actorKind string) (bool, error) {
	now := s.now()
	applied := false
	err := s.DB.Tenant(ctx, tenantID, func(tx pgx.Tx) error {
		c, err := store.GetCaseForUpdate(ctx, tx, caseID)
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		sn, err := s.hydrate(ctx, tx, c)
		if err != nil {
			if errors.Is(err, ErrParentConsent) {
				return nil // a minor's case without parental consent is not processed
			}
			return err
		}
		if _, err := store.CaseEventByKey(ctx, tx, caseID, key); err == nil {
			return nil
		}
		act := actor{kind: actorKind, subject: "system:" + actorKind, scope: "system"}
		today := rules.TodayIST(now)
		from := journey.State(c.State)
		to, err := journey.Apply(from, s.guardFacts(sn, today), journey.Input{Event: ev, On: today})
		if err != nil {
			return nil
		}
		on := today.String()
		switch ev {
		case journey.PaymentConfirmed, journey.PaymentPendingEv:
			if err := s.effects(ctx, tx, sn, EventInput{Type: string(ev), OccurredOn: istAt(today, 0, 0).In(servertime.IST)}, nil); err != nil {
				return err
			}
		}
		c.State = string(to)
		if _, err := s.appendEvent(ctx, tx, sn, act, string(ev), &on, map[string]any{}, key, now, string(from), string(to)); err != nil {
			return err
		}
		if _, _, err := s.settle(ctx, tx, sn, now, act); err != nil {
			return err
		}
		applied = true
		return s.auditCase(ctx, tx, sn, act, "case.system_event", map[string]any{"type": string(ev), "state": c.State})
	})
	return applied, err
}

// settle applies due clock events (catch-up), refreshes derived key dates, the fee quote and the
// timeline, and saves the projection when anything changed. It returns the milestone codes
// newly scheduled and cancelled.
func (s *Service) settle(ctx context.Context, tx pgx.Tx, sn *Snapshot, now time.Time, act actor) ([]string, []string, error) {
	today := rules.TodayIST(now)
	c := sn.Case
	var rw *rules.Date
	if sn.DL != nil && sn.DL.RenewalWindowOpens != nil {
		rw = parseDate(*sn.DL.RenewalWindowOpens)
	}
	state, applied := journey.CatchUp(journey.State(c.State), s.guardFacts(sn, today), rw)
	prev := journey.State(c.State)
	for _, ev := range applied {
		next, _ := journey.Apply(prev, s.guardFacts(sn, today), journey.Input{Event: ev, On: today})
		on := today.String()
		key := fmt.Sprintf("clock:%s:%s", ev, s.clockDate(sn, ev))
		c.State = string(next)
		if _, err := s.appendEvent(ctx, tx, sn, systemActor, string(ev), &on, map[string]any{}, key, now, string(prev), string(next)); err != nil {
			return nil, nil, err
		}
		prev = next
	}
	c.State = string(state)
	if sn.Quote == nil {
		if _, err := s.writeQuote(ctx, tx, sn, now); err != nil {
			return nil, nil, err
		}
	}
	if s.refreshKeyDates(sn, today) {
		sn.dirty = true
	}
	sched, canc, err := s.recomputeTimeline(ctx, tx, sn, today)
	if err != nil {
		return nil, nil, err
	}
	if sn.dirty {
		if err := store.SaveCase(ctx, tx, c); err != nil {
			return nil, nil, err
		}
		sn.dirty = false
	}
	_ = act
	return sched, canc, nil
}

// clockDate is the date a clock event belongs to (its idempotency key part).
func (s *Service) clockDate(sn *Snapshot, ev journey.Event) string {
	switch ev {
	case journey.DLUnlocked:
		return sn.Case.KeyDates["dl_test_unlock"]
	case journey.LLExpiredEv:
		if sn.LL != nil {
			return sn.LL.ExpiresOn
		}
	case journey.RenewalWindowOpened:
		return sn.Case.KeyDates["renewal_window_opens"]
	}
	return ""
}

// refreshKeyDates derives the dates shown on the case (EC-04 turns_40_on).
func (s *Service) refreshKeyDates(sn *Snapshot, today rules.Date) bool {
	kd := sn.Case.KeyDates
	before, _ := json.Marshal(kd)
	if sn.LL != nil {
		kd["ll_expiry"] = sn.LL.ExpiresOn
	}
	if sn.DOB != nil {
		p := rulekit.ParamsOf(sn.Pack)
		if p.Form1AAge > 0 {
			dob := date(*sn.DOB)
			if deref(sn.Case.DOBPrecision) == "year_only" {
				dob = rules.DateFromYMD(sn.DOB.Year(), 1, 1) // upper limits use 1 Jan (EC-01)
			}
			kd["turns_40_on"] = rules.BirthdayAt(dob, p.Form1AAge).String()
		}
	}
	after, _ := json.Marshal(kd)
	return string(before) != string(after)
}

// writeQuote stores the case's fee quote (fee quote store, E-07) from fees.json.
func (s *Service) writeQuote(ctx context.Context, tx pgx.Tx, sn *Snapshot, now time.Time) (*store.FeeQuote, error) {
	q := sn.Pack.FeeQuote(sn.Case.Classes)
	wq := wire.Quote(q, "", sn.Pack.Version)
	lines, _ := json.Marshal(wq.Lines)
	id := sn.Case.ID
	row := &store.FeeQuote{ID: ids.New(), TenantID: sn.Case.TenantID, CaseID: &id, PlanID: sn.Case.PlanID, State: sn.Pack.PackID,
		RulePackVersion: sn.Pack.Version, Classes: append([]string{}, sn.Case.Classes...), Lines: lines, LLStagePaise: q.LLStagePaise,
		SubtotalGovtFeePaise: q.SubtotalGovtFeePaise, TotalPaise: q.TotalPaise, Excludes: wq.Excludes, CreatedAt: now}
	if err := store.InsertFeeQuote(ctx, tx, row); err != nil {
		return nil, err
	}
	sn.Quote = row
	return row, nil
}

// scheduleInput builds the pure schedule input from the projection.
func (s *Service) scheduleInput(sn *Snapshot, today rules.Date) journey.ScheduleInput {
	p := rulekit.ParamsOf(sn.Pack)
	kd := sn.Case.KeyDates
	in := journey.ScheduleInput{State: journey.State(sn.Case.State), DLTestUnlock: parseDate(kd["dl_test_unlock"]), SlotDate: parseDate(kd["slot_date"]),
		LastFailOn: parseDate(kd["last_fail_on"]), PassedOn: parseDate(kd["passed_on"]), RetestGap: p.RetestGapDays,
		Rules: journey.RuleIDs{MinWait: p.MinWaitRule, Validity: p.ValidityRule, RetestGap: p.RetestGapRule, Form1A: rulekit.EffectiveID(sn.Pack, "WRN-TURNING-40")}}
	if sn.LL != nil {
		in.LLIssuedOn, in.LLExpiresOn = parseDate(sn.LL.IssuedOn), parseDate(sn.LL.ExpiresOn)
	}
	if sn.DL != nil {
		in.DLValidTo = parseDate(sn.DL.ValidToNT)
	}
	if res := s.evaluate(sn, today); res != nil {
		for _, m := range res.Milestones {
			if m.ID == journey.MForm1AAt40 {
				in.Form1ADue = parseDate(m.DueOn)
			}
		}
	}
	return in
}

// evaluate runs the rules engine for the case (nil when the DOB is unknown or the input is
// rejected).
func (s *Service) evaluate(sn *Snapshot, today rules.Date) *rules.Plan {
	if sn.DOB == nil {
		return nil
	}
	var llIssued *string
	if sn.LL != nil {
		if d := parseDate(sn.LL.IssuedOn); d != nil && !d.After(today) {
			llIssued = &sn.LL.IssuedOn
		}
	}
	in := engineInput(sn.Pack.PackID, sn.DOB, deref(sn.Case.DOBPrecision), sn.Case.Classes, sn.Case.Facts, today, llIssued, sn.DL != nil)
	res, err := sn.Pack.Plan(in)
	if err != nil {
		if s.Log != nil {
			s.Log.Warn("rules evaluation of a case failed", "case", sn.Ref, "err", err.Error())
		}
		return nil
	}
	return res
}

// TimelineKey is the E-12 idempotency key "{caseId}:{milestoneId}:{dueOn}" (BACKEND §7.1).
func TimelineKey(caseRef, code, dueOn string) string { return caseRef + ":" + code + ":" + dueOn }

// recomputeTimeline reconciles the scheduled rows with the schedule: rows that no longer apply
// are cancelled (or superseded by a new date for the same code); new rows are inserted by key
// (a repeat is a no-op). Reminders already in the past are not newly scheduled.
func (s *Service) recomputeTimeline(ctx context.Context, tx pgx.Tx, sn *Snapshot, today rules.Date) ([]string, []string, error) {
	ms := journey.Schedule(s.scheduleInput(sn, today))
	want := map[string]journey.Milestone{}
	codes := map[string]bool{}
	for _, m := range ms {
		want[TimelineKey(sn.Ref, m.Code, m.DueOn.String())] = m
		codes[m.Code] = true
	}
	existing, err := store.ListTimeline(ctx, tx, sn.Case.ID)
	if err != nil {
		return nil, nil, err
	}
	have := map[string]bool{}
	var cancelled, scheduled []string
	for _, e := range existing {
		have[e.IdempotencyKey] = true
		if e.Status != "scheduled" {
			continue
		}
		if _, ok := want[e.IdempotencyKey]; ok {
			continue
		}
		status := "cancelled"
		if codes[e.Code] {
			status = "superseded"
		}
		if err := store.SetTimelineStatus(ctx, tx, e.ID, status); err != nil {
			return nil, nil, err
		}
		cancelled = append(cancelled, e.Code)
	}
	seq := sn.Case.LastSeq
	for key, m := range want {
		if have[key] || m.DueOn.Before(today) {
			continue
		}
		due := istAt(m.DueOn, 8, 0) // the daily sweep runs at 08:00 IST (W01)
		if m.Code == journey.MTestEve {
			due = istAt(m.DueOn, 19, 0)
		}
		if m.Kind == journey.KindDeadline {
			due = istAt(m.DueOn, 0, 0)
		}
		dueOn, rule := m.DueOn.String(), m.RuleID
		row := &store.TimelineEvent{ID: ids.New(), TenantID: sn.Case.TenantID, CaseID: sn.Case.ID, Kind: m.Kind, Code: m.Code, DueAt: &due,
			DueOn: &dueOn, RuleID: &rule, IdempotencyKey: key, SourceSeq: &seq}
		created, err := store.UpsertTimelineEvent(ctx, tx, row)
		if err != nil {
			return nil, nil, err
		}
		if created {
			scheduled = append(scheduled, m.Code)
		}
	}
	sort.Strings(scheduled)
	sort.Strings(cancelled)
	return scheduled, cancelled, nil
}

// auditCase appends an E-30 row for a case action.
func (s *Service) auditCase(ctx context.Context, tx pgx.Tx, sn *Snapshot, act actor, action string, meta map[string]any) error {
	who := act.subject
	if who == "" {
		who = "system"
	}
	scope := act.scope
	if scope == "" {
		scope = "system"
	}
	_, err := audit.Append(ctx, tx, s.now(), audit.Entry{Tenant: sn.Case.TenantID, Actor: who, ActorScope: scope, Action: action, Target: sn.Ref, Meta: meta})
	return err
}

// ---- Rebuild (seeds) -------------------------------------------------------------------------

// Rebuild settles a case written directly by the seed: quote, catch-up and timeline.
func (s *Service) Rebuild(ctx context.Context, tenantID string, caseID uuid.UUID) error {
	return s.DB.Tenant(ctx, tenantID, func(tx pgx.Tx) error {
		c, err := store.GetCaseForUpdate(ctx, tx, caseID)
		if err != nil {
			return err
		}
		sn, err := s.hydrate(ctx, tx, c)
		if err != nil {
			return err
		}
		_, _, err = s.settle(ctx, tx, sn, s.now(), systemActor)
		return err
	})
}

// CaseIDs of an event key "cas_...:CODE:YYYY-MM-DD".
func SplitTimelineKey(key string) (caseRef, code, dueOn string, ok bool) {
	parts := strings.Split(key, ":")
	if len(parts) != 3 {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}
