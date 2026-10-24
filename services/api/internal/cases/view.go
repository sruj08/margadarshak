package cases

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/journey"
	"github.com/sruj08/margadarshak/services/api/internal/rules"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/tenant"
	"github.com/sruj08/margadarshak/services/api/internal/wire"
)

// ClassOut is E-03 on the wire.
type ClassOut struct {
	ClassCode string `json:"class_code"`
	Status    string `json:"status"`
	Attempts  int    `json:"attempts"`
}

// LLOut is E-04 on the wire (last 4 only).
type LLOut struct {
	IssuedOn    string   `json:"issued_on"`
	ExpiresOn   string   `json:"expires_on"`
	Classes     []string `json:"classes"`
	NumberLast4 string   `json:"number_last4,omitempty"`
	Source      string   `json:"source"`
}

// DLOut is E-05 on the wire.
type DLOut struct {
	IssuedOn            *string  `json:"issued_on,omitempty"`
	ValidToNonTransport string   `json:"valid_to_non_transport"`
	ValidToTransport    *string  `json:"valid_to_transport,omitempty"`
	Classes             []string `json:"classes"`
	NumberLast4         string   `json:"number_last4,omitempty"`
	RenewalWindowOpens  *string  `json:"renewal_window_opens,omitempty"`
	Source              string   `json:"source"`
}

// NextActionOut is the single primary action.
type NextActionOut struct {
	ActionID string     `json:"action_id"`
	Stage    string     `json:"stage"`
	TitleKey string     `json:"title_key"`
	DueAt    *time.Time `json:"due_at"`
	DeepLink string     `json:"deep_link,omitempty"`
}

// View is the Case on the wire (API-11), with the derived stage, alerts and next action.
type View struct {
	CaseID            string             `json:"case_id"`
	Tenant            string             `json:"tenant"`
	State             string             `json:"state"`
	Stage             string             `json:"stage"`
	DisplayStage      string             `json:"display_stage"`
	Alerts            []string           `json:"alerts"`
	Path              *string            `json:"path,omitempty"`
	Classes           []ClassOut         `json:"classes"`
	Answers           map[string]any     `json:"answers"`
	LL                *LLOut             `json:"ll"`
	DL                *DLOut             `json:"dl"`
	KeyDates          map[string]*string `json:"key_dates"`
	NextAction        NextActionOut      `json:"next_action"`
	RulePackVersion   string             `json:"rule_pack_version"`
	Version           int                `json:"version"`
	Flags             []string           `json:"flags"`
	ForFamilyMember   bool               `json:"for_family_member"`
	FamilyMemberID    *string            `json:"family_member_id"`
	Facts             map[string]any     `json:"facts"`
	Fees              *wire.FeeQuote     `json:"fees,omitempty"`
	ApplicationStatus map[string]any     `json:"application_status"`
	ServerTime        time.Time          `json:"server_time"`
	CreatedAt         time.Time          `json:"created_at"`
	UpdatedAt         time.Time          `json:"updated_at"`

	Warnings []wire.Blocker `json:"-"`
}

// ETag is W/"<version>" (API_SPEC §1.6).
func (v *View) ETag() string { return `W/"` + strconv.Itoa(v.Version) + `"` }

// ParseIfMatch reads W/"14", "14" or 14.
func ParseIfMatch(h string) (int, bool) {
	h = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(h), "W/"))
	h = strings.Trim(h, `"`)
	n, err := strconv.Atoi(h)
	return n, err == nil && n >= 0
}

var caseFlags = map[string]bool{"helper_linked": true, "for_minor_family_member": true, "deleted_pending": true, "remedial_training_ack": true}

var factKeys = map[string]bool{"aadhaar_address_matches_residence": true, "aadhaar_has_relation_line": true, "aadhaar_mobile_linked": true,
	"home_test_device": true, "has_test_vehicle": true, "holds_foreign_licence": true, "moving_state": true, "nri": true, "disability_needs": true}

