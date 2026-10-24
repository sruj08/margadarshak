package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
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

// Me returns the caller's applicant row.
func (s *Service) Me(ctx context.Context, p *Principal) (*store.Applicant, error) {
	var a *store.Applicant
	err := s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		var err error
		a, err = store.GetApplicant(ctx, tx, p.ApplicantID)
		return err
	})
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrNotFound
	}
	return a, err
}

// ProfilePatch is the API-59 merge patch. Age bands are never accepted from the client: they are
// computed here from the DOB with the IST server date (tamper-proof, MD-049).
type ProfilePatch struct {
	Language     *string
	A11y         map[string]bool
	QuietHours   map[string]string
	DOB          *time.Time
	DOBPrecision *string
}

// UpdateMe applies a profile patch. The account holder must be an adult (D-13 revised): a DOB
// under 18 is refused with a pointer to family mode.
func (s *Service) UpdateMe(ctx context.Context, p *Principal, patch ProfilePatch) (*store.Applicant, error) {
	u := store.ApplicantUpdate{Language: patch.Language, A11y: patch.A11y, QuietHours: patch.QuietHours}
	if patch.QuietHours != nil {
		for _, k := range []string{"start", "end"} {
			if v, ok := patch.QuietHours[k]; ok && !validHHMM(v) {
				return nil, &ValidationError{Pointer: "/quiet_hours/" + k, Code: "invalid_time"}
			}
		}
	}
	if patch.DOB != nil {
		prec := age.Day
		if patch.DOBPrecision != nil && *patch.DOBPrecision == string(age.YearOnly) {
			prec = age.YearOnly
		}
		a, err := age.Assess(*patch.DOB, prec, servertime.TodayIST(s.now()))
		if err != nil {
			return nil, &ValidationError{Pointer: "/dob", Code: "implausible_dob"}
		}
		if a.IsMinor && p.Kind == "account" {
			return nil, ErrHolderMustBeAdult
		}
		enc, err := s.Vault.EncryptString(p.Tenant, "applicants.dob", patch.DOB.Format(time.DateOnly))
		if err != nil {
			return nil, err
		}
		band, ub, ps := string(a.Band), string(a.UserBand), string(prec)
		u.DOBEnc, u.AgeBand, u.UserBand, u.DOBPrecision = enc, &band, &ub, &ps
	} else if patch.DOBPrecision != nil {
		return nil, &ValidationError{Pointer: "/dob_precision", Code: "requires_dob"}
	}
	var out *store.Applicant
	err := s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		if err := store.UpdateApplicant(ctx, tx, p.ApplicantID, u); err != nil {
			return err
		}
		if patch.DOB != nil {
			if _, err := audit.Append(ctx, tx, s.now(), audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope,
				Action: "profile.dob_set", Target: p.Subject(), Meta: map[string]any{"age_band": *u.AgeBand}}); err != nil {
				return err
			}
		}
		var err error
		out, err = store.GetApplicant(ctx, tx, p.ApplicantID)
		return err
	})
	return out, err
}

func validHHMM(v string) bool {
	t, err := time.Parse("15:04", v)
	return err == nil && t.Format("15:04") == v
}

// DeleteMe schedules erasure (API-62): soft delete now, sessions revoked, audited.
func (s *Service) DeleteMe(ctx context.Context, p *Principal) error {
	return s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		if err := store.SoftDeleteApplicant(ctx, tx, p.ApplicantID); err != nil {
			return err
		}
		if _, err := store.RevokeAllSessions(ctx, tx, p.ApplicantID, "account_deleted"); err != nil {
			return err
		}
		_, err := audit.Append(ctx, tx, s.now(), audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope,
			Action: "account.erasure_requested", Target: p.Subject()})
		return err
	})
}

// ---- Family mode (F-17, MD-049) -----------------------------------------------------------

// Member is a family member as the API shows it.
type Member struct {
	ID                    uuid.UUID
	Relation              string
	Label                 *string
	AgeBand               string
	IsMinor               bool
	ParentalConsentStatus string
	ParentalConsentID     *uuid.UUID
	CreatedAt             time.Time
	// ParentalExtras: squads, share_cards, pair_mode (D-09); empty unless the base consent is granted.
	ParentalExtras []string
}

// NewMember is the add-member input.
type NewMember struct {
	Relation     string
	Label        string
	DOB          time.Time
	DOBPrecision string
}

var relations = map[string]bool{"self": true, "child": true, "ward": true, "parent": true, "sibling": true, "spouse": true, "other": true}

func requireAccount(p *Principal) error {
	if p.Kind != "account" || p.Scope != "user" {
		return ErrForbidden
	}
	return nil
}

