// Package cases is the case application service (MD-109, MD-117, MD-121, MD-124, MD-125,
// MD-114/116, API-10..17, API-19). It owns the one writer path of the case event store
// (DATA_MODEL §5): every change appends an event, updates the projection (core.cases, class
// selections, licence mirrors) and recomputes the timeline in the same transaction. Decisions
// come from the pure journey machine (internal/journey) and the rules engine (internal/rules);
// time comes only from the server clock in IST (EC-15).
package cases

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/journey"
	"github.com/sruj08/margadarshak/services/api/internal/plans"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/rules"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/tenant"
)

// Errors mapped to problem+json by the HTTP layer.
var (
	ErrNotFound      = errors.New("cases: not found")
	ErrPrecondition  = errors.New("cases: edited elsewhere (If-Match)")
	ErrRulesMissing  = errors.New("cases: rule pack not loaded")
	ErrParentConsent = privacy.ErrParentalConsentRequired
)

// ValidationError is a 422 with a JSON pointer.
type ValidationError struct {
	Pointer, Code, Detail string
}

func (e *ValidationError) Error() string { return "cases: invalid " + e.Pointer + ": " + e.Code }

// ConflictError is a 409 (journey transition, duplicate case, stale quote, payment pending).
type ConflictError struct {
	Code, Detail, Pointer, Reason string
}

func (e *ConflictError) Error() string { return "cases: " + e.Code + ": " + e.Detail }

// EventNotice is sent after commit for the W02 real-time milestone messages.
type EventNotice struct {
	Tenant      string
	CaseID      uuid.UUID
	CaseRef     string
	ApplicantID uuid.UUID
	Event       string
	Seq         int
	Minor       bool
}

// Service is the case service.
type Service struct {
	DB            *store.DB
	Vault         *privacy.Vault
	Clock         servertime.Clock
	Rules         *rules.Library
	Plans         *plans.Service
	Log           *slog.Logger
	WebBaseURL    string
	PublicBaseURL string
	// OnEvent receives client events after commit (transactional notifications, W02).
	OnEvent func(ctx context.Context, n EventNotice)
}

func (s *Service) now() time.Time { return s.Clock.Now() }

// Snapshot is a loaded case with its projections.
type Snapshot struct {
	Case    *store.Case
	Ref     string
	LL      *store.LLMirror
	DL      *store.DLMirror
	Classes []store.ClassSelection
	Quote   *store.FeeQuote
	Pack    *rules.Compiled
	DOB     *time.Time
	Member  *store.FamilyMember
	dirty   bool
}

// IsMinor reports whether the case is a minor family member's (family mode, D-13 revised).
func (sn *Snapshot) IsMinor() bool { return sn.Member != nil && sn.Member.IsMinor }

func ref(id uuid.UUID) string { return ids.Encode(ids.Case, id) }

// decodeRef parses a cas_ id.
func decodeRef(caseRef string) (uuid.UUID, error) {
	id, err := ids.Decode(ids.Case, caseRef)
	if err != nil {
		return uuid.Nil, ErrNotFound
	}
	return id, nil
}

func (s *Service) pack(state string) (*rules.Compiled, error) {
	if s.Rules == nil {
		return nil, ErrRulesMissing
	}
	c, ok := s.Rules.Pack(state)
	if !ok {
		return nil, ErrRulesMissing
	}
	return c, nil
}

// load reads a case visible to the actor. Family-member cases need the recorded parental consent
// of a minor (403 PARENT_CONSENT_REQUIRED, checked on every access).
func (s *Service) load(ctx context.Context, tx pgx.Tx, p *accounts.Principal, id uuid.UUID, forUpdate bool) (*Snapshot, error) {
	var c *store.Case
	var err error
	if forUpdate {
		c, err = store.GetCaseForUpdate(ctx, tx, id)
	} else {
		c, err = store.GetCase(ctx, tx, id)
	}
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if p != nil && c.ApplicantID != p.ApplicantID {
		return nil, ErrNotFound // no existence leak
	}
	return s.hydrate(ctx, tx, c)
}

