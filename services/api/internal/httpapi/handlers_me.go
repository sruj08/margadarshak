package httpapi

import (
	"encoding/base64"
	"net/http"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

func applicantOut(p *accounts.Principal, a *store.Applicant) gen.Applicant {
	out := gen.Applicant{Subject: p.Subject(), Scope: p.Scope, UserBand: gen.UserBand(a.UserBand)}
	if a.AgeBand != nil {
		b := gen.AgeBand(*a.AgeBand)
		out.AgeBand = &b
	}
	lang := gen.ApplicantLanguage(a.Language)
	out.Language = &lang
	a11y := a.A11y
	if a11y == nil {
		a11y = map[string]bool{}
	}
	out.A11y = &a11y
	qh := struct {
		End   *string `json:"end,omitempty"`
		Start *string `json:"start,omitempty"`
	}{}
	if v, ok := a.QuietHours["start"]; ok {
		qh.Start = &v
	}
	if v, ok := a.QuietHours["end"]; ok {
		qh.End = &v
	}
	out.QuietHours = &qh
	flags := []gen.ApplicantFlags{}
	for _, f := range a.Flags {
		switch gen.ApplicantFlags(f) {
		case gen.ApplicantFlagsHelper, gen.ApplicantFlagsFieldStudy, gen.ApplicantFlagsDeletionPending:
			flags = append(flags, gen.ApplicantFlags(f))
		}
	}
	out.Flags = &flags
	tn := gen.StateCode(a.TenantID)
	out.Tenant = &tn
	return out
}

// GetMe is API-59 GET.
func (s *Server) GetMe(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r.Context())
	a, err := s.deps.Accounts.Me(r.Context(), p)
	if err != nil {
		s.accountError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, applicantOut(p, a))
}

// UpdateMe is API-59 PATCH (merge patch). age_band and user_band are not accepted: they are
// computed on the server from the DOB and the IST server date (MD-049 tamper test).
func (s *Server) UpdateMe(w http.ResponseWriter, r *http.Request) {
	var req gen.ApplicantPatch
	if !decodeJSON(w, r, &req, false) {
		return
	}
	patch := accounts.ProfilePatch{A11y: derefMap(req.A11y)}
	if req.Language != nil {
		switch *req.Language {
		case gen.ApplicantPatchLanguageEn, gen.ApplicantPatchLanguageHi, gen.ApplicantPatchLanguageDoi:
			l := string(*req.Language)
			patch.Language = &l
		default:
			validation(w, r, "/language", "invalid_enum")
			return
		}
	}
	if req.QuietHours != nil {
		patch.QuietHours = map[string]string{}
		if req.QuietHours.Start != nil {
			patch.QuietHours["start"] = *req.QuietHours.Start
		}
		if req.QuietHours.End != nil {
			patch.QuietHours["end"] = *req.QuietHours.End
		}
	}
	if req.Dob != nil {
		d := time.Date(req.Dob.Year(), req.Dob.Month(), req.Dob.Day(), 0, 0, 0, 0, servertime.IST)
		patch.DOB = &d
	}
	if req.DobPrecision != nil {
		p := string(*req.DobPrecision)
		if p != "day" && p != "year_only" {
			validation(w, r, "/dob_precision", "invalid_enum")
			return
		}
		patch.DOBPrecision = &p
	}
	p := principalFrom(r.Context())
	a, err := s.deps.Accounts.UpdateMe(r.Context(), p, patch)
	if err != nil {
		s.accountError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, applicantOut(p, a))
}

func derefMap(m *map[string]bool) map[string]bool {
	if m == nil {
		return nil
	}
	return *m
}

func consentOut(c *store.Consent) gen.ConsentArtefact {
	out := gen.ConsentArtefact{ConsentId: ids.Encode(ids.Consent, c.ID), Purpose: gen.ConsentPurpose(c.Purpose), GrantedAt: c.GrantedAt.UTC(),
		NoticeVersion: c.NoticeVersion, Status: gen.ConsentArtefactStatusActive, Recipient: c.Recipient, Language: c.Language}
	cats := c.DataCategories
	if cats == nil {
		cats = []string{}
	}
	out.DataCategories = &cats
	if c.RevokedAt != nil {
		t := c.RevokedAt.UTC()
		out.RevokedAt, out.Status = &t, gen.ConsentArtefactStatusRevoked
	} else if c.ExpiresAt != nil && c.ExpiresAt.Before(time.Now()) {
		out.Status = gen.ConsentArtefactStatusExpired
	}
	if c.ExpiresAt != nil {
		t := c.ExpiresAt.UTC()
		out.ExpiresAt = &t
	}
	if len(c.Signature) > 0 {
		sig := base64.RawURLEncoding.EncodeToString(c.Signature)
		out.Signature = &sig
	}
	return out
}

