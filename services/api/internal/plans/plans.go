// Package plans implements the plan and rules endpoints (MD-102, API-01..05): the 3-tap licence
// plan with the smart class planner (MD-105, F-03) and the blocker rows (MD-106, F-04), the class
// catalogue, the fee table and the LL test format. Every value comes from the authoritative rules
// engine (internal/rules) and carries its rule ID and provenance; nothing is computed by AI.
//
// Plans are anonymous snapshots: inputs are kept 7 days, the DOB only encrypted (so a case can be
// opened from the plan), nothing else personal (MD-102).
package plans

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/domain/age"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/rulekit"
	"github.com/sruj08/margadarshak/services/api/internal/rules"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/wire"
)

// SnapshotTTL is the life of a plan snapshot (API-01: 7-day plan snapshot).
const SnapshotTTL = 7 * 24 * time.Hour

// Errors.
var (
	ErrNoRules     = errors.New("plans: rule packs not loaded")
	ErrUnknownPack = errors.New("plans: no rule pack for this state")
	ErrNotFound    = errors.New("plans: plan not found or expired")
)

// InputError points at an invalid request field.
type InputError struct {
	Pointer, Code string
}

func (e *InputError) Error() string { return "plans: " + e.Pointer + " " + e.Code }

// Request is the API-01 input.
type Request struct {
	State                          string
	DOB                            *time.Time // IST date
	DOBPrecision                   string     // day | year_only
	AgeYears                       *int
	Vehicles                       []string
	Classes                        []string
	AadhaarAddressMatchesResidence *bool
	AadhaarHasRelationLine         *bool
	AadhaarMobileLinked            *bool
	HomeTestDevice                 *bool
	HasTestVehicle                 *bool
	LLIssuedOn                     *time.Time
	HoldsDL                        bool
	ForeignLicence                 bool
	MovingState                    bool
	NRI                            bool
	Disability                     []string
	Language                       string
}

// Service computes plans.
type Service struct {
	DB    *store.DB
	Vault *privacy.Vault
	Clock servertime.Clock
	Rules *rules.Library
	Log   *slog.Logger
}

// Pack returns the compiled pack of a state.
func (s *Service) Pack(state string) (*rules.Compiled, error) {
	if s.Rules == nil {
		return nil, ErrNoRules
	}
	c, ok := s.Rules.Pack(strings.ToUpper(state))
	if !ok {
		return nil, ErrUnknownPack
	}
	return c, nil
}

// EngineInput builds the engine input for a plan request on the IST date asOf.
func EngineInput(req Request, asOf rules.Date) (rules.Input, error) {
	in := rules.Input{AsOf: asOf.String(), State: req.State, DOBPrecision: rulekit.Precision(req.DOBPrecision),
		AadhaarAddressMatchesResidence: req.AadhaarAddressMatchesResidence, AadhaarHasRelationLine: req.AadhaarHasRelationLine,
		AadhaarMobileLinked: req.AadhaarMobileLinked, HomeTestDevice: req.HomeTestDevice, HasTestVehicle: req.HasTestVehicle,
		HoldsDL: req.HoldsDL, ForeignLicence: req.ForeignLicence, MovingState: req.MovingState, NRI: req.NRI}
	switch {
	case req.DOB != nil:
		in.DOB = req.DOB.Format(time.DateOnly)
		if in.DOBPrecision == "year" {
			in.DOB = req.DOB.Format("2006")
		}
	case req.AgeYears != nil:
		// Age in whole years only: the latest DOB with that age today (conservative for minimum
		// ages; the plan says the dates firm up with the full DOB).
		y, m, d := asOf.YMD()
		dob := rules.DateFromYMD(y-*req.AgeYears, m, d)
		in.DOB, in.DOBPrecision = dob.String(), "day"
	default:
		return in, &InputError{Pointer: "/dob", Code: "required"}
	}
	for _, v := range req.Vehicles {
		in.Vehicles = append(in.Vehicles, rulekit.Vehicle(v))
	}
	in.Classes = append(in.Classes, req.Classes...)
	if len(in.Vehicles) == 0 && len(in.Classes) == 0 {
		return in, &InputError{Pointer: "/vehicles", Code: "required"}
	}
	for _, d := range req.Disability {
		in.Disability = append(in.Disability, rulekit.Disability(d))
	}
	if req.LLIssuedOn != nil {
		v := req.LLIssuedOn.Format(time.DateOnly)
		in.LLIssuedOn = &v
	}
	return in, nil
}

// MapEngineError turns an engine input error into an InputError.
func MapEngineError(err error) error {
	var ie *rules.InputError
	if errors.As(err, &ie) {
		ptr := "/" + ie.Field
		switch ie.Field {
		case "ll_issued_on", "lmv_dl_held_since":
		case "disability":
			ptr = "/disability_needs"
		}
		return &InputError{Pointer: ptr, Code: strings.ToLower(ie.Code)}
	}
	return err
}