func (s *Service) hydrate(ctx context.Context, tx pgx.Tx, c *store.Case) (*Snapshot, error) {
	sn := &Snapshot{Case: c, Ref: ref(c.ID)}
	if c.FamilyMemberID != nil {
		m, err := store.GetFamilyMember(ctx, tx, c.ApplicantID, *c.FamilyMemberID)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return nil, err
		}
		if m != nil {
			sn.Member = m
			if err := privacy.RequireParentalConsent(privacy.Subject{IsMinor: m.IsMinor, ParentalConsentStatus: m.ParentalConsentStatus}); err != nil {
				return nil, err
			}
		}
	}
	var err error
	if sn.Pack, err = s.pack(c.RulePackID); err != nil {
		return nil, err
	}
	if sn.LL, err = store.GetLLMirror(ctx, tx, c.ID); err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	if sn.DL, err = store.GetDLMirror(ctx, tx, c.ID); err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	if sn.Classes, err = store.ListClassSelections(ctx, tx, c.ID); err != nil {
		return nil, err
	}
	if sn.Quote, err = store.LatestCaseQuote(ctx, tx, c.ID); err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	if len(c.DOBEnc) > 0 {
		v, err := s.Vault.DecryptString(c.TenantID, "cases.dob", c.DOBEnc)
		if err != nil {
			return nil, err
		}
		if d, err := time.ParseInLocation(time.DateOnly, v, servertime.IST); err == nil {
			sn.DOB = &d
		}
	}
	return sn, nil
}

// ---- Create (API-10) -----------------------------------------------------------------------

// LLInput is an existing LL (EC-22).
type LLInput struct {
	IssuedOn, ExpiresOn time.Time
	Classes             []string
	NumberLast4         string
}

// DLInput is an existing DL.
type DLInput struct {
	IssuedOn    *time.Time
	ValidToNT   time.Time
	ValidToTR   *time.Time
	Classes     []string
	NumberLast4 string
	Source      string
}

// CreateInput is the API-10 input.
type CreateInput struct {
	PlanRef        string
	State          string
	Classes        []string
	Path           string
	ExistingLL     *LLInput
	ExistingDL     *DLInput
	FamilyMemberID string
	Facts          map[string]any
}

var paths = map[string]bool{"aadhaar_contactless": true, "non_aadhaar_rto": true, "adtc": true}