var validClassCodes = map[string]bool{"MC50CC": true, "MCWOG": true, "MCWG": true, "LMV-NT": true, "LMV-TR": true, "E-RICKSHAW": true, "E-CART": true,
	"MGV": true, "HGMV": true, "HPMV": true, "HTV": true, "ADAPTED": true}

func codes(in []string) []string {
	out := []string{}
	for _, c := range in {
		if validClassCodes[c] {
			out = append(out, c)
		}
	}
	return out
}

// view renders a snapshot (derived per request; server time only, EC-15).
func (s *Service) view(sn *Snapshot, now time.Time, t *tenant.Tenant) *View {
	today := rules.TodayIST(now)
	c := sn.Case
	kd := c.KeyDates
	vin := journey.ViewInput{State: journey.State(c.State), Today: today, DLTestUnlock: parseDate(kd["dl_test_unlock"]), SlotDate: parseDate(kd["slot_date"]),
		PassedOn: parseDate(kd["passed_on"]), DLIssuedOn: parseDate(kd["dl_issued_on"]), DOBYearOnly: deref(c.DOBPrecision) == "year_only",
		RulesChanged: sn.Pack != nil && c.RulePackVersion != sn.Pack.Version}
	if sn.LL != nil {
		vin.LLExpiresOn = parseDate(sn.LL.ExpiresOn)
	}
	if d := parseDate(kd["payment_pending_on"]); d != nil && d.Before(today) {
		vin.PaymentPendingLong = true
	}
	if t != nil && t.Adapters.Sarathi != nil && t.Adapters.Sarathi.Health(context.Background()).Status == "down" {
		vin.SarathiDown = true
	}
	d := journey.Derive(vin)
	v := &View{CaseID: sn.Ref, Tenant: c.TenantID, State: c.State, Stage: d.Stage, DisplayStage: d.DisplayStage, Alerts: d.Alerts, Path: c.Path,
		Classes: []ClassOut{}, Answers: c.Answers, KeyDates: map[string]*string{}, RulePackVersion: c.RulePackVersion, Version: c.Version,
		Flags: []string{}, ForFamilyMember: c.FamilyMemberID != nil, Facts: map[string]any{}, ServerTime: now.UTC(),
		CreatedAt: c.CreatedAt.UTC(), UpdatedAt: c.UpdatedAt.UTC(), Warnings: []wire.Blocker{}}
	v.NextAction = NextActionOut{ActionID: d.Next.ActionID, Stage: d.Next.Stage, TitleKey: d.Next.TitleKey, DeepLink: d.Next.DeepLink}
	if d.Next.DueOn != nil {
		at := istAt(*d.Next.DueOn, 0, 0)
		v.NextAction.DueAt = &at
	}
	if c.FamilyMemberID != nil {
		fid := ids.Encode(ids.FamilyMember, *c.FamilyMemberID)
		v.FamilyMemberID = &fid
	}
	for _, f := range c.Flags {
		if caseFlags[f] {
			v.Flags = append(v.Flags, f)
		}
	}
	for k, val := range c.Facts {
		if factKeys[k] {
			v.Facts[k] = val
		}
	}
	for _, cs := range sn.Classes {
		v.Classes = append(v.Classes, ClassOut{ClassCode: cs.ClassCode, Status: cs.Status, Attempts: cs.Attempts})
	}
	if len(v.Classes) == 0 {
		for _, code := range c.Classes {
			v.Classes = append(v.Classes, ClassOut{ClassCode: code, Status: "planned"})
		}
	}
	for k, val := range kd {
		if parseDate(val) != nil {
			x := val
			v.KeyDates[k] = &x
		}
	}
	if sn.LL != nil {
		v.LL = &LLOut{IssuedOn: sn.LL.IssuedOn, ExpiresOn: sn.LL.ExpiresOn, Classes: codes(sn.LL.Classes), Source: sn.LL.Source}
		if len(sn.LL.NumberLast4Enc) > 0 {
			if l4, err := s.Vault.DecryptString(c.TenantID, "ll_mirrors.number_last4", sn.LL.NumberLast4Enc); err == nil {
				v.LL.NumberLast4 = l4
			}
		}
	}
	if sn.DL != nil {
		v.DL = &DLOut{IssuedOn: sn.DL.IssuedOn, ValidToNonTransport: sn.DL.ValidToNT, ValidToTransport: sn.DL.ValidToTR, Classes: codes(sn.DL.Classes),
			RenewalWindowOpens: sn.DL.RenewalWindowOpens, Source: sn.DL.Source}
		if len(sn.DL.NumberLast4Enc) > 0 {
			if l4, err := s.Vault.DecryptString(c.TenantID, "dl_mirrors.number_last4", sn.DL.NumberLast4Enc); err == nil {
				v.DL.NumberLast4 = l4
			}
		}
	}
	if sn.Quote != nil && sn.Pack != nil {
		q := sn.Pack.FeeQuote(sn.Quote.Classes)
		wq := wire.Quote(q, ids.Encode(ids.Quote, sn.Quote.ID), sn.Quote.RulePackVersion)
		v.Fees = &wq
	}
	if c.AppStatus != nil {
		v.ApplicationStatus = c.AppStatus
	}
	if res := s.evaluate(sn, today); res != nil {
		v.Warnings = append(wire.Issues(res.Blockers, sn.Pack.Version), wire.Issues(res.Warnings, sn.Pack.Version)...)
	}
	return v
}

