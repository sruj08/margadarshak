// Package analytics is privacy-preserving analytics (MD-136, MD-141, F-55, API-63): events from a
// fixed taxonomy (docs/01-product/METRICS.md §7) with allowlisted properties only, no free text
// and no identifiers beyond a daily-rotating pseudonym; nothing from a minor family member's case
// (D-13 revised) and nothing without the analytics consent. The digest aggregates with k >= 5
// suppression; the SQL is versioned in queries/.
package analytics

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/rules"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// KMin is the k-anonymity threshold: cells with fewer distinct subjects are suppressed.
const KMin = 5

// SQLVersion names the digest SQL file.
const SQLVersion = "internal/analytics/queries/digest_v1.sql"

//go:embed queries/digest_v1.sql
var sqlFS embed.FS

// prop validates one property value.
type prop func(v any) bool

func enum(vals ...string) prop {
	return func(v any) bool {
		s, ok := v.(string)
		if !ok {
			return false
		}
		for _, x := range vals {
			if s == x {
				return true
			}
		}
		return false
	}
}

var tokenRe = regexp.MustCompile(`^[A-Za-z0-9_.\-]{1,48}$`)

// token is a code-like value (rule IDs, class codes, step IDs): never free text.
func token(v any) bool {
	s, ok := v.(string)
	return ok && tokenRe.MatchString(s)
}

func boolean(v any) bool { _, ok := v.(bool); return ok }

func smallInt(v any) bool {
	n, ok := v.(float64)
	return ok && n >= 0 && n <= 1000 && n == float64(int(n))
}

var (
	durationBucket = enum("<10s", "10-30s", "30-60s", "1-3m", "3-10m", ">10m")
	gapBucket      = enum("<1h", "1-24h", "1-7d", ">7d")
	daysBucket     = enum("0-7", "8-14", "15-30", "31-60", ">60")
	scoreBucket    = enum("0-39", "40-59", "60-74", "75-84", "85-100")
	stage          = enum("S0", "S1", "S2", "S3", "S4", "S5", "S6", "S6F", "S7", "S8", "S9")
	confidence     = enum("high", "medium", "low")
)

// common props every event may carry (METRICS §7.1 envelope, server-set fields excluded).
var common = map[string]prop{"v": smallInt, "locale": enum("en", "hi", "doi"), "lite": boolean, "stage": stage,
	"cohort": enum("public", "field_test", "demo", "pilot"), "net": enum("4g", "3g", "2g", "offline_sync"), "app_version": token}

// Registry is the allowlisted taxonomy (METRICS.md §7.4, journey events). Unknown names or
// properties are rejected, not dropped (MD-136).
var Registry = map[string]map[string]prop{
	"app_opened":                 {"entry": enum("direct", "whatsapp_plan", "share_card", "school_qr", "helper_qr", "email"), "first_visit": boolean},
	"language_selected":          {"lang": enum("en", "hi")},
	"disclaimer_acknowledged":    {},
	"home_tile_tapped":           {"tile": enum("first_licence", "practise", "renew_fix", "check_application")},
	"home_primary_action_tapped": {"action_id": token},
	"all_services_opened":        {},
	"service_external_opened":    {"service_id": token},
	"lite_mode_changed":          {"on": boolean, "trigger": enum("auto", "manual")},
	"offline_state_changed":      {"online": boolean},
	"plan_started":               {},
	"plan_vehicle_selected":      {"vehicle_type": enum("scooter_no_gear", "bike_gear", "car", "auto_erickshaw", "truck_bus")},
	"plan_state_selected":        {"state": token},
	"plan_viewed":                {"classes_count": smallInt, "blockers_count": smallInt, "min_confidence": confidence, "rulepack_version": token},
	"plan_class_added":           {"class_code": token, "eligible": boolean},
	"plan_whatsapp_sent":         {},
	"plan_link_copied":           {},
	"blocker_shown":              {"rule_id": token, "severity": enum("info", "warn", "high")},
	"blocker_fix_opened":         {"rule_id": token},
	"source_chip_opened":         {"rule_id": token, "confidence": confidence},
	"family_card_shared":         {"format": enum("image", "link")},
	"application_started":        {"path": enum("aadhaar", "non_aadhaar")},
	"application_step_completed": {"step_id": token, "step_index": smallInt, "duration_bucket": durationBucket},
	"application_resumed":        {"device_switch": boolean, "gap_bucket": gapBucket},
	"autosave_failed":            {"reason": enum("offline_queued", "server_error")},
	"check_answers_viewed":       {},
	"answer_changed":             {"step_id": token},
	"photo_check_run":            {"result": enum("pass", "fixed", "fail")},
	"signature_check_run":        {"result": enum("pass", "fixed", "fail")},
	"device_check_run":           {"result": enum("pass", "warn", "fail")},
	"handoff_opened":             {"mode": enum("A", "B")},
	"copy_field_copied":          {"field_id": token},
	"sarathi_opened":             {"screen_id": token},
	"payment_pending_reported":   {},
	"outage_banner_shown":        {"source": enum("status_adapter")},
	"stage_changed":              {"from": stage, "to": stage, "class_code": token},
	"ll_issued_recorded":         {"days_bucket": daysBucket},
	"slot_booked_recorded":       {"lead_days_bucket": daysBucket, "office_type": token},
	"test_result_recorded":       {"class_code": token, "result": enum("pass", "fail", "absent"), "reason_code": token},
	"collision_warning_shown":    {"kind": enum("ll_expiry_vs_slot", "ll_expiry_vs_retest")},
	"module_opened":              {"module_id": token},
	"readiness_viewed":           {"score_bucket": scoreBucket},
	"simulator_started":          {"format_id": token, "first_run": boolean},
	"simulator_completed":        {"score_bucket": scoreBucket, "passed": boolean},
	"game_session_started":       {"game_id": token, "mode": enum("mock", "practice", "learn"), "difficulty": token},
	"game_session_completed":     {"game_id": token, "mode": enum("mock", "practice", "learn"), "score_bucket": scoreBucket, "duration_bucket": durationBucket},
	"consent_changed":            {"purpose": token, "action": enum("grant", "revoke")},
}