// Create opens a case (from a plan or directly), pinning the rule-pack version.
func (s *Service) Create(ctx context.Context, p *accounts.Principal, t *tenant.Tenant, in CreateInput) (*View, error) {
	now := s.now()
	today := rules.TodayIST(now)
	state := strings.ToUpper(in.State)
	var snap *plans.Snapshot
	if in.PlanRef != "" {
		if s.Plans == nil {
			return nil, ErrRulesMissing
		}
		var err error
		snap, err = s.Plans.Get(ctx, t.TenantID, in.PlanRef)
		if errors.Is(err, plans.ErrNotFound) {
			return nil, &ValidationError{Pointer: "/plan_id", Code: "unknown_or_expired_plan"}
		}
		if err != nil {
			return nil, err
		}
		if state == "" {
			state = snap.State
		}
	}
	if state == "" {
		state = t.TenantID
	}
	pk, err := s.pack(state)
	if err != nil {
		return nil, &ValidationError{Pointer: "/state", Code: "no_rule_pack"}
	}
	classes, err := cleanClasses(pk, in.Classes)
	if err != nil {
		return nil, err
	}
	if in.Path != "" && !paths[in.Path] {
		return nil, &ValidationError{Pointer: "/path", Code: "invalid_enum"}
	}
	facts := map[string]any{}
	if snap != nil {
		for k, v := range snap.Facts {
			facts[k] = v
		}
	}
	for k, v := range in.Facts {
		if v == nil {
			delete(facts, k)
		} else {
			facts[k] = v
		}
	}
	var memberID *uuid.UUID
	var dob *time.Time
	dobPrecision := "day"
	if snap != nil && snap.DOB != nil {
		dob, dobPrecision = snap.DOB, snap.DOBPrecision
	}
	var created *View
	err = s.DB.Tenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		var member *store.FamilyMember
		if in.FamilyMemberID != "" {
			mid, err := ids.Decode(ids.FamilyMember, in.FamilyMemberID)
			if err != nil {
				return &ValidationError{Pointer: "/family_member_id", Code: "invalid"}
			}
			if err := accounts.RequireMemberAllowed(ctx, tx, p.ApplicantID, mid); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					return &ValidationError{Pointer: "/family_member_id", Code: "unknown_member"}
				}
				return err
			}
			member, _ = store.GetFamilyMember(ctx, tx, p.ApplicantID, mid)
			memberID = &mid
			if dob == nil && member != nil {
				if v, err := s.Vault.DecryptString(t.TenantID, "family_members.dob", member.DOBEnc); err == nil {
					if d, err := time.ParseInLocation(time.DateOnly, v, servertime.IST); err == nil {
						dob, dobPrecision = &d, member.DOBPrecision
					}
				}
			}
		} else if dob == nil {
			if a, err := store.GetApplicant(ctx, tx, p.ApplicantID); err == nil && len(a.DOBEnc) > 0 {
				if v, err := s.Vault.DecryptString(t.TenantID, "applicants.dob", a.DOBEnc); err == nil {
					if d, err := time.ParseInLocation(time.DateOnly, v, servertime.IST); err == nil {
						dob = &d
						if a.DOBPrecision != nil {
							dobPrecision = *a.DOBPrecision
						}
					}
				}
			}
		}
		// Eligibility now (EC-05, EC-06, EC-21): every class of one case shares one LL.
		var eligibleFrom map[string]string
		if dob != nil {
			ef, err := checkEligible(pk, dob, dobPrecision, classes, facts, today)
			if err != nil {
				return err
			}
			eligibleFrom = ef
		}
		open, err := store.OpenCasesFor(ctx, tx, p.ApplicantID)
		if err != nil {
			return err
		}
		for _, o := range open {
			if sameMember(o.FamilyMemberID, memberID) && overlaps(o.Classes, classes) && o.State != string(journey.DLHolder) && o.State != string(journey.RenewalDue) {
				return &ConflictError{Code: "CASE_EXISTS", Detail: "an open case already covers one of these classes: " + ref(o.ID)}
			}
		}
		c := &store.Case{ID: ids.New(), TenantID: t.TenantID, ApplicantID: p.ApplicantID, FamilyMemberID: memberID, State: string(journey.Plan),
			Classes: classes, Answers: map[string]any{}, RulePackID: pk.PackID, RulePackVersion: pk.Version, KeyDates: map[string]string{},
			Flags: []string{}, Facts: facts}
		if in.Path != "" {
			path := in.Path
			c.Path = &path
		}
		if snap != nil {
			if pid, err := ids.Decode(ids.Plan, in.PlanRef); err == nil {
				c.PlanID = &pid
			}
		}
		if member != nil && member.IsMinor {
			c.Flags = append(c.Flags, "for_minor_family_member")
		}
		if dob != nil {
			if c.DOBEnc, err = s.Vault.EncryptString(t.TenantID, "cases.dob", dob.Format(time.DateOnly)); err != nil {
				return err
			}
			pr := dobPrecision
			c.DOBPrecision = &pr
		}
		if err := store.InsertCase(ctx, tx, c); err != nil {
			return err
		}
		sel := make([]store.ClassSelection, 0, len(classes))
		for _, code := range classes {
			cs := store.ClassSelection{ClassCode: code, Status: "planned"}
			if d, ok := eligibleFrom[code]; ok && d != "" {
				v := d
				cs.EligibleFrom = &v
			}
			sel = append(sel, cs)
		}
		if err := store.ReplaceClassSelections(ctx, tx, t.TenantID, c.ID, sel); err != nil {
			return err
		}
		sn, err := s.hydrate(ctx, tx, c)
		if err != nil {
			return err
		}
		sn.Member = member
		act := actor{kind: "applicant", id: &p.ApplicantID, subject: p.Subject(), scope: p.Scope}
		payload := map[string]any{"classes": classes, "from_plan": snap != nil}
		if in.ExistingDL != nil {
			payload["existing_dl"] = true
		}
		if in.ExistingLL != nil {
			payload["existing_ll"] = true
		}
		if _, err := s.appendEvent(ctx, tx, sn, act, string(journey.CaseStarted), nil, payload, "case_started", now, "", ""); err != nil {
			return err
		}
		if _, err := s.writeQuote(ctx, tx, sn, now); err != nil {
			return err
		}
		if in.ExistingLL != nil {
			if date(in.ExistingLL.IssuedOn).After(today) || !in.ExistingLL.ExpiresOn.After(in.ExistingLL.IssuedOn) {
				return &ValidationError{Pointer: "/existing_ll/issued_on", Code: "invalid_dates"}
			}
			on := in.ExistingLL.IssuedOn
			ev := EventInput{Type: string(journey.LLIssued), OccurredOn: on, Classes: in.ExistingLL.Classes, NumberLast4: in.ExistingLL.NumberLast4}
			exp := rules.DateFromYMD(in.ExistingLL.ExpiresOn.Year(), int(in.ExistingLL.ExpiresOn.Month()), in.ExistingLL.ExpiresOn.Day())
			if _, err := s.applyClientEvent(ctx, tx, sn, act, ev, "existing_ll", &exp, now); err != nil {
				return err
			}
		}
		if in.ExistingDL != nil {
			if err := s.onboardDL(ctx, tx, sn, act, *in.ExistingDL, now); err != nil {
				return err
			}
		}
		if _, _, err := s.settle(ctx, tx, sn, now, act); err != nil {
			return err
		}
		if err := s.auditCase(ctx, tx, sn, act, "case.created", map[string]any{"classes": strings.Join(classes, ","), "state": sn.Case.State,
			"for_family_member": memberID != nil, "rule_pack_version": pk.Version}); err != nil {
			return err
		}
		created = s.view(sn, now, t)
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = s.DB.System(ctx, func(tx pgx.Tx) error { return store.IncrementCounter(ctx, tx, t.TenantID, "cases_started", 1) })
	return created, nil
}

