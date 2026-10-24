// Package seed loads the synthetic personas (MD-054, P-01..P-07) used by the persona switcher
// (MD-122) and e2e tests. Everything is synthetic: fictional people, example.com addresses,
// no Aadhaar-like or phone-like values (seed_test.go lints this), town names only.
// Seeding is idempotent: deterministic IDs, existing rows are left as they are. ResetPersona
// re-seeds one persona's cases relative to the server's today (persona switcher: "LL day 12" is
// always day 12).
package seed

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/audit"
	"github.com/sruj08/margadarshak/services/api/internal/domain/age"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// Member is a seeded family member.
type Member struct {
	Key, Relation, Label, DOB string
	ParentalConsent           bool
}

// CaseSpec is a seeded case.
type CaseSpec struct {
	Key       string
	State     string
	Path      string
	Classes   []string
	Answers   map[string]any
	Facts     map[string]any
	KeyDates  func(asOf time.Time) map[string]string `json:"-"`
	MemberKey string                                 // case belongs to this family member
	Payment   bool                                   // add a mock payment intent for the case (amount from the rule pack)
	// LLDaysAgo sets an LL issued that many days before the seed date (E-04 mirror).
	LLDaysAgo *int
	// DLValidDays sets a DL mirror valid for that many more days (E-05), issued DLIssuedDaysAgo ago.
	DLValidDays     *int
	DLIssuedDaysAgo int
}

// Persona is one synthetic person.
type Persona struct {
	Key      string
	ID       string // P-xx
	Email    string
	Label    string
	DOB      string
	Language string
	Flags    []string
	Members  []Member
	Cases    []CaseSpec
	Consents []string // purposes granted
	// SwitcherID is the persona switcher ID the web app uses (MD-122), "" if not offered.
	SwitcherID string
}

func date(s string) time.Time {
	t, err := time.ParseInLocation(time.DateOnly, s, servertime.IST)
	if err != nil {
		panic(err)
	}
	return t
}

func ymd(t time.Time) string { return t.In(servertime.IST).Format(time.DateOnly) }

func intp(n int) *int { return &n }

func kabirCase(key string, day int) CaseSpec {
	return CaseSpec{Key: key, State: "BRIDGE", Path: "aadhaar_contactless", Classes: []string{"MCWG"}, Payment: true, LLDaysAgo: intp(day),
		Answers: map[string]any{"district": "Jammu", "preferred_office": "off_jk02", "test_language": "hi"},
		Facts:   map[string]any{"aadhaar_address_matches_residence": true, "aadhaar_has_relation_line": true, "aadhaar_mobile_linked": true}}
}

