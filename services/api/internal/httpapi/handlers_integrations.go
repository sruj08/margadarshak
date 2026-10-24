package httpapi

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/digilocker"
	"github.com/sruj08/margadarshak/services/api/internal/audit"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

func (s *Server) adapterError(w http.ResponseWriter, r *http.Request, err error) {
	switch ports.KindOf(err) {
	case ports.KindUnavailable, ports.KindTimeout:
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Retryable: true, RetryAfter: 30 * time.Second,
			Detail: "a connected service is not responding; your draft is kept (offline_draft)"})
	case ports.KindNotFound:
		notFound(w, r)
	case ports.KindProhibited:
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED",
			Detail: "Margdarshak never accepts an Aadhaar number.", Errors: []FieldError{{Pointer: "/artefact", Code: "PROHIBITED_FIELD", MessageKey: "errors.prohibited_field"}}})
	case ports.KindInvalid:
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Detail: "the request was rejected by the adapter"})
	case ports.KindUnsupported:
		writeProblem(w, r, Problem{Status: http.StatusNotImplemented, Code: "NOT_IMPLEMENTED", Detail: "not offered by this tenant's adapter"})
	default:
		s.deps.Log.ErrorContext(r.Context(), "adapter error", "err", err)
		internalError(w, r)
	}
}

// ---- Offices and slots (API-25, API-26) ------------------------------------------------------

func officeOut(o ports.Office) gen.Office {
	code, sample := o.Code, o.SampleData
	lat, lng := float32(o.Lat), float32(o.Lng)
	out := gen.Office{OfficeId: o.ID, Kind: gen.OfficeKind(o.Kind), Code: &code, Name: o.Name, District: o.District, SampleData: &sample}
	out.Location = &struct {
		Lat *float32 `json:"lat,omitempty"`
		Lng *float32 `json:"lng,omitempty"`
	}{Lat: &lat, Lng: &lng}
	tracks := make([]gen.OfficeTracks, 0, len(o.Tracks))
	for _, t := range o.Tracks {
		tracks = append(tracks, gen.OfficeTracks(t))
	}
	out.Tracks = &tracks
	if o.TestMode != "" {
		tm := gen.OfficeTestMode(o.TestMode)
		out.TestMode = &tm
	}
	return out
}

// ListOffices is API-25 (SlotPort; mock offices are labelled sample data).
func (s *Server) ListOffices(w http.ResponseWriter, r *http.Request, params gen.ListOfficesParams) {
	t := tenantFrom(r.Context())
	kind := ""
	if params.Kind != nil {
		if !params.Kind.Valid() {
			validation(w, r, "/kind", "invalid_enum")
			return
		}
		kind = string(*params.Kind)
	}
	offices, err := t.Adapters.Slot.ListOffices(r.Context(), t.TenantID, kind)
	if err != nil {
		s.adapterError(w, r, err)
		return
	}
	items := make([]gen.Office, 0, len(offices))
	for _, o := range offices {
		items = append(items, officeOut(o))
	}
	w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400")
	writeJSON(w, http.StatusOK, gen.OfficePage{Items: items})
}

// ListSlots is API-26: read-only availability; booking stays on Sarathi (D-08).
func (s *Server) ListSlots(w http.ResponseWriter, r *http.Request, officeID gen.OfficeId, params gen.ListSlotsParams) {
	if params.Kind != gen.ListSlotsParamsKindDlTest && params.Kind != gen.ListSlotsParamsKindLlTest {
		validation(w, r, "/kind", "invalid_enum")
		return
	}
	t := tenantFrom(r.Context())
	from := servertime.TodayIST(s.now())
	if params.From != nil {
		from = time.Date(params.From.Year(), params.From.Month(), params.From.Day(), 0, 0, 0, 0, servertime.IST)
	}
	to := from.AddDate(0, 0, 13)
	if params.To != nil {
		to = time.Date(params.To.Year(), params.To.Month(), params.To.Day(), 0, 0, 0, 0, servertime.IST)
	}
	slots, err := t.Adapters.Slot.ListSlots(r.Context(), string(officeID), string(params.Kind), from, to)
	if err != nil {
		if ports.KindOf(err) == ports.KindInvalid {
			validation(w, r, "/to", "invalid_range")
			return
		}
		s.adapterError(w, r, err)
		return
	}
	items := make([]gen.Slot, 0, len(slots))
	source := gen.SlotSourceMock
	for _, sl := range slots {
		sample, sim := sl.Simulated, sl.Simulated
		window := sl.Window
		cb := gen.SlotCapacityBand(sl.CapacityBand)
		items = append(items, gen.Slot{SlotId: sl.ID, OfficeId: sl.OfficeID, Kind: gen.SlotKind(sl.Kind),
			Date: openapi_types.Date{Time: sl.Date}, Window: &window, CapacityBand: &cb, Source: gen.SlotSource(sl.Source),
			SampleData: &sample, Simulated: &sim})
		source = gen.SlotSource(sl.Source)
	}
	writeJSON(w, http.StatusOK, map[string]any{"office_id": string(officeID), "source": source, "as_of": s.now().UTC(), "items": items})
}