// AddMember adds a family member. The band is computed server-side; a minor starts with
// parental_consent "required".
func (s *Service) AddMember(ctx context.Context, p *Principal, in NewMember) (*Member, error) {
	if err := requireAccount(p); err != nil {
		return nil, err
	}
	if !relations[in.Relation] {
		return nil, &ValidationError{Pointer: "/relation", Code: "invalid_relation"}
	}
	label := strings.TrimSpace(in.Label)
	if len([]rune(label)) > 40 {
		return nil, &ValidationError{Pointer: "/label", Code: "too_long"}
	}
	if k, bad := privacy.FirstProhibited(label); bad {
		return nil, &ValidationError{Pointer: "/label", Code: "PROHIBITED_FIELD", Detail: string(k)}
	}
	prec := age.Day
	if in.DOBPrecision == string(age.YearOnly) {
		prec = age.YearOnly
	}
	a, err := age.Assess(in.DOB, prec, servertime.TodayIST(s.now()))
	if err != nil {
		return nil, &ValidationError{Pointer: "/dob", Code: "implausible_dob"}
	}
	dobEnc, err := s.Vault.EncryptString(p.Tenant, "family_members.dob", in.DOB.Format(time.DateOnly))
	if err != nil {
		return nil, err
	}
	m := &store.FamilyMember{ID: ids.New(), TenantID: p.Tenant, ApplicantID: p.ApplicantID, Relation: in.Relation, DOBEnc: dobEnc,
		DOBPrecision: string(prec), AgeBand: string(a.Band), IsMinor: a.IsMinor, ParentalConsentStatus: "not_required"}
	if a.IsMinor {
		m.ParentalConsentStatus = "required"
	}
	if label != "" {
		if m.LabelEnc, err = s.Vault.EncryptString(p.Tenant, "family_members.label", label); err != nil {
			return nil, err
		}
	}
	err = s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		if err := store.InsertFamilyMember(ctx, tx, m); err != nil {
			return err
		}
		_, err := audit.Append(ctx, tx, s.now(), audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope, Action: "family.member_added",
			Target: ids.Encode(ids.FamilyMember, m.ID), Meta: map[string]any{"relation": m.Relation, "age_band": m.AgeBand, "is_minor": m.IsMinor}})
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.toMember(p.Tenant, m), nil
}

// Members lists the account's family members.
func (s *Service) Members(ctx context.Context, p *Principal) ([]*Member, error) {
	if err := requireAccount(p); err != nil {
		return nil, err
	}
	var rows []*store.FamilyMember
	err := s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		var err error
		rows, err = store.ListFamilyMembers(ctx, tx, p.ApplicantID)
		return err
	})
	if err != nil {
		return nil, err
	}
	out := make([]*Member, 0, len(rows))
	for _, r := range rows {
		out = append(out, s.toMember(p.Tenant, r))
	}
	return out, nil
}

func (s *Service) toMember(tenant string, m *store.FamilyMember) *Member {
	out := &Member{ID: m.ID, Relation: m.Relation, AgeBand: m.AgeBand, IsMinor: m.IsMinor, ParentalConsentStatus: m.ParentalConsentStatus,
		ParentalConsentID: m.ParentalConsentID, CreatedAt: m.CreatedAt, ParentalExtras: []string{}}
	if m.IsMinor && m.ParentalConsentStatus == "granted" && m.ParentalExtras != nil {
		out.ParentalExtras = m.ParentalExtras
	}
	if len(m.LabelEnc) > 0 {
		if l, err := s.Vault.DecryptString(tenant, "family_members.label", m.LabelEnc); err == nil {
			out.Label = &l
		}
	}
	return out
}

// RecordParentalConsent grants or revokes the adult account holder's consent for a minor
// member, writing a parental_consent artefact (E-15) and an audit row.
func (s *Service) RecordParentalConsent(ctx context.Context, p *Principal, memberID uuid.UUID, action, notice, lang string) (*Member, error) {
	return s.RecordParentalConsentExtras(ctx, p, memberID, action, notice, lang, nil)
}