// ListConsents is API-60 GET.
func (s *Server) ListConsents(w http.ResponseWriter, r *http.Request) {
	list, err := s.deps.Accounts.Consents(r.Context(), principalFrom(r.Context()))
	if err != nil {
		s.accountError(w, r, err)
		return
	}
	items := make([]gen.ConsentArtefact, 0, len(list))
	for _, c := range list {
		items = append(items, consentOut(c))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// GrantOrRevokeConsent is API-60 POST. Every purpose, AI included, is open to everyone
// (D-13 revised); there is no age gate.
func (s *Server) GrantOrRevokeConsent(w http.ResponseWriter, r *http.Request, _ gen.GrantOrRevokeConsentParams) {
	var req gen.ConsentChange
	if !decodeJSON(w, r, &req, false) {
		return
	}
	lang := ""
	if req.Language != nil {
		lang = *req.Language
	}
	c, err := s.deps.Accounts.ChangeConsent(r.Context(), principalFrom(r.Context()), string(req.Purpose), string(req.Action),
		req.NoticeVersion, lang, req.Recipient)
	if err != nil {
		s.accountError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, consentOut(c))
}

func memberOut(m *accounts.Member) gen.FamilyMember {
	out := gen.FamilyMember{MemberId: ids.Encode(ids.FamilyMember, m.ID), Relation: gen.FamilyMemberRelation(m.Relation), Label: m.Label,
		AgeBand: gen.AgeBand(m.AgeBand), IsMinor: m.IsMinor, CreatedAt: m.CreatedAt.UTC()}
	out.ParentalConsent.Status = gen.FamilyMemberParentalConsentStatus(m.ParentalConsentStatus)
	extras := make([]gen.ParentalExtra, 0, len(m.ParentalExtras))
	for _, e := range m.ParentalExtras {
		extras = append(extras, gen.ParentalExtra(e))
	}
	out.ParentalExtras = &extras
	if m.ParentalConsentID != nil {
		id := ids.Encode(ids.Consent, *m.ParentalConsentID)
		out.ParentalConsent.ConsentId = &id
	}
	return out
}

// ListFamilyMembers is the family-mode list (F-17, proposed).
func (s *Server) ListFamilyMembers(w http.ResponseWriter, r *http.Request) {
	list, err := s.deps.Accounts.Members(r.Context(), principalFrom(r.Context()))
	if err != nil {
		s.accountError(w, r, err)
		return
	}
	items := make([]gen.FamilyMember, 0, len(list))
	for _, m := range list {
		items = append(items, memberOut(m))
	}
	writeJSON(w, http.StatusOK, gen.FamilyMemberPage{Items: items})
}

// AddFamilyMember adds a family member; the band is computed server-side.
func (s *Server) AddFamilyMember(w http.ResponseWriter, r *http.Request, _ gen.AddFamilyMemberParams) {
	var req gen.FamilyMemberCreate
	if !decodeJSON(w, r, &req, false) {
		return
	}
	if req.Dob == nil {
		validation(w, r, "/dob", "required")
		return
	}
	if req.DobPrecision != gen.FamilyMemberCreateDobPrecisionDay && req.DobPrecision != gen.FamilyMemberCreateDobPrecisionYearOnly {
		validation(w, r, "/dob_precision", "invalid_enum")
		return
	}
	label := ""
	if req.Label != nil {
		label = *req.Label
	}
	m, err := s.deps.Accounts.AddMember(r.Context(), principalFrom(r.Context()), accounts.NewMember{
		Relation: string(req.Relation), Label: label, DOBPrecision: string(req.DobPrecision),
		DOB: time.Date(req.Dob.Year(), req.Dob.Month(), req.Dob.Day(), 0, 0, 0, 0, servertime.IST),
	})
	if err != nil {
		s.accountError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, memberOut(m))
}

// RecordParentalConsent records the adult account holder's parental consent for a minor member.
func (s *Server) RecordParentalConsent(w http.ResponseWriter, r *http.Request, memberID string, _ gen.RecordParentalConsentParams) {
	id, err := ids.Decode(ids.FamilyMember, memberID)
	if err != nil {
		notFound(w, r)
		return
	}
	var req gen.ParentalConsentChange
	if !decodeJSON(w, r, &req, false) {
		return
	}
	lang := ""
	if req.Language != nil {
		lang = string(*req.Language)
	}
	var extras *[]string
	if req.Extras != nil {
		list := make([]string, 0, len(*req.Extras))
		for _, e := range *req.Extras {
			list = append(list, string(e))
		}
		extras = &list
	}
	m, err := s.deps.Accounts.RecordParentalConsentExtras(r.Context(), principalFrom(r.Context()), id, string(req.Action), req.NoticeVersion, lang, extras)
	if err != nil {
		s.accountError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, memberOut(m))
}