// ---- DigiLocker (API-21, API-22; simulated in the hackathon) ---------------------------------

func randomState(tenant string) string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return tenant + "." + base64.RawURLEncoding.EncodeToString(b)
}

// DigilockerAuthorize starts OAuth 2.0 + PKCE (S256). The verifier stays server-side.
func (s *Server) DigilockerAuthorize(w http.ResponseWriter, r *http.Request, params gen.DigilockerAuthorizeParams) {
	t, p := tenantFrom(r.Context()), principalFrom(r.Context())
	if !strings.HasPrefix(params.CaseId, "cas_") || len(params.CaseId) > 40 {
		validation(w, r, "/case_id", "invalid_case_id")
		return
	}
	doctypes := []string{"DRVLC"}
	if params.Doctypes != nil && *params.Doctypes != "" {
		doctypes = strings.Split(*params.Doctypes, ",")
	}
	verifier := digilocker.NewVerifier()
	state := randomState(t.TenantID)
	redirectURI := strings.TrimRight(s.deps.PublicBaseURL, "/") + "/v1/integrations/digilocker/callback"
	redirect, err := t.Adapters.DigiLocker.StartConsent(r.Context(), ports.ConsentRequest{
		Purpose:  "Show your driving licence classes and validity so Margdarshak can plan a renewal or an added class",
		Doctypes: doctypes, State: state, CodeChallenge: digilocker.S256(verifier), Method: "S256", RedirectURI: redirectURI})
	if err != nil {
		s.adapterError(w, r, err)
		return
	}
	caseRef := params.CaseId
	err = s.deps.DB.Tenant(r.Context(), t.TenantID, func(tx pgx.Tx) error {
		return store.InsertOAuthFlow(r.Context(), tx, &store.OAuthFlow{State: state, TenantID: t.TenantID, ApplicantID: p.ApplicantID,
			Provider: "digilocker", CaseRef: &caseRef, Doctypes: doctypes, CodeVerifier: verifier, RedirectURI: redirectURI, ExpiresAt: s.now().Add(10 * time.Minute)})
	})
	if err != nil {
		internalError(w, r)
		return
	}
	http.Redirect(w, r, redirect.URL, http.StatusFound)
}

// DigilockerCallback completes the flow: exchange (PKCE), pull minimal DL facts, revoke the
// token, write the digilocker_pull consent artefact (E-15) and an audit row, return to the app.
func (s *Server) DigilockerCallback(w http.ResponseWriter, r *http.Request, params gen.DigilockerCallbackParams) {
	tenantCode, _, ok := strings.Cut(params.State, ".")
	back := strings.TrimRight(s.deps.WebBaseURL, "/") + "/documents/digilocker"
	if !ok || len(tenantCode) != 2 {
		badRequest(w, r, "invalid state")
		return
	}
	t, err := s.deps.Tenants.Get(r.Context(), tenantCode)
	if err != nil {
		badRequest(w, r, "invalid state")
		return
	}
	var flow *store.OAuthFlow
	if err := s.deps.DB.Tenant(r.Context(), t.TenantID, func(tx pgx.Tx) error {
		var err error
		flow, err = store.ConsumeOAuthFlow(r.Context(), tx, params.State, s.now())
		return err
	}); err != nil {
		badRequest(w, r, "unknown, used or expired state")
		return
	}
	tok, err := t.Adapters.DigiLocker.ExchangeCode(r.Context(), params.Code, flow.CodeVerifier, flow.RedirectURI)
	if err != nil {
		http.Redirect(w, r, back+"?result=failed&reason="+url.QueryEscape(string(ports.KindOf(err))), http.StatusFound)
		return
	}
	facts, err := t.Adapters.DigiLocker.PullLicence(r.Context(), tok.AccessToken)
	_ = t.Adapters.DigiLocker.Revoke(r.Context(), tok.AccessToken) // revoke after pull (data minimisation)
	if err != nil {
		http.Redirect(w, r, back+"?result=failed&reason="+url.QueryEscape(string(ports.KindOf(err))), http.StatusFound)
		return
	}
	err = s.deps.DB.Tenant(r.Context(), t.TenantID, func(tx pgx.Tx) error {
		app, err := store.GetApplicant(r.Context(), tx, flow.ApplicantID)
		if err != nil {
			return err
		}
		p := principalFor(app)
		c, err := s.deps.Accounts.RecordConsent(r.Context(), tx, p, "digilocker_pull", "notice-2026.10.23-en",
			[]string{"dl_classes", "dl_validity", "dl_number_last4"}, nil)
		if err != nil {
			return err
		}
		_, err = audit.Append(r.Context(), tx, s.now(), audit.Entry{Tenant: t.TenantID, Actor: p.Subject(), ActorScope: p.Scope,
			Action: "adapter.digilocker.pull", Target: derefStr(flow.CaseRef), Purpose: "digilocker_pull", ConsentID: &c.ID,
			Meta: map[string]any{"classes": strings.Join(facts.Classes, ","), "simulated": facts.Simulated, "adapter": t.Adapters.DigiLocker.Mode()}})
		return err
	})
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "digilocker callback persist failed", "err", err)
		http.Redirect(w, r, back+"?result=failed&reason=internal", http.StatusFound)
		return
	}
	http.Redirect(w, r, back+"?result=ok&classes="+url.QueryEscape(strings.Join(facts.Classes, ","))+"&valid_to="+facts.ValidToNonTransport.Format(time.DateOnly), http.StatusFound)
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ---- Aadhaar offline (API-18, mock-only) ------------------------------------------------------