func sameMember(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func overlaps(a, b []string) bool {
	for _, x := range a {
		for _, y := range b {
			if x == y {
				return true
			}
		}
	}
	return false
}

func cleanClasses(pk *rules.Compiled, in []string) ([]string, error) {
	if len(in) == 0 || len(in) > 4 {
		return nil, &ValidationError{Pointer: "/classes", Code: "required"}
	}
	seen := map[string]bool{}
	var out []string
	for _, c := range in {
		if !plans.ValidClass(pk, c) {
			return nil, &ValidationError{Pointer: "/classes", Code: "unknown_class"}
		}
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out, nil
}

// checkEligible runs the engine for the classes on today's date. A class that is not possible
// now is refused with its eligible_from date (EC-05/06/21: it goes on a later LL).
func checkEligible(pk *rules.Compiled, dob *time.Time, precision string, classes []string, facts map[string]any, today rules.Date) (map[string]string, error) {
	in := engineInput(pk.PackID, dob, precision, classes, facts, today, nil, false)
	res, err := pk.Plan(in)
	if err != nil {
		return nil, &ValidationError{Pointer: "/classes", Code: "rules_input", Detail: err.Error()}
	}
	out := map[string]string{}
	for _, cl := range res.Classes {
		if !cl.Eligible {
			detail := "not eligible for " + cl.ClassCode
			if cl.EligibleFrom != nil {
				detail += " until " + *cl.EligibleFrom + "; open a separate case for it then"
			}
			return nil, &ValidationError{Pointer: "/classes", Code: "not_eligible_yet", Detail: detail}
		}
		if cl.EligibleFrom != nil {
			out[cl.ClassCode] = *cl.EligibleFrom
		}
	}
	return out, nil
}

// engineInput builds the rules-engine input for a case.
func engineInput(state string, dob *time.Time, precision string, classes []string, facts map[string]any, today rules.Date, llIssued *string, holdsDL bool) rules.Input {
	in := rules.Input{AsOf: today.String(), State: state, DOBPrecision: "day", Classes: append([]string{}, classes...), HoldsDL: holdsDL, LLIssuedOn: llIssued}
	if dob != nil {
		in.DOB = dob.Format(time.DateOnly)
		if precision == "year_only" {
			in.DOBPrecision, in.DOB = "year", dob.Format("2006")
		}
	}
	in.AadhaarAddressMatchesResidence = boolFact(facts, "aadhaar_address_matches_residence")
	in.AadhaarHasRelationLine = boolFact(facts, "aadhaar_has_relation_line")
	in.AadhaarMobileLinked = boolFact(facts, "aadhaar_mobile_linked")
	in.HomeTestDevice = boolFact(facts, "home_test_device")
	in.HasTestVehicle = boolFact(facts, "has_test_vehicle")
	if b := boolFact(facts, "holds_foreign_licence"); b != nil {
		in.ForeignLicence = *b
	}
	if b := boolFact(facts, "moving_state"); b != nil {
		in.MovingState = *b
	}
	if b := boolFact(facts, "nri"); b != nil {
		in.NRI = *b
	}
	if d, ok := facts["disability_needs"].([]any); ok {
		for _, x := range d {
			if v, ok := x.(string); ok {
				if v == "adapted_controls" {
					v = "locomotor"
				}
				in.Disability = append(in.Disability, v)
			}
		}
	}
	return in
}

func boolFact(f map[string]any, k string) *bool {
	if v, ok := f[k].(bool); ok {
		return &v
	}
	return nil
}

// ---- Get (API-11) ----------------------------------------------------------------------------

// Get returns a case with its derived view. Clock transitions whose dates have passed are applied
// first (server date, EC-15), so the stage is right even before the daily sweep runs.
func (s *Service) Get(ctx context.Context, p *accounts.Principal, t *tenant.Tenant, caseRef string) (*View, error) {
	id, err := decodeRef(caseRef)
	if err != nil {
		return nil, err
	}
	var out *View
	now := s.now()
	err = s.DB.Tenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		sn, err := s.load(ctx, tx, p, id, true)
		if err != nil {
			return err
		}
		s.refreshModeB(ctx, sn, t)
		if _, _, err := s.settle(ctx, tx, sn, now, systemActor); err != nil {
			return err
		}
		out = s.view(sn, now, t)
		return nil
	})
	return out, err
}