// RecordParentalConsentExtras is RecordParentalConsent with the parental extras (D-09):
// with grant, extras is the full set afterwards (nil = unchanged, empty = withdraw all); with
// revoke, nil revokes the consent and every extra, a list revokes only those extras (the base
// consent stays). Extras need the base consent.
func (s *Service) RecordParentalConsentExtras(ctx context.Context, p *Principal, memberID uuid.UUID, action, notice, lang string, extras *[]string) (*Member, error) {
	if extras != nil {
		for _, e := range *extras {
			if e != "squads" && e != "share_cards" && e != "pair_mode" {
				return nil, &ValidationError{Pointer: "/extras", Code: "invalid_enum"}
			}
		}
	}
	if err := requireAccount(p); err != nil {
		return nil, err
	}
	if p.UserBand == "u18" {
		return nil, ErrHolderMustBeAdult
	}
	if action != "grant" && action != "revoke" {
		return nil, &ValidationError{Pointer: "/action", Code: "invalid_action"}
	}
	if strings.TrimSpace(notice) == "" {
		return nil, &ValidationError{Pointer: "/notice_version", Code: "required"}
	}
	var out *store.FamilyMember
	err := s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		m, err := store.GetFamilyMember(ctx, tx, p.ApplicantID, memberID)
		if err != nil {
			return err
		}
		if !m.IsMinor {
			return &ValidationError{Pointer: "/member_id", Code: "not_a_minor", Detail: "parental consent applies to family members under 18"}
		}
		now := s.now()
		var consentID *uuid.UUID
		status := "granted"
		if action == "revoke" && extras != nil {
			// Revoke only the listed extras; the base consent stays as it is.
			keep := []string{}
			for _, e := range m.ParentalExtras {
				if !slices.Contains(*extras, e) {
					keep = append(keep, e)
				}
			}
			if err := store.SetParentalExtras(ctx, tx, m.ID, keep); err != nil {
				return err
			}
			if _, err := audit.Append(ctx, tx, now, audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope,
				Action: "consent.parental_extras_revoke", Target: ids.Encode(ids.FamilyMember, m.ID), Purpose: "parental_consent",
				Meta: map[string]any{"extras": *extras}}); err != nil {
				return err
			}
			out, err = store.GetFamilyMember(ctx, tx, p.ApplicantID, memberID)
			return err
		}
		existing, err := store.ActiveConsent(ctx, tx, p.ApplicantID, "parental_consent", nil, &m.ID)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if action == "grant" {
			if existing != nil {
				consentID = &existing.ID
			} else {
				c := s.newConsent(p, "parental_consent", notice, lang, nil, &m.ID, now)
				c.GuardianApplicantID = &p.ApplicantID
				c.DataCategories = []string{"learner_case", "learning_progress", "game_sessions", "ai_coaching"}
				c.Signature = s.signConsent(c)
				if err := store.InsertConsent(ctx, tx, c); err != nil {
					return err
				}
				consentID = &c.ID
			}
		} else {
			status = "revoked"
			if existing != nil {
				if err := store.RevokeConsent(ctx, tx, existing.ID, now); err != nil {
					return err
				}
				consentID = &existing.ID
			}
		}
		if err := store.SetParentalConsent(ctx, tx, m.ID, status, consentID); err != nil {
			return err
		}
		switch {
		case status == "revoked":
			if err := store.SetParentalExtras(ctx, tx, m.ID, nil); err != nil {
				return err
			}
		case extras != nil:
			if err := store.SetParentalExtras(ctx, tx, m.ID, *extras); err != nil {
				return err
			}
		}
		if _, err := audit.Append(ctx, tx, now, audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope,
			Action: "consent.parental_" + action, Target: ids.Encode(ids.FamilyMember, m.ID), Purpose: "parental_consent", ConsentID: consentID}); err != nil {
			return err
		}
		out, err = store.GetFamilyMember(ctx, tx, p.ApplicantID, memberID)
		return err
	})
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.toMember(p.Tenant, out), nil
}

// RequireMemberAllowed is the check case endpoints (P1) call before opening or using a case for
// a family member: a minor needs the parent's recorded consent (403 PARENT_CONSENT_REQUIRED).
// It is not an AI gate: once consent is recorded, every feature is available.
func RequireMemberAllowed(ctx context.Context, tx pgx.Tx, applicant, member uuid.UUID) error {
	m, err := store.GetFamilyMember(ctx, tx, applicant, member)
	if err != nil {
		return err
	}
	return privacy.RequireParentalConsent(privacy.Subject{IsMinor: m.IsMinor, ParentalConsentStatus: m.ParentalConsentStatus})
}

// ---- Consents (API-60, E-15) ----------------------------------------------------------------

// Consents lists the caller's artefacts.
func (s *Service) Consents(ctx context.Context, p *Principal) ([]*store.Consent, error) {
	var out []*store.Consent
	err := s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		var err error
		out, err = store.ListConsents(ctx, tx, p.ApplicantID)
		return err
	})
	return out, err
}