// Personas returns the personas; kabirDay (12 or 31) sets the LL day of the primary Kabir.
func Personas(kabirDay int) []Persona {
	return []Persona{
		{Key: "kabir", ID: "P-01", Email: "kabir.p01@example.com", Label: "Kabir", DOB: "2007-06-15", Language: "en",
			Consents: []string{"ai_coach", "email_updates"}, Cases: []CaseSpec{kabirCase("kabir-ll", kabirDay)}},
		{Key: "kabir-new", ID: "P-01", Email: "kabir.new.p01@example.com", Label: "Kabir (new, no case yet)", DOB: "2007-06-15", Language: "en",
			SwitcherID: "kabir_new"},
		{Key: "kabir-day12", ID: "P-01", Email: "kabir.day12.p01@example.com", Label: "Kabir (LL day 12)", DOB: "2007-06-15", Language: "en",
			Consents: []string{"ai_coach", "email_updates"}, Cases: []CaseSpec{kabirCase("kabir-day12-ll", 12)}, SwitcherID: "kabir_day12"},
		{Key: "kabir-day31", ID: "P-01", Email: "kabir.day31.p01@example.com", Label: "Kabir (LL day 31)", DOB: "2007-06-15", Language: "en",
			Consents: []string{"ai_coach", "email_updates"}, Cases: []CaseSpec{kabirCase("kabir-day31-ll", 31)}, SwitcherID: "kabir_day31"},
		{Key: "tanvi", ID: "P-02", Email: "tanvi.p02@example.com", Label: "Tanvi", DOB: "2007-02-20", Language: "hi",
			Consents: []string{"ai_coach", "helper_link"}, SwitcherID: "tanvi",
			Cases: []CaseSpec{{Key: "tanvi-plan", State: "PLAN", Path: "non_aadhaar_rto", Classes: []string{"MCWOG"},
				// EC-02 (ID address in Kathua, lives in Jammu) and EC-03 (blank S/o-D/o line).
				Answers: map[string]any{"district": "Jammu", "id_address_district": "Kathua", "id_relation_line_present": false},
				Facts:   map[string]any{"aadhaar_address_matches_residence": false, "aadhaar_has_relation_line": false, "aadhaar_mobile_linked": true}}}},
		{Key: "mohan", ID: "P-03", Email: "mohan.p03@example.com", Label: "Mohan-ji", DOB: "1974-03-02", Language: "hi", SwitcherID: "mohan",
			Members: []Member{{Key: "mohan-self", Relation: "self", Label: "Mohan-ji", DOB: "1974-03-02"}},
			Cases: []CaseSpec{{Key: "mohan-renewal", State: "DL_HOLDER", Path: "non_aadhaar_rto", Classes: []string{"LMV-NT"}, MemberKey: "mohan-self",
				DLValidDays: intp(40), DLIssuedDaysAgo: 3650,
				// Renewal + Form 1A (over 40, EC-04) + car re-test.
				Answers: map[string]any{"district": "Jammu", "needs_form_1a": true, "retest_class": "LMV-NT"},
				Facts:   map[string]any{"aadhaar_address_matches_residence": true, "aadhaar_has_relation_line": true}}}},
		{Key: "rahul-parent", ID: "P-07", Email: "rahul.parent.p07@example.com", Label: "Rahul's parent", DOB: "1981-08-09", Language: "hi", SwitcherID: "rahul",
			Consents: []string{"ai_coach"},
			Members:  []Member{{Key: "rahul", Relation: "child", Label: "Rahul", DOB: "2009-03-14", ParentalConsent: true}},
			Cases: []CaseSpec{{Key: "rahul-mc50", State: "PLAN", Path: "aadhaar_contactless", Classes: []string{"MC50CC"}, MemberKey: "rahul",
				Answers: map[string]any{"district": "Jammu", "guardian_consent_form": "pending"},
				Facts:   map[string]any{"aadhaar_address_matches_residence": true, "aadhaar_has_relation_line": true, "aadhaar_mobile_linked": true}}}},
		{Key: "dl-holder", ID: "P-08", Email: "ayesha.dl.p08@example.com", Label: "Ayesha (DL holder, new rider)", DOB: "2001-09-05", Language: "en",
			SwitcherID: "dl_holder", Consents: []string{"email_updates"},
			Cases: []CaseSpec{{Key: "ayesha-dl", State: "DL_HOLDER", Path: "aadhaar_contactless", Classes: []string{"MCWG", "LMV-NT"},
				DLValidDays: intp(6900), DLIssuedDaysAgo: 120, Answers: map[string]any{"district": "Srinagar"}}}},
		{Key: "helper", ID: "P-04", Email: "cafe.helper.p04@example.com", Label: "Cyber cafe helper (Gandhi Nagar)", DOB: "1996-11-30", Language: "hi",
			Flags: []string{"helper"}, SwitcherID: "helper"},
	}
}