// ---- Autosave (API-12) -----------------------------------------------------------------------

// PatchInput is the API-12 merge patch.
type PatchInput struct {
	Answers    map[string]any
	HasAnswers bool
	Classes    []string
	Path       *string
	Facts      map[string]any
	// SetMember reassigns the case (only in PLAN): MemberRef is the family member (fam_...) or nil
	// for the account holder. It replaces the web's stand-in delete-and-recreate swap.
	SetMember bool
	MemberRef *string
}

// prohibitedAnswerKey mirrors core.no_prohibited_keys and the CasePatch propertyNames pattern:
// CX data and the personal-vault keys (name, relation, address) never reach the server.
func prohibitedAnswerKey(k string) bool {
	l := strings.ToLower(k)
	for _, p := range []string{"aadhaar", "aadhar", "uid", "vid", "otp", "biometric", "name", "relation", "address", "password", "captcha"} {
		if strings.HasPrefix(l, p) {
			return true
		}
	}
	return strings.Contains(l, "otp") || strings.Contains(l, "captcha") || strings.Contains(l, "password") || strings.Contains(l, "biometric") ||
		strings.Contains(l, "aadhaar_no") || strings.Contains(l, "aadhaar_num")
}

func checkAnswers(v any, ptr string) error {
	switch t := v.(type) {
	case map[string]any:
		for k, x := range t {
			p := ptr + "/" + k
			if prohibitedAnswerKey(k) {
				return &ValidationError{Pointer: p, Code: "PROHIBITED_FIELD", Detail: "personal details stay in the on-device vault; Aadhaar numbers, OTPs and passwords are never collected"}
			}
			if err := checkAnswers(x, p); err != nil {
				return err
			}
		}
	case []any:
		for i, x := range t {
			if err := checkAnswers(x, fmt.Sprintf("%s/%d", ptr, i)); err != nil {
				return err
			}
		}
	case string:
		if len(t) > 500 {
			return &ValidationError{Pointer: ptr, Code: "too_long"}
		}
		if kind, bad := privacy.FirstProhibited(t); bad {
			return &ValidationError{Pointer: ptr, Code: "PROHIBITED_FIELD", Detail: string(kind)}
		}
	}
	return nil
}

// answerFacts are the web form's answer keys for blocker facts (yes | no | not_sure). They are
// moved to the case facts (F-04) and never stored as answers, whose keys may not name Aadhaar.
var answerFacts = map[string]string{"aadhaar_address_match": "aadhaar_address_matches_residence",
	"aadhaar_relation_line": "aadhaar_has_relation_line", "mobile_linked": "aadhaar_mobile_linked"}