// ValidationError points at an invalid event.
type ValidationError struct{ Pointer, Code string }

func (e *ValidationError) Error() string { return "analytics: " + e.Pointer + " " + e.Code }

// Event is one inbound event.
type Event struct {
	Name  string
	Props map[string]any
}

// Validate checks names and properties against the registry and the PII scanner.
func Validate(evs []Event) error {
	if len(evs) > 100 {
		return &ValidationError{Pointer: "/events", Code: "too_many"}
	}
	for i, e := range evs {
		ptr := fmt.Sprintf("/events/%d", i)
		spec, ok := Registry[e.Name]
		if !ok {
			return &ValidationError{Pointer: ptr + "/name", Code: "unknown_event"}
		}
		if len(e.Props) > 12 {
			return &ValidationError{Pointer: ptr + "/props", Code: "too_many_props"}
		}
		for k, v := range e.Props {
			check, ok := spec[k]
			if !ok {
				check, ok = common[k]
			}
			if !ok {
				return &ValidationError{Pointer: ptr + "/props/" + k, Code: "unknown_property"}
			}
			if !check(v) {
				return &ValidationError{Pointer: ptr + "/props/" + k, Code: "invalid_value"}
			}
			if s, ok := v.(string); ok {
				if _, bad := privacy.FirstProhibited(s); bad || len(privacy.Detect(s)) > 0 {
					return &ValidationError{Pointer: ptr + "/props/" + k, Code: "PROHIBITED_FIELD"}
				}
			}
		}
	}
	return nil
}

// Service ingests and aggregates.
type Service struct {
	DB    *store.DB
	Vault *privacy.Vault
	Clock servertime.Clock
}

// IngestResult says how many events were stored.
type IngestResult struct{ Stored, Dropped int }

// Ingest validates, then stores the events, or drops them all when processing is not permitted:
// no active analytics consent, a minor subject, or a minor family member's case (D-13 revised:
// no behavioural tracking on a child's data). The day comes from the server (EC-15).
func (s *Service) Ingest(ctx context.Context, p *accounts.Principal, caseRef string, evs []Event) (IngestResult, error) {
	if err := Validate(evs); err != nil {
		return IngestResult{}, err
	}
	now := s.Clock.Now()
	allowed := true
	err := s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		if p.UserBand == "u18" {
			allowed = false
			return nil
		}
		if _, err := store.ActiveConsent(ctx, tx, p.ApplicantID, "analytics", nil, nil); errors.Is(err, store.ErrNotFound) {
			allowed = false
			return nil
		} else if err != nil {
			return err
		}
		if caseRef != "" {
			id, err := ids.Decode(ids.Case, caseRef)
			if err != nil {
				allowed = false
				return nil
			}
			c, err := store.GetCase(ctx, tx, id)
			if err != nil || c.ApplicantID != p.ApplicantID {
				allowed = false
				return nil
			}
			if c.FamilyMemberID != nil {
				m, err := store.GetFamilyMember(ctx, tx, c.ApplicantID, *c.FamilyMemberID)
				if err != nil || m.IsMinor {
					allowed = false
				}
			}
		}
		return nil
	})
	if err != nil {
		return IngestResult{}, err
	}
	if !allowed {
		return IngestResult{Dropped: len(evs)}, nil
	}
	day := servertime.DateIST(now)
	// The pseudonym rotates every IST day: events of one subject can be counted within a day,
	// never joined across days or back to the account (METRICS §7.1 sid).
	pseudo := s.Vault.Keyed(p.Tenant, "analytics:"+day, p.ApplicantID.String())
	rows := make([]store.AnalyticsEvent, 0, len(evs))
	for _, e := range evs {
		rows = append(rows, store.AnalyticsEvent{TenantID: p.Tenant, Day: day, Name: e.Name, Props: e.Props, Pseudonym: pseudo})
	}
	if err := s.DB.System(ctx, func(tx pgx.Tx) error { return store.InsertAnalyticsEvents(ctx, tx, rows) }); err != nil {
		return IngestResult{}, err
	}
	return IngestResult{Stored: len(rows)}, nil
}