// Compute evaluates, stores the snapshot (and its fee quote) and returns the API-01 plan.
func (s *Service) Compute(ctx context.Context, tenant string, applicant *uuid.UUID, req Request) (map[string]any, error) {
	c, err := s.Pack(req.State)
	if err != nil {
		return nil, err
	}
	now := s.Clock.Now()
	asOf := rules.TodayIST(now)
	in, err := EngineInput(req, asOf)
	if err != nil {
		return nil, err
	}
	res, err := c.Plan(in)
	if err != nil {
		return nil, MapEngineError(err)
	}
	planID := ids.New()
	quoteID := ids.New()
	// The response is the engine's Plan as is (same JSON as packages/rules and tests/golden),
	// plus the snapshot fields.
	engine, err := json.Marshal(res)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if err := json.Unmarshal(engine, &out); err != nil {
		return nil, err
	}
	qref := ids.Encode(ids.Quote, quoteID)
	out["plan_id"], out["quote_id"], out["expires_at"] = ids.Encode(ids.Plan, planID), qref, now.Add(SnapshotTTL).UTC().Format(time.RFC3339)
	if f, ok := out["fees"].(map[string]any); ok {
		f["quote_id"] = qref
	}
	ageBand := ""
	if req.DOB != nil {
		if a, err := age.Assess(*req.DOB, age.Precision(precisionOr(req.DOBPrecision)), servertime.TodayIST(now)); err == nil {
			ageBand = string(a.Band)
		}
	} else if req.AgeYears != nil {
		ageBand = string(age.BandFor(*req.AgeYears))
	}
	if ageBand != "" {
		out["age_band"] = ageBand
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	snap := &store.Plan{ID: planID, TenantID: tenant, ApplicantID: applicant, State: c.PackID, Request: snapshotRequest(req),
		RulePackVersion: c.Version, Result: raw, CreatedAt: now, ExpiresAt: now.Add(SnapshotTTL)}
	if ageBand != "" {
		snap.AgeBand = &ageBand
	}
	if req.DOB != nil {
		p := precisionOr(req.DOBPrecision)
		snap.DOBPrecision = &p
		if snap.DOBEnc, err = s.Vault.EncryptString(tenant, "plans.dob", req.DOB.Format(time.DateOnly)); err != nil {
			return nil, err
		}
	}
	fq := res.Fees
	if fq == nil {
		q := c.FeeQuote(res.RequestedClasses)
		fq = &q
	}
	wq := wire.Quote(*fq, qref, c.Version)
	lines, _ := json.Marshal(wq.Lines)
	exp := now.Add(SnapshotTTL)
	quote := &store.FeeQuote{ID: quoteID, TenantID: tenant, PlanID: &planID, State: c.PackID, RulePackVersion: c.Version, Classes: fq.Classes,
		Lines: lines, LLStagePaise: fq.LLStagePaise, SubtotalGovtFeePaise: fq.SubtotalGovtFeePaise, TotalPaise: fq.TotalPaise, Excludes: wq.Excludes,
		CreatedAt: now, ExpiresAt: &exp}
	err = s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		if err := store.InsertPlan(ctx, tx, snap); err != nil {
			return err
		}
		return store.InsertFeeQuote(ctx, tx, quote)
	})
	if err != nil {
		return nil, err
	}
	_ = s.DB.System(ctx, func(tx pgx.Tx) error { return store.IncrementCounter(ctx, tx, tenant, "plans_computed", 1) })
	return out, nil
}

func precisionOr(p string) string {
	if p == "year_only" || p == "year" {
		return "year_only"
	}
	return "day"
}

// snapshotRequest keeps only non-personal inputs (no DOB, no age).
func snapshotRequest(r Request) map[string]any {
	m := map[string]any{"state": r.State, "dob_precision": precisionOr(r.DOBPrecision), "has_dob": r.DOB != nil, "vehicles": r.Vehicles,
		"classes": r.Classes, "holds_dl": r.HoldsDL, "holds_foreign_licence": r.ForeignLicence, "moving_state": r.MovingState, "nri": r.NRI,
		"disability_needs": r.Disability, "language": r.Language, "already_holds_ll": r.LLIssuedOn != nil}
	for k, v := range map[string]*bool{"address_matches_residence": r.AadhaarAddressMatchesResidence, "relation_line_present": r.AadhaarHasRelationLine,
		"mobile_linked": r.AadhaarMobileLinked, "home_test_device": r.HomeTestDevice, "has_test_vehicle": r.HasTestVehicle} {
		if v != nil {
			m[k] = *v
		}
	}
	return m
}