func liftFacts(answers map[string]any, facts *map[string]any) {
	for k, fact := range answerFacts {
		v, ok := answers[k]
		if !ok {
			continue
		}
		if *facts == nil {
			*facts = map[string]any{}
		}
		switch v {
		case "yes", true:
			(*facts)[fact] = true
		case "no", false:
			(*facts)[fact] = false
		default:
			(*facts)[fact] = nil
		}
		if k != "mobile_linked" {
			delete(answers, k)
		}
	}
}

// mergePatch applies an RFC 7396 merge patch.
func mergePatch(dst map[string]any, patch map[string]any) map[string]any {
	if dst == nil {
		dst = map[string]any{}
	}
	for k, v := range patch {
		if v == nil {
			delete(dst, k)
			continue
		}
		if pm, ok := v.(map[string]any); ok {
			cur, _ := dst[k].(map[string]any)
			dst[k] = mergePatch(cur, pm)
			continue
		}
		dst[k] = v
	}
	return dst
}

// Autosave applies a merge patch with optimistic concurrency (If-Match = case version).
func (s *Service) Autosave(ctx context.Context, p *accounts.Principal, t *tenant.Tenant, caseRef string, ifMatch int, in PatchInput) (*View, error) {
	id, err := decodeRef(caseRef)
	if err != nil {
		return nil, err
	}
	if in.HasAnswers {
		liftFacts(in.Answers, &in.Facts)
		if err := checkAnswers(in.Answers, "/answers"); err != nil {
			return nil, err
		}
	}
	var out *View
	now := s.now()
	err = s.DB.Tenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		sn, err := s.load(ctx, tx, p, id, true)
		if err != nil {
			return err
		}
		if sn.Case.Version != ifMatch {
			return ErrPrecondition
		}
		if in.SetMember {
			if sn, err = s.reassign(ctx, tx, p, t, sn, in.MemberRef, now); err != nil {
				return err
			}
		}
		c := sn.Case
		sn.dirty = true
		early := c.State == string(journey.Plan) || c.State == string(journey.LLApplying)
		if in.HasAnswers {
			c.Answers = mergePatch(c.Answers, in.Answers)
		}
		if in.Path != nil {
			if !paths[*in.Path] {
				return &ValidationError{Pointer: "/path", Code: "invalid_enum"}
			}
			if !early && c.State != string(journey.HandedOff) {
				return &ConflictError{Code: "JOURNEY_INVALID_TRANSITION", Detail: "the application path is fixed after the hand-off", Pointer: "/path"}
			}
			v := *in.Path
			c.Path = &v
		}
		for k, v := range in.Facts {
			if v == nil {
				delete(c.Facts, k)
			} else {
				c.Facts[k] = v
			}
		}
		classesChanged := false
		if in.Classes != nil {
			if !early {
				return &ConflictError{Code: "JOURNEY_INVALID_TRANSITION", Detail: "classes are fixed once the LL application is handed off", Pointer: "/classes"}
			}
			classes, err := cleanClasses(sn.Pack, in.Classes)
			if err != nil {
				return err
			}
			if sn.DOB != nil {
				if _, err := checkEligible(sn.Pack, sn.DOB, deref(c.DOBPrecision), classes, c.Facts, rules.TodayIST(now)); err != nil {
					return err
				}
			}
			classesChanged = strings.Join(classes, ",") != strings.Join(c.Classes, ",")
			c.Classes = classes
			if classesChanged {
				sel := make([]store.ClassSelection, 0, len(classes))
				for _, code := range classes {
					sel = append(sel, store.ClassSelection{ClassCode: code, Status: "planned"})
				}
				if err := store.ReplaceClassSelections(ctx, tx, t.TenantID, c.ID, sel); err != nil {
					return err
				}
				if sn.Classes, err = store.ListClassSelections(ctx, tx, c.ID); err != nil {
					return err
				}
			}
		}
		if classesChanged {
			if _, err := s.writeQuote(ctx, tx, sn, now); err != nil {
				return err
			}
		}
		if _, _, err := s.settle(ctx, tx, sn, now, actor{kind: "applicant", id: &p.ApplicantID, subject: p.Subject(), scope: p.Scope}); err != nil {
			return err
		}
		out = s.view(sn, now, t)
		return nil
	})
	return out, err
}