// Row is one digest cell.
type Row struct {
	Label      string `json:"label"`
	Value      any    `json:"value"`
	Suppressed bool   `json:"suppressed"`
}

// Section is a titled group of cells.
type Section struct {
	Title string `json:"title"`
	Rows  []Row  `json:"rows"`
}

// Digest is the W13 digest (AnalyticsDigest schema).
type Digest struct {
	Period             string    `json:"period"`
	From               string    `json:"from"`
	To                 string    `json:"to"`
	KMin               int       `json:"k_min"`
	Publishable        bool      `json:"publishable"`
	Reason             *string   `json:"reason"`
	SQLVersion         string    `json:"sql_version"`
	GeneratedAt        time.Time `json:"generated_at"`
	SuppressedCells    int       `json:"suppressed_cells"`
	MinorCasesExcluded bool      `json:"minor_cases_excluded"`
	Sections           []Section `json:"sections"`
}

func queries() (map[string]string, error) {
	raw, err := sqlFS.ReadFile("queries/digest_v1.sql")
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	name := ""
	var b strings.Builder
	flush := func() {
		if name != "" {
			out[name] = strings.TrimSpace(b.String())
		}
		b.Reset()
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, "-- name: ") {
			flush()
			name = strings.TrimSpace(strings.TrimPrefix(line, "-- name: "))
			continue
		}
		if name != "" && !strings.HasPrefix(strings.TrimSpace(line), "--") {
			b.WriteString(line)
			b.WriteString("\n")
		}
	}
	flush()
	return out, nil
}

// Suppress applies k-anonymity to one count.
func Suppress(label string, n int64) Row {
	if n < KMin {
		return Row{Label: label, Value: fmt.Sprintf("suppressed (n < %d)", KMin), Suppressed: true}
	}
	return Row{Label: label, Value: n}
}

// BuildDigest aggregates the period ending today (IST, exclusive of tomorrow).
func (s *Service) BuildDigest(ctx context.Context, tenant, period string) (*Digest, error) {
	if period != "day" {
		period = "week"
	}
	now := s.Clock.Now()
	today := rules.TodayIST(now)
	from := today.AddDays(-7)
	if period == "day" {
		from = today.AddDays(-1)
	}
	to := today.AddDays(1)
	qs, err := queries()
	if err != nil {
		return nil, err
	}
	d := &Digest{Period: period, From: from.String(), To: today.String(), KMin: KMin, SQLVersion: SQLVersion, GeneratedAt: now.UTC(), MinorCasesExcluded: true}
	titles := []struct{ key, title string }{{"funnel", "Funnel: plan to licence"}, {"events", "App events (distinct daily pseudonyms)"}, {"messages", "Messages by channel and status"}}
	visible := 0
	err = s.DB.System(ctx, func(tx pgx.Tx) error {
		for _, t := range titles {
			rows, err := tx.Query(ctx, qs[t.key], tenant, from.String(), to.String())
			if err != nil {
				return fmt.Errorf("analytics: %s: %w", t.key, err)
			}
			sec := Section{Title: t.title, Rows: []Row{}}
			for rows.Next() {
				var label string
				var n int64
				if err := rows.Scan(&label, &n); err != nil {
					rows.Close()
					return err
				}
				r := Suppress(label, n)
				if r.Suppressed {
					d.SuppressedCells++
				} else {
					visible++
				}
				sec.Rows = append(sec.Rows, r)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}
			d.Sections = append(d.Sections, sec)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	d.Publishable = visible > 0
	if !d.Publishable {
		r := "insufficient_sample"
		d.Reason = &r
	}
	return d, nil
}