// Deps are what the seed needs.
type Deps struct {
	DB    *store.DB
	Vault *privacy.Vault
	Now   time.Time
	// FeeTotal returns the fee quote total in paise from the tenant rule pack (nil skips payments).
	FeeTotal func(state string, classes []string) (int64, error)
	// LLDates returns the LL day-30 unlock and expiry for an issue date from the rule pack (nil:
	// 30 days and 6 months).
	LLDates func(state string, issued time.Time) (unlock, expires time.Time)
	// AfterCase settles a seeded case (journey catch-up, fee quote, timeline); nil skips it.
	AfterCase func(ctx context.Context, tenant string, caseID uuid.UUID) error
}

// Report summarises what was created.
type Report struct {
	Created, Existing int
	Personas          []string
}

// PersonaApplicantID is the deterministic applicant ID of a persona key.
func PersonaApplicantID(tenant, key string) uuid.UUID {
	return ids.Deterministic(tenant + ":persona:" + key)
}

// Run seeds tenant with the personas, idempotently.
func Run(ctx context.Context, d Deps, tenant string, kabirDay int) (Report, error) {
	var rep Report
	asOf := servertime.TodayIST(d.Now)
	for _, p := range Personas(kabirDay) {
		created, cases, err := seedPersona(ctx, d, tenant, p, asOf)
		if err != nil {
			return rep, fmt.Errorf("seed %s: %w", p.Key, err)
		}
		if err := settle(ctx, d, tenant, cases); err != nil {
			return rep, fmt.Errorf("seed %s: %w", p.Key, err)
		}
		if created {
			rep.Created++
		} else {
			rep.Existing++
		}
		rep.Personas = append(rep.Personas, p.ID+" "+p.Label+" "+ids.Encode(ids.User, PersonaApplicantID(tenant, p.Key)))
	}
	return rep, nil
}

func settle(ctx context.Context, d Deps, tenant string, cases []uuid.UUID) error {
	if d.AfterCase == nil {
		return nil
	}
	for _, c := range cases {
		if err := d.AfterCase(ctx, tenant, c); err != nil {
			return err
		}
	}
	return nil
}

// AdminPersonas are the synthetic clip-admin personas (P2, API-55): a curator and three raters
// (the third adjudicates when two disagree). Their sessions get the admin scope; the pseudonym
// (the persona key) is the actor clips records. They are reachable through the persona switcher
// endpoint (dev and demo only) but not listed by it, and Run does not seed them.
func AdminPersonas() []Persona {
	admin := func(key, id, label string) Persona {
		sw := strings.ReplaceAll(key, "-", "_")
		return Persona{Key: key, ID: id, Email: sw + ".admin@example.com", Label: label, DOB: "1990-01-01", Language: "en",
			Flags: []string{AdminFlag, PseudonymFlagPrefix + key}, SwitcherID: sw}
	}
	return []Persona{
		admin("curator-01", "P-A1", "Clip curator (curator-01)"),
		admin("rater-01", "P-A2", "Clip rater (rater-01)"),
		admin("rater-02", "P-A3", "Clip rater (rater-02)"),
		admin("rater-03", "P-A4", "Clip rater and adjudicator (rater-03)"),
	}
}

// Applicant flags of the admin personas.
const (
	AdminFlag           = "admin"
	PseudonymFlagPrefix = "pseudonym:"
)

// PseudonymOf returns the admin pseudonym recorded in applicant flags ("" when none).
func PseudonymOf(flags []string) string {
	for _, f := range flags {
		if p, ok := strings.CutPrefix(f, PseudonymFlagPrefix); ok {
			return p
		}
	}
	return ""
}

// FindSwitcher returns the persona with a switcher ID (the listed personas and the admin ones).
func FindSwitcher(id string) (Persona, bool) {
	for _, p := range append(Personas(12), AdminPersonas()...) {
		if p.SwitcherID != "" && p.SwitcherID == id {
			return p, true
		}
	}
	return Persona{}, false
}