// reassign moves a PLAN case to a family member (or back to the holder): the member must be the
// caller's, a minor needs the recorded parental consent (403 PARENT_CONSENT_REQUIRED), the new
// subject must not already hold an open case for an overlapping class (409 CASE_EXISTS), and
// the case takes the new subject's date of birth when one is on file (eligibility is checked
// again). The version is bumped once, by the autosave write that follows.
func (s *Service) reassign(ctx context.Context, tx pgx.Tx, p *accounts.Principal, t *tenant.Tenant, sn *Snapshot, memberRef *string, now time.Time) (*Snapshot, error) {
	c := sn.Case
	if c.State != string(journey.Plan) {
		return nil, &ConflictError{Code: "JOURNEY_INVALID_TRANSITION", Detail: "a case can change hands only while it is a plan", Pointer: "/family_member_id"}
	}
	var memberID *uuid.UUID
	var member *store.FamilyMember
	if memberRef != nil {
		mid, err := ids.Decode(ids.FamilyMember, *memberRef)
		if err != nil {
			return nil, &ValidationError{Pointer: "/family_member_id", Code: "invalid"}
		}
		if err := accounts.RequireMemberAllowed(ctx, tx, p.ApplicantID, mid); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return nil, &ValidationError{Pointer: "/family_member_id", Code: "unknown_member"}
			}
			return nil, err
		}
		if member, err = store.GetFamilyMember(ctx, tx, p.ApplicantID, mid); err != nil {
			return nil, err
		}
		memberID = &mid
	}
	if sameMember(c.FamilyMemberID, memberID) {
		return sn, nil
	}
	open, err := store.OpenCasesFor(ctx, tx, p.ApplicantID)
	if err != nil {
		return nil, err
	}
	for _, o := range open {
		if o.ID != c.ID && sameMember(o.FamilyMemberID, memberID) && overlaps(o.Classes, c.Classes) && o.State != string(journey.DLHolder) && o.State != string(journey.RenewalDue) {
			return nil, &ConflictError{Code: "CASE_EXISTS", Detail: "an open case already covers one of these classes: " + ref(o.ID)}
		}
	}
	// The new subject's DOB, when one is on file; otherwise the case keeps the DOB it has.
	dobEnc, prec := c.DOBEnc, c.DOBPrecision
	if member != nil && len(member.DOBEnc) > 0 {
		if v, err := s.Vault.DecryptString(t.TenantID, "family_members.dob", member.DOBEnc); err == nil {
			if dobEnc, err = s.Vault.EncryptString(t.TenantID, "cases.dob", v); err != nil {
				return nil, err
			}
			mp := member.DOBPrecision
			prec = &mp
		}
	} else if member == nil {
		if a, err := store.GetApplicant(ctx, tx, p.ApplicantID); err == nil && len(a.DOBEnc) > 0 {
			if v, err := s.Vault.DecryptString(t.TenantID, "applicants.dob", a.DOBEnc); err == nil {
				if dobEnc, err = s.Vault.EncryptString(t.TenantID, "cases.dob", v); err != nil {
					return nil, err
				}
				prec = a.DOBPrecision
			}
		}
	}
	if err := store.SetCaseMember(ctx, tx, c.ID, memberID, dobEnc, prec); err != nil {
		return nil, err
	}
	flags := make([]string, 0, len(c.Flags)+1)
	for _, f := range c.Flags {
		if f != "for_minor_family_member" {
			flags = append(flags, f)
		}
	}
	if member != nil && member.IsMinor {
		flags = append(flags, "for_minor_family_member")
	}
	nsn, err := s.load(ctx, tx, p, c.ID, true)
	if err != nil {
		return nil, err
	}
	nsn.Case.Flags = flags
	if nsn.DOB != nil {
		if _, err := checkEligible(nsn.Pack, nsn.DOB, deref(nsn.Case.DOBPrecision), nsn.Case.Classes, nsn.Case.Facts, rules.TodayIST(now)); err != nil {
			return nil, err
		}
	}
	return nsn, nil
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