// ---- Blockers (API-13, MD-106) ----------------------------------------------------------------

// BlockersView is the API-13 response.
type BlockersView struct {
	CaseID          string         `json:"case_id"`
	RulePackVersion string         `json:"rule_pack_version"`
	Status          string         `json:"status"`
	UnknownInputs   []string       `json:"unknown_inputs"`
	Blockers        []wire.Blocker `json:"blockers"`
	Notices         []wire.Blocker `json:"notices"`
}

// Blockers evaluates every blocker / warning / notice row against the case. Unknown inputs give
// "we can't tell yet", never "no blockers" (MD-106).
func (s *Service) Blockers(ctx context.Context, p *accounts.Principal, t *tenant.Tenant, caseRef string) (*BlockersView, error) {
	id, err := decodeRef(caseRef)
	if err != nil {
		return nil, err
	}
	var out *BlockersView
	err = s.DB.Tenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		sn, err := s.load(ctx, tx, p, id, false)
		if err != nil {
			return err
		}
		today := rules.TodayIST(s.now())
		out = &BlockersView{CaseID: sn.Ref, RulePackVersion: sn.Case.RulePackVersion, UnknownInputs: []string{}, Blockers: []wire.Blocker{}, Notices: []wire.Blocker{}}
		if sn.DOB == nil {
			out.UnknownInputs = append(out.UnknownInputs, "dob")
		}
		for _, k := range []string{"aadhaar_address_matches_residence", "aadhaar_has_relation_line"} {
			if _, ok := sn.Case.Facts[k].(bool); !ok {
				out.UnknownInputs = append(out.UnknownInputs, k)
			}
		}
		if deref(sn.Case.Path) != "non_aadhaar_rto" {
			if _, ok := sn.Case.Facts["aadhaar_mobile_linked"].(bool); !ok {
				out.UnknownInputs = append(out.UnknownInputs, "aadhaar_mobile_linked")
			}
		}
		if res := s.evaluate(sn, today); res != nil {
			out.Blockers = append(wire.Issues(res.Blockers, sn.Pack.Version), wire.Issues(res.Warnings, sn.Pack.Version)...)
			out.Notices = wire.Issues(res.Notices, sn.Pack.Version)
		}
		switch {
		case len(out.Blockers) > 0:
			out.Status = "has_blockers"
		case len(out.UnknownInputs) > 0:
			out.Status = "cant_tell_yet"
		default:
			out.Status = "no_blockers"
		}
		return nil
	})
	return out, err
}