// Snapshot is a stored plan with its encrypted inputs (for opening a case from it).
type Snapshot struct {
	Plan         map[string]any
	State        string
	DOB          *time.Time
	DOBPrecision string
	Facts        map[string]any
	Request      map[string]any
}

// Get loads an unexpired plan snapshot.
func (s *Service) Get(ctx context.Context, tenant string, planRef string) (*Snapshot, error) {
	id, err := ids.Decode(ids.Plan, planRef)
	if err != nil {
		return nil, ErrNotFound
	}
	var p *store.Plan
	err = s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		var err error
		p, err = store.GetPlan(ctx, tx, id, s.Clock.Now())
		return err
	})
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if err := json.Unmarshal(p.Result, &out); err != nil {
		return nil, err
	}
	snap := &Snapshot{Plan: out, State: p.State, Request: p.Request, Facts: map[string]any{}}
	if p.DOBPrecision != nil {
		snap.DOBPrecision = *p.DOBPrecision
	}
	if len(p.DOBEnc) > 0 {
		v, err := s.Vault.DecryptString(tenant, "plans.dob", p.DOBEnc)
		if err != nil {
			return nil, err
		}
		if d, err := time.ParseInLocation(time.DateOnly, v, servertime.IST); err == nil {
			snap.DOB = &d
		}
	}
	for planKey, factKey := range map[string]string{"address_matches_residence": "aadhaar_address_matches_residence",
		"relation_line_present": "aadhaar_has_relation_line", "mobile_linked": "aadhaar_mobile_linked", "home_test_device": "home_test_device",
		"has_test_vehicle": "has_test_vehicle", "holds_foreign_licence": "holds_foreign_licence", "moving_state": "moving_state", "nri": "nri"} {
		if v, ok := p.Request[planKey].(bool); ok {
			snap.Facts[factKey] = v
		}
	}
	if d, ok := p.Request["disability_needs"].([]any); ok && len(d) > 0 {
		snap.Facts["disability_needs"] = d
	}
	return snap, nil
}

// ---- API-02 classes -------------------------------------------------------------------------

// ClassEntry is one ClassCatalogue row.
type ClassEntry struct {
	ClassCode               string          `json:"class_code"`
	LabelKey                string          `json:"label_key"`
	MinAgeYears             int             `json:"min_age_years"`
	GuardianConsentRequired bool            `json:"guardian_consent_required"`
	MedicalForm1A           string          `json:"medical_form_1a"`
	Transport               bool            `json:"transport"`
	ContentDepth            string          `json:"content_depth"`
	RuleID                  string          `json:"rule_id"`
	Flags                   []string        `json:"flags"`
	Provenance              wire.Provenance `json:"provenance"`
}

// RulePackRef is the pack a response was computed with.
type RulePackRef struct {
	PackID      string `json:"pack_id"`
	Version     string `json:"version"`
	BaseVersion string `json:"base_version,omitempty"`
}

// PackRef returns the ref of a compiled pack.
func PackRef(c *rules.Compiled) RulePackRef {
	return RulePackRef{PackID: c.PackID, Version: c.Version, BaseVersion: c.BaseVersion}
}

// ProvOf converts a pack row's provenance to the engine's output shape.
func ProvOf(p rules.Provenance) rules.ProvOut {
	return rules.ProvOut{SourceTitle: p.Source.Title, SourceURL: p.Source.URL, Grade: p.Grade, CheckedOn: p.CheckedOn, Confidence: p.Confidence, Verified: p.Verified}
}

// Classes lists every class of the pack (D-05: all classes are in the engine).
func Classes(c *rules.Compiled) []ClassEntry {
	out := []ClassEntry{}
	for _, cr := range c.Classes.Classes {
		e := ClassEntry{ClassCode: cr.Code, LabelKey: cr.NameKey, MinAgeYears: cr.MinAge, GuardianConsentRequired: cr.GuardianConsentUnder18,
			Transport: cr.Transport, ContentDepth: cr.ContentDepth, RuleID: cr.ID, Flags: []string{}, Provenance: wire.Prov(ProvOf(cr.Provenance), c.Version)}
		switch cr.Form1A {
		case "always":
			e.MedicalForm1A = "always"
		case "age40":
			e.MedicalForm1A = "over_40"
		default:
			e.MedicalForm1A = "never"
		}
		verify := !cr.Verified || cr.Confidence == "low"
		for _, p := range cr.Prerequisites {
			if !p.Verified {
				verify = true
				if cr.Transport {
					e.Flags = append(e.Flags, "lmv_prerequisite_unverified")
				}
			}
		}
		if verify {
			e.Flags = append([]string{"verify_at_rto"}, e.Flags...)
		}
		switch e.ContentDepth {
		case "deep", "thin", "coming":
		default:
			e.ContentDepth = "coming"
		}
		out = append(out, e)
	}
	return out
}