// ChangeConsent grants or revokes a purpose (API-60). Available to everyone (D-13 revised);
// parental consent goes through RecordParentalConsent because it names a family member.
func (s *Service) ChangeConsent(ctx context.Context, p *Principal, purpose, action, notice, lang string, recipient *string) (*store.Consent, error) {
	if !privacy.ValidPurpose(purpose) || purpose == "parental_consent" {
		return nil, &ValidationError{Pointer: "/purpose", Code: "invalid_purpose"}
	}
	if action != "grant" && action != "revoke" {
		return nil, &ValidationError{Pointer: "/action", Code: "invalid_action"}
	}
	if strings.TrimSpace(notice) == "" || len(notice) > 64 {
		return nil, &ValidationError{Pointer: "/notice_version", Code: "required"}
	}
	var out *store.Consent
	err := s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		now := s.now()
		existing, err := store.ActiveConsent(ctx, tx, p.ApplicantID, purpose, recipient, nil)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		switch {
		case action == "grant" && existing != nil:
			out = existing
		case action == "grant":
			c := s.newConsent(p, purpose, notice, lang, recipient, nil, now)
			c.Signature = s.signConsent(c)
			if err := store.InsertConsent(ctx, tx, c); err != nil {
				return err
			}
			out = c
		case existing == nil:
			return store.ErrNotFound
		default:
			if err := store.RevokeConsent(ctx, tx, existing.ID, now); err != nil {
				return err
			}
			if out, err = store.GetConsent(ctx, tx, existing.ID); err != nil {
				return err
			}
			// Revoking the field-study consent is the participant's "Delete my data" (FIELD_STUDY
			// §6.3): their online-study enrolments are withdrawn now and the retention job deletes
			// the pseudonymous rows.
			if purpose == "field_study" {
				if _, err := store.WithdrawStudyParticipants(ctx, tx, p.Tenant, p.ApplicantID, now); err != nil {
					return err
				}
			}
		}
		_, err = audit.Append(ctx, tx, now, audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope,
			Action: "consent." + action, Target: ids.Encode(ids.Consent, out.ID), Purpose: purpose, ConsentID: &out.ID})
		return err
	})
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrNotFound
	}
	return out, err
}

// RecordConsent stores a granted artefact inside an existing transaction (used by flows such as
// the DigiLocker callback that grant consent as part of a larger step).
func (s *Service) RecordConsent(ctx context.Context, tx pgx.Tx, p *Principal, purpose, notice string, categories []string, recipient *string) (*store.Consent, error) {
	now := s.now()
	if existing, err := store.ActiveConsent(ctx, tx, p.ApplicantID, purpose, recipient, nil); err == nil {
		return existing, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	c := s.newConsent(p, purpose, notice, "", recipient, nil, now)
	if len(categories) > 0 {
		c.DataCategories = categories
	}
	c.Signature = s.signConsent(c)
	if err := store.InsertConsent(ctx, tx, c); err != nil {
		return nil, err
	}
	_, err := audit.Append(ctx, tx, now, audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope,
		Action: "consent.grant", Target: ids.Encode(ids.Consent, c.ID), Purpose: purpose, ConsentID: &c.ID})
	return c, err
}

func (s *Service) newConsent(p *Principal, purpose, notice, lang string, recipient *string, subject *uuid.UUID, now time.Time) *store.Consent {
	// Data categories come from the purpose catalogue (MD-133) unless the flow names its own.
	cats := []string{}
	if info, ok := privacy.Catalogue[purpose]; ok {
		cats = append(cats, info.DataCategories...)
	}
	return &store.Consent{ID: ids.New(), TenantID: p.Tenant, ApplicantID: p.ApplicantID, SubjectMemberID: subject, Purpose: purpose,
		Recipient: recipient, NoticeVersion: notice, Language: strPtr(lang), GrantedAt: now.UTC().Truncate(time.Microsecond), DataCategories: cats}
}

// signConsent signs the canonical artefact (Ed25519) so an exported artefact can be checked.
func (s *Service) signConsent(c *store.Consent) []byte {
	return ed25519Sign(s.consentKey, ConsentCanonical(c))
}

// ConsentCanonical is the signed form of an artefact.
func ConsentCanonical(c *store.Consent) []byte {
	m := map[string]any{"consent_id": c.ID.String(), "tenant": c.TenantID, "applicant": c.ApplicantID.String(), "purpose": c.Purpose,
		"notice_version": c.NoticeVersion, "granted_at": c.GrantedAt.UTC().Format(time.RFC3339Nano), "data_categories": c.DataCategories}
	if c.Recipient != nil {
		m["recipient"] = *c.Recipient
	}
	if c.SubjectMemberID != nil {
		m["subject_member"] = c.SubjectMemberID.String()
	}
	b, _ := json.Marshal(m)
	return b
}