// ---- Timeline (API-14) -----------------------------------------------------------------------

// TimelineItem is E-12 on the wire.
type TimelineItem struct {
	EventID        string     `json:"event_id"`
	Kind           string     `json:"kind"`
	Code           string     `json:"code"`
	OccurredAt     *time.Time `json:"occurred_at,omitempty"`
	DueAt          *time.Time `json:"due_at,omitempty"`
	Status         string     `json:"status"`
	Source         string     `json:"source,omitempty"`
	RuleID         string     `json:"rule_id,omitempty"`
	IdempotencyKey string     `json:"idempotency_key,omitempty"`
	sortAt         time.Time
}

// TimelinePage is the API-14 response.
type TimelinePage struct {
	ServerTime time.Time      `json:"server_time"`
	Items      []TimelineItem `json:"items"`
	NextCursor *string        `json:"next_cursor"`
}

var sourceOf = map[string]string{"applicant": "user", "helper": "helper", "system": "system", "adapter": "adapter", "admin": "system"}

// Timeline lists facts from the event store and the scheduled milestones, by date.
func (s *Service) Timeline(ctx context.Context, p *accounts.Principal, t *tenant.Tenant, caseRef, cursor string, limit int) (*TimelinePage, error) {
	id, err := decodeRef(caseRef)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := 0
	if cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || !strings.HasPrefix(string(raw), "o:") {
			return nil, &ValidationError{Pointer: "/cursor", Code: "invalid_cursor"}
		}
		if offset, err = strconv.Atoi(strings.TrimPrefix(string(raw), "o:")); err != nil || offset < 0 {
			return nil, &ValidationError{Pointer: "/cursor", Code: "invalid_cursor"}
		}
	}
	now := s.now()
	var items []TimelineItem
	err = s.DB.Tenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		sn, err := s.load(ctx, tx, p, id, true)
		if err != nil {
			return err
		}
		if _, _, err := s.settle(ctx, tx, sn, now, systemActor); err != nil {
			return err
		}
		events, err := store.ListCaseEvents(ctx, tx, id)
		if err != nil {
			return err
		}
		for _, e := range events {
			at := e.RecordedAt.UTC()
			if d := parseDate(deref(e.OccurredOn)); d != nil {
				at = istAt(*d, 0, 0)
			}
			eid := ids.Encode(ids.Timeline, ids.Deterministic(fmt.Sprintf("fact:%s:%d", sn.Ref, e.Seq)))
			items = append(items, TimelineItem{EventID: eid, Kind: "fact", Code: strings.ToUpper(e.Type), OccurredAt: &at, Status: "done",
				Source: sourceOf[e.ActorKind], sortAt: at})
		}
		rows, err := store.ListTimeline(ctx, tx, id)
		if err != nil {
			return err
		}
		for _, r := range rows {
			it := TimelineItem{EventID: ids.Encode(ids.Timeline, r.ID), Kind: r.Kind, Code: r.Code, Status: r.Status, Source: "system",
				IdempotencyKey: r.IdempotencyKey, DueAt: r.DueAt}
			if r.RuleID != nil {
				it.RuleID = *r.RuleID
			}
			if r.DueAt != nil {
				d := r.DueAt.UTC()
				it.DueAt, it.sortAt = &d, d
			}
			items = append(items, it)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].sortAt.Before(items[j].sortAt) })
	page := &TimelinePage{ServerTime: now.UTC(), Items: []TimelineItem{}}
	if offset < len(items) {
		end := offset + limit
		if end > len(items) {
			end = len(items)
		}
		page.Items = items[offset:end]
		if end < len(items) {
			c := base64.RawURLEncoding.EncodeToString([]byte("o:" + strconv.Itoa(end)))
			page.NextCursor = &c
		}
	}
	return page, nil
}

// ---- Delete (API-17, EC-26) ----------------------------------------------------------------

