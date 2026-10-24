package httpapi

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	clocksvc "github.com/sruj08/margadarshak/services/api/internal/clock"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/plans"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/rules"
	"github.com/sruj08/margadarshak/services/api/internal/wire"
)

func (s *Server) planError(w http.ResponseWriter, r *http.Request, err error) {
	var ie *plans.InputError
	switch {
	case errors.As(err, &ie):
		validation(w, r, ie.Pointer, ie.Code)
	case errors.Is(err, plans.ErrNoRules):
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "RULEPACK_UNAVAILABLE", Retryable: true, RetryAfter: 30 * time.Second})
	case errors.Is(err, plans.ErrUnknownPack):
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Detail: "We don't have the rules for this state yet",
			Errors: []FieldError{{Pointer: "/state", Code: "no_rule_pack", MessageKey: "errors.no_rule_pack"}}})
	case errors.Is(err, plans.ErrNotFound):
		notFound(w, r)
	default:
		s.deps.Log.ErrorContext(r.Context(), "plan error", "err", err)
		internalError(w, r)
	}
}

func boolv(p *bool) bool { return p != nil && *p }

// CreatePlan is API-01: the 3-tap plan (MD-102), class planner (MD-105) and blockers (MD-106).
func (s *Server) CreatePlan(w http.ResponseWriter, r *http.Request, _ gen.CreatePlanParams) {
	var req gen.PlanRequest
	if !decodeJSON(w, r, &req, false) {
		return
	}
	in := plans.Request{State: strings.ToUpper(string(req.State)), AgeYears: req.AgeYears,
		AadhaarAddressMatchesResidence: req.AadhaarAddressMatchesResidence, AadhaarHasRelationLine: req.AadhaarHasRelationLine,
		AadhaarMobileLinked: req.AadhaarMobileLinked, HomeTestDevice: req.HomeTestDevice, HasTestVehicle: req.HasTestVehicle,
		HoldsDL: boolv(req.HoldsDl), ForeignLicence: boolv(req.HoldsForeignLicence), MovingState: boolv(req.MovingState), NRI: boolv(req.Nri)}
	if req.Dob != nil {
		d := time.Date(req.Dob.Year(), req.Dob.Month(), req.Dob.Day(), 0, 0, 0, 0, servertime.IST)
		in.DOB = &d
	}
	if req.DobPrecision != nil {
		in.DOBPrecision = string(*req.DobPrecision)
	}
	if req.Vehicles != nil {
		for _, v := range *req.Vehicles {
			if !v.Valid() {
				validation(w, r, "/vehicles", "invalid_enum")
				return
			}
			in.Vehicles = append(in.Vehicles, string(v))
		}
	}
	if req.Classes != nil {
		for _, c := range *req.Classes {
			in.Classes = append(in.Classes, string(c))
		}
	}
	if req.DisabilityNeeds != nil {
		for _, d := range *req.DisabilityNeeds {
			in.Disability = append(in.Disability, string(d))
		}
	}
	if req.LlIssuedOn != nil {
		d := time.Date(req.LlIssuedOn.Year(), req.LlIssuedOn.Month(), req.LlIssuedOn.Day(), 0, 0, 0, 0, servertime.IST)
		in.LLIssuedOn = &d
	}
	if req.Language != nil {
		in.Language = string(*req.Language)
	}
	t := tenantFrom(r.Context())
	p := principalFrom(r.Context())
	plan, err := s.deps.Plans.Compute(r.Context(), t.TenantID, principalApplicant(p), in)
	if err != nil {
		s.planError(w, r, err)
		return
	}
	w.Header().Set("Location", "/v1/plans/"+plan["plan_id"].(string))
	writeJSON(w, http.StatusCreated, plan)
}

// GetPlan reads a stored plan snapshot (the API-04 link).
func (s *Server) GetPlan(w http.ResponseWriter, r *http.Request, planID gen.PlanId) {
	snap, err := s.deps.Plans.Get(r.Context(), tenantFrom(r.Context()).TenantID, string(planID))
	if err != nil {
		s.planError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, snap.Plan)
}

var phoneRe = regexp.MustCompile(`^\+91[6-9]\d{9}$`)