// ETag is the pack digest used for API-02/03/05 caching.
func ETag(c *rules.Compiled, extra string) string {
	sum := sha256.Sum256([]byte(c.Hash + "|" + c.Version + "|" + extra))
	return `W/"` + hex.EncodeToString(sum[:8]) + `"`
}

// ---- API-03 fees ----------------------------------------------------------------------------

// FeeItem is one FeeTable row.
type FeeItem struct {
	FeeID       string `json:"fee_id"`
	Per         string `json:"per"`
	AmountPaise int64  `json:"amount_paise"`
	RuleID      string `json:"rule_id"`
	LabelKey    string `json:"label_key,omitempty"`
	Stage       string `json:"stage,omitempty"`
}

func feeID(id string) string {
	return strings.ReplaceAll(strings.ToLower(strings.TrimPrefix(id, "FEE-")), "-", "_")
}

// FeeItems lists the effective fee heads (state overrides applied) and the retest heads.
func FeeItems(c *rules.Compiled) []FeeItem {
	out := []FeeItem{}
	for _, it := range c.Fees.Items {
		chosen := it
		for _, st := range c.Fees.StateItems {
			if st.State == c.PackID && st.Overrides == it.ID {
				chosen = st
			}
		}
		out = append(out, FeeItem{FeeID: feeID(chosen.ID), Per: chosen.Per, AmountPaise: chosen.Amount, RuleID: chosen.ID, LabelKey: chosen.LabelKey, Stage: chosen.Stage})
	}
	for _, r := range c.Fees.Retest {
		out = append(out, FeeItem{FeeID: feeID(r.ID), Per: r.Per, AmountPaise: r.Amount, RuleID: r.ID, LabelKey: r.LabelKey, Stage: r.Stage})
	}
	return out
}

// QuoteID is a deterministic ID for an unstored quote (API-03 look-ups).
func QuoteID(c *rules.Compiled, classes []string) string {
	sorted := append([]string(nil), classes...)
	sort.Strings(sorted)
	return ids.Encode(ids.Quote, ids.Deterministic("quote:"+c.PackID+":"+c.Version+":"+strings.Join(sorted, ",")))
}

// ValidClass reports whether code is a class of the pack.
func ValidClass(c *rules.Compiled, code string) bool { return rulekit.ClassRow(c, code) != nil }

// ---- API-05 LL format -----------------------------------------------------------------------

// LLFormat is the LL test format (LlFormat schema).
type LLFormat struct {
	State               string          `json:"state"`
	RuleID              string          `json:"rule_id"`
	Known               bool            `json:"known"`
	Questions           *int64          `json:"questions"`
	PassCorrect         *int64          `json:"pass_correct"`
	PassPct             *int64          `json:"pass_pct"`
	PerQuestionTimerS   *int64          `json:"per_question_timer_s"`
	TotalTimerS         *int64          `json:"total_timer_s"`
	OnlineTestAvailable bool            `json:"online_test_available"`
	Where               []string        `json:"where"`
	Languages           []string        `json:"languages"`
	Provenance          wire.Provenance `json:"provenance"`
}

func i64(v any) *int64 {
	switch n := v.(type) {
	case int64:
		return &n
	case int:
		x := int64(n)
		return &x
	}
	return nil
}

// Format reads PRM-LL-FORMAT and PRM-LL-TEST-MODE (EC-10: online_test_available).
func Format(c *rules.Compiled, languages []string) LLFormat {
	fv, fr := rulekit.Param(c, "PRM-LL-FORMAT")
	tv, _ := rulekit.Param(c, "PRM-LL-TEST-MODE")
	f, _ := fv.(map[string]any)
	m, _ := tv.(map[string]any)
	out := LLFormat{State: c.PackID, Where: []string{}, Languages: languages}
	if fr != nil {
		out.RuleID = fr.ID
		out.Provenance = wire.Prov(ProvOf(fr.Provenance), c.Version)
	}
	out.Known, _ = f["known"].(bool)
	out.Questions, out.PassCorrect, out.PassPct, out.TotalTimerS = i64(f["questions"]), i64(f["passCorrect"]), i64(f["passPct"]), i64(f["timerSeconds"])
	out.OnlineTestAvailable, _ = m["onlineAvailable"].(bool)
	if w, ok := m["where"].([]any); ok {
		for _, x := range w {
			if s, ok := x.(string); ok && (s == "home_online" || s == "csc" || s == "rto") {
				out.Where = append(out.Where, s)
			}
		}
	}
	if len(out.Languages) == 0 {
		out.Languages = []string{"en", "hi"}
	}
	return out
}