// Delete soft-deletes a case, cancels its scheduled timeline rows and queued notifications.
func (s *Service) Delete(ctx context.Context, p *accounts.Principal, t *tenant.Tenant, caseRef string) error {
	id, err := decodeRef(caseRef)
	if err != nil {
		return err
	}
	return s.DB.Tenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		c, err := store.GetCase(ctx, tx, id)
		if errors.Is(err, store.ErrNotFound) || (err == nil && c.ApplicantID != p.ApplicantID) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		n, err := store.CancelScheduledTimeline(ctx, tx, id)
		if err != nil {
			return err
		}
		m, err := store.CancelQueuedNotifications(ctx, tx, c.ApplicantID, &id)
		if err != nil {
			return err
		}
		if _, err := store.SoftDeleteCase(ctx, tx, id); err != nil {
			return err
		}
		sn := &Snapshot{Case: c, Ref: ref(id)}
		return s.auditCase(ctx, tx, sn, actor{kind: "applicant", subject: p.Subject(), scope: p.Scope}, "case.deleted",
			map[string]any{"timeline_cancelled": n, "notifications_cancelled": m})
	})
}

// ---- My Licence (MD-124) ---------------------------------------------------------------------

// LicenceItem is one case on the My Licence tab.
type LicenceItem struct {
	CaseID            string             `json:"case_id"`
	State             string             `json:"state"`
	ForFamilyMember   bool               `json:"for_family_member"`
	LL                *LLOut             `json:"ll"`
	DL                *DLOut             `json:"dl"`
	LLValid           bool               `json:"ll_valid"`
	DaysToLLExpiry    *int               `json:"days_to_ll_expiry"`
	RenewalWindowOpen bool               `json:"renewal_window_open"`
	DigiLockerPointer *string            `json:"digilocker_pointer"`
	KeyDates          map[string]*string `json:"key_dates"`
}

// MyLicences is the MD-124 response.
type MyLicences struct {
	ServerTime       time.Time     `json:"server_time"`
	ShowDLHolderView bool          `json:"show_dl_holder_view"`
	Items            []LicenceItem `json:"items"`
}

// Licences lists the LL / DL mirrors of every open case of the account (family members whose
// parental consent is missing are skipped).
func (s *Service) Licences(ctx context.Context, p *accounts.Principal, t *tenant.Tenant) (*MyLicences, error) {
	now := s.now()
	today := rules.TodayIST(now)
	out := &MyLicences{ServerTime: now.UTC(), Items: []LicenceItem{}}
	err := s.DB.Tenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		refs, err := store.OpenCasesFor(ctx, tx, p.ApplicantID)
		if err != nil {
			return err
		}
		for _, r := range refs {
			sn, err := s.load(ctx, tx, p, r.ID, true)
			if errors.Is(err, ErrParentConsent) || errors.Is(err, ErrRulesMissing) {
				continue
			}
			if err != nil {
				return err
			}
			if _, _, err := s.settle(ctx, tx, sn, now, systemActor); err != nil {
				return err
			}
			v := s.view(sn, now, t)
			it := LicenceItem{CaseID: v.CaseID, State: v.State, ForFamilyMember: v.ForFamilyMember, LL: v.LL, DL: v.DL, KeyDates: v.KeyDates}
			if sn.LL != nil {
				if exp := parseDate(sn.LL.ExpiresOn); exp != nil {
					days := today.DaysUntil(*exp)
					it.DaysToLLExpiry = &days
					it.LLValid = days >= 0 && journey.LLLive(journey.State(sn.Case.State))
				}
			}
			if sn.DL != nil {
				out.ShowDLHolderView = true
				if sn.DL.RenewalWindowOpens != nil {
					if rw := parseDate(*sn.DL.RenewalWindowOpens); rw != nil && !today.Before(*rw) {
						it.RenewalWindowOpen = true
					}
				}
				ptr := "DigiLocker > Issued documents > Driving Licence (pointer only; Margdarshak never stores the document)"
				it.DigiLockerPointer = &ptr
			}
			out.Items = append(out.Items, it)
		}
		return nil
	})
	return out, err
}