// SendPlanToWhatsApp is API-04 (MD-104).
func (s *Server) SendPlanToWhatsApp(w http.ResponseWriter, r *http.Request, planID gen.PlanId, _ gen.SendPlanToWhatsAppParams) {
	var req gen.WhatsAppSendRequest
	if !decodeJSON(w, r, &req, false) {
		return
	}
	if !phoneRe.MatchString(req.PhoneE164) {
		validation(w, r, "/phone_e164", "invalid_phone")
		return
	}
	if req.Consent.Purpose != gen.ConsentPurposeWhatsappUpdates {
		validation(w, r, "/consent/purpose", "must_be_whatsapp_updates")
		return
	}
	if strings.TrimSpace(req.Consent.NoticeVersion) == "" || len(req.Consent.NoticeVersion) > 64 {
		validation(w, r, "/consent/notice_version", "required")
		return
	}
	t, p := tenantFrom(r.Context()), principalFrom(r.Context())
	if _, err := s.deps.Plans.Get(r.Context(), t.TenantID, string(planID)); err != nil {
		s.planError(w, r, err)
		return
	}
	// 3 sends a day per phone number (API_SPEC §1.8 messaging tier); the key is a blind index.
	blind := s.deps.Vault.BlindIndex(t.TenantID, "phone", req.PhoneE164[3:])
	if d, err := s.deps.Limiter.Allow(r.Context(), "messaging-phone:"+string(blind), 3, 24*time.Hour); err == nil && !d.Allowed {
		writeProblem(w, r, Problem{Status: http.StatusTooManyRequests, Code: "RATE_LIMITED", Retryable: true, RetryAfter: d.RetryAfter})
		return
	}
	lang := "en"
	if req.Language != nil {
		lang = string(*req.Language)
	}
	res, err := s.deps.CaseClock.SendPlanCard(r.Context(), p, t.TenantID, string(planID), req.PhoneE164[3:], req.Consent.NoticeVersion, lang, req.Consent.Granted)
	if errors.Is(err, clocksvc.ErrConsentRequired) {
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "CONSENT_REQUIRED",
			Detail: "Without WhatsApp consent nothing is stored; share the plan link instead: " + res.ShareURL})
		return
	}
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "plan whatsapp failed", "err", err)
		internalError(w, r)
		return
	}
	status := res.Status
	switch status {
	case "queued", "sent", "failed", "suppressed_quiet_hours", "suppressed_opt_out", "suppressed_daily_cap":
	default:
		status = "queued"
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"notification_id": res.NotificationID, "status": status, "channel": res.Channel,
		"template_id": res.TemplateID, "plan_url": res.PlanURL, "share_url": res.ShareURL, "test_number": s.deps.TestNumber})
}

func (s *Server) pack(w http.ResponseWriter, r *http.Request, state string) (*rules.Compiled, bool) {
	c, err := s.deps.Plans.Pack(state)
	if err != nil {
		if errors.Is(err, plans.ErrUnknownPack) {
			notFound(w, r)
		} else {
			s.planError(w, r, err)
		}
		return nil, false
	}
	return c, true
}

func (s *Server) cacheable(w http.ResponseWriter, r *http.Request, etag string) bool {
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return true
	}
	return false
}

// ListClasses is API-02: every class with its eligibility facts and provenance.
func (s *Server) ListClasses(w http.ResponseWriter, r *http.Request, state gen.State, params gen.ListClassesParams) {
	c, ok := s.pack(w, r, string(state))
	if !ok {
		return
	}
	if params.Version != nil && *params.Version != c.Version {
		notFound(w, r)
		return
	}
	if s.cacheable(w, r, plans.ETag(c, "classes")) {
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
	writeJSONCached(w, http.StatusOK, map[string]any{"state": c.PackID, "rule_pack": plans.PackRef(c), "classes": plans.Classes(c)})
}

// GetFees is API-03: the fee table from fees.json and, with ?classes=, a computed quote.
func (s *Server) GetFees(w http.ResponseWriter, r *http.Request, state gen.State, params gen.GetFeesParams) {
	c, ok := s.pack(w, r, string(state))
	if !ok {
		return
	}
	out := map[string]any{"state": c.PackID, "rule_pack": plans.PackRef(c), "items": plans.FeeItems(c)}
	extra := "fees"
	if params.Classes != nil && len(*params.Classes) > 0 {
		var classes []string
		for _, cl := range *params.Classes {
			if !plans.ValidClass(c, string(cl)) {
				validation(w, r, "/classes", "unknown_class")
				return
			}
			classes = append(classes, string(cl))
		}
		out["quote"] = wire.Quote(c.FeeQuote(classes), plans.QuoteID(c, classes), c.Version)
		extra += ":" + strings.Join(classes, ",")
	}
	if s.cacheable(w, r, plans.ETag(c, extra)) {
		return
	}
	writeJSONCached(w, http.StatusOK, out)
}

// GetLlFormat is API-05 (EC-10: online_test_available).
func (s *Server) GetLlFormat(w http.ResponseWriter, r *http.Request, state gen.State) {
	c, ok := s.pack(w, r, string(state))
	if !ok {
		return
	}
	var langs []string
	if t, err := s.deps.Tenants.Get(r.Context(), c.PackID); err == nil {
		langs = t.Languages
	}
	if s.cacheable(w, r, plans.ETag(c, "ll-format")) {
		return
	}
	writeJSONCached(w, http.StatusOK, plans.Format(c, langs))
}

// writeJSONCached writes JSON keeping the Cache-Control already set.
func writeJSONCached(w http.ResponseWriter, status int, v any) { writeJSON(w, status, v) }