// ResetPersona seeds the persona if needed and re-seeds its cases relative to today, so the
// persona switcher always shows the documented day (MD-122). Returns the applicant ID.
func ResetPersona(ctx context.Context, d Deps, tenant string, p Persona) (uuid.UUID, error) {
	asOf := servertime.TodayIST(d.Now)
	if _, _, err := seedPersona(ctx, d, tenant, p, asOf); err != nil {
		return uuid.Nil, err
	}
	id := PersonaApplicantID(tenant, p.Key)
	var cases []uuid.UUID
	err := d.DB.System(ctx, func(tx pgx.Tx) error {
		for _, q := range []string{
			`DELETE FROM msg.notifications WHERE applicant_id = $1`,
			`DELETE FROM core.payment_intents WHERE applicant_id = $1`,
			`DELETE FROM core.cases WHERE applicant_id = $1`,
		} {
			if _, err := tx.Exec(ctx, q, id); err != nil {
				return err
			}
		}
		members := map[string]uuid.UUID{}
		for _, m := range p.Members {
			members[m.Key] = ids.Deterministic(tenant + ":member:" + m.Key)
		}
		for _, cs := range p.Cases {
			cid, err := seedCase(ctx, tx, d, tenant, id, p, cs, members, asOf)
			if err != nil {
				return err
			}
			cases = append(cases, cid)
		}
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}
	return id, settle(ctx, d, tenant, cases)
}

func seedPersona(ctx context.Context, d Deps, tenant string, p Persona, asOf time.Time) (bool, []uuid.UUID, error) {
	id := PersonaApplicantID(tenant, p.Key)
	created := false
	var cases []uuid.UUID
	err := d.DB.System(ctx, func(tx pgx.Tx) error {
		if _, err := store.GetApplicant(ctx, tx, id); err == nil {
			return nil
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		created = true
		a, err := age.Assess(date(p.DOB), age.Day, asOf)
		if err != nil {
			return err
		}
		if a.IsMinor {
			return fmt.Errorf("persona %s: account holders are adults", p.Key)
		}
		dobEnc, err := d.Vault.EncryptString(tenant, "applicants.dob", p.DOB)
		if err != nil {
			return err
		}
		band, prec := string(a.Band), "day"
		email := privacy.NormalizeContact("email", p.Email)
		app := &store.Applicant{ID: id, TenantID: tenant, Kind: "account", AuthSubjectHash: d.Vault.Keyed(tenant, "auth:email", email),
			UserBand: "adult", AgeBand: &band, DOBEnc: dobEnc, DOBPrecision: &prec, Language: p.Language, Flags: append([]string{"synthetic"}, p.Flags...)}
		if err := store.InsertApplicant(ctx, tx, app); err != nil {
			return err
		}
		enc, err := d.Vault.EncryptString(tenant, "contacts.value", email)
		if err != nil {
			return err
		}
		if err := store.UpsertContact(ctx, tx, &store.Contact{ID: ids.Deterministic(tenant + ":contact:" + p.Key), TenantID: tenant, ApplicantID: id,
			Kind: "email", ValueEnc: enc, BlindIndex: d.Vault.BlindIndex(tenant, "email", email)}); err != nil {
			return err
		}
		members := map[string]uuid.UUID{}
		for _, m := range p.Members {
			mid, err := seedMember(ctx, tx, d, tenant, id, m, asOf)
			if err != nil {
				return err
			}
			members[m.Key] = mid
		}
		for _, purpose := range p.Consents {
			c := &store.Consent{ID: ids.Deterministic(tenant + ":consent:" + p.Key + ":" + purpose), TenantID: tenant, ApplicantID: id, Purpose: purpose,
				NoticeVersion: "notice-2026.10.23-" + p.Language, GrantedAt: d.Now.UTC()}
			if info, ok := privacy.Catalogue[purpose]; ok {
				c.DataCategories = info.DataCategories
			}
			if purpose == "helper_link" {
				helper := ids.Encode(ids.User, PersonaApplicantID(tenant, "helper"))
				c.Recipient = &helper
			}
			if err := store.InsertConsent(ctx, tx, c); err != nil {
				return err
			}
		}
		for _, cs := range p.Cases {
			cid, err := seedCase(ctx, tx, d, tenant, id, p, cs, members, asOf)
			if err != nil {
				return err
			}
			cases = append(cases, cid)
		}
		_, err = audit.Append(ctx, tx, d.Now, audit.Entry{Tenant: tenant, Actor: "system:seed", ActorScope: "system", Action: "seed.persona",
			Target: ids.Encode(ids.User, id), Meta: map[string]any{"persona": p.ID, "synthetic": true}})
		return err
	})
	return created, cases, err
}

func seedMember(ctx context.Context, tx pgx.Tx, d Deps, tenant string, owner uuid.UUID, m Member, asOf time.Time) (uuid.UUID, error) {
	mid := ids.Deterministic(tenant + ":member:" + m.Key)
	a, err := age.Assess(date(m.DOB), age.Day, asOf)
	if err != nil {
		return mid, err
	}
	dobEnc, err := d.Vault.EncryptString(tenant, "family_members.dob", m.DOB)
	if err != nil {
		return mid, err
	}
	label, err := d.Vault.EncryptString(tenant, "family_members.label", m.Label)
	if err != nil {
		return mid, err
	}
	fm := &store.FamilyMember{ID: mid, TenantID: tenant, ApplicantID: owner, Relation: m.Relation, LabelEnc: label, DOBEnc: dobEnc,
		DOBPrecision: "day", AgeBand: string(a.Band), IsMinor: a.IsMinor, ParentalConsentStatus: "not_required"}
	if a.IsMinor {
		fm.ParentalConsentStatus = "required"
	}
	if err := store.InsertFamilyMember(ctx, tx, fm); err != nil {
		return mid, err
	}
	if a.IsMinor && m.ParentalConsent {
		cid := ids.Deterministic(tenant + ":consent:parental:" + m.Key)
		c := &store.Consent{ID: cid, TenantID: tenant, ApplicantID: owner, SubjectMemberID: &mid, Purpose: "parental_consent",
			DataCategories: []string{"learner_case", "learning_progress", "game_sessions", "ai_coaching"}, NoticeVersion: "notice-2026.10.23-hi",
			GrantedAt: d.Now.UTC(), GuardianApplicantID: &owner}
		if err := store.InsertConsent(ctx, tx, c); err != nil {
			return mid, err
		}
		if err := store.SetParentalConsent(ctx, tx, mid, "granted", &cid); err != nil {
			return mid, err
		}
	}
	return mid, nil
}

func (d Deps) llDates(state string, issued time.Time) (time.Time, time.Time) {
	if d.LLDates != nil {
		return d.LLDates(state, issued)
	}
	return issued.AddDate(0, 0, 30), issued.AddDate(0, 6, 0)
}

func seedCase(ctx context.Context, tx pgx.Tx, d Deps, tenant string, owner uuid.UUID, p Persona, cs CaseSpec, members map[string]uuid.UUID, asOf time.Time) (uuid.UUID, error) {
	cid := ids.Deterministic(tenant + ":case:" + cs.Key)
	c := &store.Case{ID: cid, TenantID: tenant, ApplicantID: owner, State: cs.State, Classes: cs.Classes, Answers: cs.Answers,
		RulePackID: tenant, RulePackVersion: "2026.10.0", Flags: []string{}, Facts: cs.Facts, KeyDates: map[string]string{}}
	if cs.Path != "" {
		path := cs.Path
		c.Path = &path
	}
	if cs.KeyDates != nil {
		c.KeyDates = cs.KeyDates(asOf)
	}
	dob := p.DOB
	if cs.MemberKey != "" {
		mid := members[cs.MemberKey]
		c.FamilyMemberID = &mid
		for _, m := range p.Members {
			if m.Key == cs.MemberKey {
				dob = m.DOB
			}
		}
		if m, err := store.GetFamilyMember(ctx, tx, owner, mid); err == nil && m.IsMinor {
			c.Flags = append(c.Flags, "for_minor_family_member")
		}
	}
	enc, err := d.Vault.EncryptString(tenant, "cases.dob", dob)
	if err != nil {
		return cid, err
	}
	prec := "day"
	c.DOBEnc, c.DOBPrecision = enc, &prec
	var ll *store.LLMirror
	if cs.LLDaysAgo != nil {
		issued := asOf.AddDate(0, 0, -*cs.LLDaysAgo)
		unlock, expires := d.llDates(tenant, issued)
		ll = &store.LLMirror{IssuedOn: ymd(issued), ExpiresOn: ymd(expires), Classes: cs.Classes, Source: "user_entered"}
		c.KeyDates["ll_issued_on"], c.KeyDates["ll_expires_on"], c.KeyDates["dl_test_unlock"] = ll.IssuedOn, ll.ExpiresOn, ymd(unlock)
		if l4, err := d.Vault.EncryptString(tenant, "ll_mirrors.number_last4", "4471"); err == nil {
			ll.NumberLast4Enc = l4
		}
	}
	var dl *store.DLMirror
	if cs.DLValidDays != nil {
		validTo := asOf.AddDate(0, 0, *cs.DLValidDays)
		issued := ymd(asOf.AddDate(0, 0, -cs.DLIssuedDaysAgo))
		rw := ymd(validTo.AddDate(0, 0, -60))
		dl = &store.DLMirror{IssuedOn: &issued, ValidToNT: ymd(validTo), Classes: cs.Classes, RenewalWindowOpens: &rw, Source: "user_entered"}
		c.KeyDates["dl_issued_on"], c.KeyDates["dl_valid_to"], c.KeyDates["renewal_window_opens"] = issued, dl.ValidToNT, rw
	}
	if err := store.InsertCase(ctx, tx, c); err != nil {
		return cid, err
	}
	if ll != nil {
		if err := store.UpsertLLMirror(ctx, tx, tenant, cid, *ll); err != nil {
			return cid, err
		}
	}
	if dl != nil {
		if err := store.UpsertDLMirror(ctx, tx, tenant, cid, *dl); err != nil {
			return cid, err
		}
	}
	status := "planned"
	switch {
	case dl != nil:
		status = "dl_issued"
	case ll != nil:
		status = "ll_issued"
	}
	sel := make([]store.ClassSelection, 0, len(cs.Classes))
	for _, code := range cs.Classes {
		sel = append(sel, store.ClassSelection{ClassCode: code, Status: status})
	}
	if err := store.ReplaceClassSelections(ctx, tx, tenant, cid, sel); err != nil {
		return cid, err
	}
	if _, err := store.InsertCaseEvent(ctx, tx, &store.CaseEvent{CaseID: cid, Seq: 1, TenantID: tenant, Type: "case_started",
		Payload: map[string]any{"classes": cs.Classes, "seeded": true}, RecordedAt: d.Now, ActorKind: "system", IdempotencyKey: "seed",
		RulePackVersion: c.RulePackVersion}); err != nil {
		return cid, err
	}
	if _, err := tx.Exec(ctx, `UPDATE core.cases SET last_seq = 1 WHERE case_id = $1`, cid); err != nil {
		return cid, err
	}
	if cs.Payment && d.FeeTotal != nil {
		total, err := d.FeeTotal(tenant, cs.Classes)
		if err != nil {
			return cid, err
		}
		pid := ids.Deterministic(tenant + ":payment:" + cs.Key)
		if err := store.InsertPaymentIntent(ctx, tx, &store.PaymentIntent{ID: pid, TenantID: tenant, ApplicantID: owner, CaseID: &cid,
			Adapter: "mock", RedirectURL: "/mock/payment/" + ids.Encode(ids.PaymentIntent, pid), AmountPaise: int(total), Status: "success"}); err != nil {
			return cid, err
		}
	}
	return cid, nil
}