// VerifyAadhaarOffline runs the mock-only offline check. The artefact is processed in memory;
// only derived facts are returned and nothing of the artefact is stored.
func (s *Server) VerifyAadhaarOffline(w http.ResponseWriter, r *http.Request, caseID gen.CaseId, _ gen.VerifyAadhaarOfflineParams) {
	t, p := tenantFrom(r.Context()), principalFrom(r.Context())
	cid, err := ids.Decode(ids.Case, string(caseID))
	if err != nil {
		notFound(w, r)
		return
	}
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		badRequest(w, r, "multipart form expected (max 2 MB)")
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()
	kind := r.FormValue("kind")
	consentRef := r.FormValue("consent_id")
	phrase := r.FormValue("share_code")
	file, _, err := r.FormFile("artefact")
	if err != nil {
		validation(w, r, "/artefact", "required")
		return
	}
	payload, err := io.ReadAll(io.LimitReader(file, 2<<20))
	_ = file.Close()
	if err != nil {
		badRequest(w, r, "unreadable artefact")
		return
	}
	consentID, err := ids.Decode(ids.Consent, consentRef)
	if err != nil {
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "CONSENT_REQUIRED", Detail: "consent aadhaar_offline_check is required"})
		return
	}
	var verdict ports.OfflineVerdict
	err = s.deps.DB.Tenant(r.Context(), t.TenantID, func(tx pgx.Tx) error {
		c, err := store.GetCase(r.Context(), tx, cid)
		if err != nil || c.ApplicantID != p.ApplicantID {
			return store.ErrNotFound
		}
		consent, err := store.GetConsent(r.Context(), tx, consentID)
		if err != nil || consent.ApplicantID != p.ApplicantID || consent.Purpose != "aadhaar_offline_check" || consent.RevokedAt != nil {
			return errConsentRequired
		}
		return nil
	})
	if err == nil {
		var verr error
		verdict, verr = t.Adapters.AadhaarOffline.Verify(r.Context(), ports.OfflineArtefact{Kind: kind, Payload: payload, SharePhrase: phrase, ExpectedState: t.TenantID})
		outcome := "ok"
		if verr != nil {
			outcome = string(ports.KindOf(verr))
		}
		err = verr
		if aerr := s.deps.DB.Tenant(r.Context(), t.TenantID, func(tx pgx.Tx) error {
			// Audit records the outcome only (type of failure), never artefact content.
			_, aerr := audit.Append(r.Context(), tx, s.now(), audit.Entry{Tenant: t.TenantID, Actor: p.Subject(), ActorScope: p.Scope,
				Action: "adapter.aadhaar_offline.verify", Target: string(caseID), Purpose: "aadhaar_offline_check", ConsentID: &consentID, Outcome: outcome})
			return aerr
		}); aerr != nil {
			err = aerr
		}
	}
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w, r)
		return
	case errors.Is(err, errConsentRequired):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "CONSENT_REQUIRED", Detail: "consent aadhaar_offline_check is required"})
		return
	case err != nil && ports.KindOf(err) != "":
		if ports.KindOf(err) == ports.KindProhibited {
			s.deps.Log.WarnContext(r.Context(), "pii_trip", "kind", string(privacy.KindAadhaar), "endpoint", "API-18")
		}
		s.adapterError(w, r, err)
		return
	case err != nil:
		internalError(w, r)
		return
	}
	band := gen.AgeBand(verdict.AgeBand)
	prec := gen.AadhaarOfflineVerdictDobPrecision(verdict.DOBPrecision)
	asm, ref := verdict.AddressStateMatches, verdict.ReferenceHash
	writeJSON(w, http.StatusOK, gen.AadhaarOfflineVerdict{SignatureValid: verdict.SignatureValid, AgeBand: &band, DobPrecision: &prec,
		AddressStateMatches: &asm, ReferenceHash: &ref, Simulated: verdict.Simulated, RetainedFields: verdict.RetainedFields})
}

var errConsentRequired = errors.New("consent required")
