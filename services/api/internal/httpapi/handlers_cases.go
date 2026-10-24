package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/cases"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

func principalApplicant(p *accounts.Principal) *uuid.UUID {
	if p == nil {
		return nil
	}
	id := p.ApplicantID
	return &id
}

func istDay(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, servertime.IST)
}

// caseError maps case-service errors to problem+json.
func (s *Server) caseError(w http.ResponseWriter, r *http.Request, err error) {
	var ve *cases.ValidationError
	var ce *cases.ConflictError
	switch {
	case errors.As(err, &ve):
		code := ve.Code
		if code == "PROHIBITED_FIELD" {
			writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Detail: ve.Detail,
				Errors: []FieldError{{Pointer: ve.Pointer, Code: "PROHIBITED_FIELD", MessageKey: "errors.prohibited_field"}}})
			return
		}
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Detail: ve.Detail,
			Errors: []FieldError{{Pointer: ve.Pointer, Code: code, MessageKey: "errors." + strings.ToLower(code)}}})
	case errors.As(err, &ce):
		p := Problem{Status: http.StatusConflict, Code: ce.Code, Detail: ce.Detail}
		if ce.Pointer != "" {
			p.Errors = []FieldError{{Pointer: ce.Pointer, Code: ce.Code}}
		}
		writeProblem(w, r, p)
	case errors.Is(err, cases.ErrNotFound):
		notFound(w, r)
	case errors.Is(err, cases.ErrPrecondition):
		writeProblem(w, r, Problem{Status: http.StatusPreconditionFailed, Code: "PRECONDITION_FAILED", Detail: "the case changed on another device; fetch it, merge and retry"})
	case errors.Is(err, privacy.ErrParentalConsentRequired):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "PARENT_CONSENT_REQUIRED",
			Detail: "This family member is under 18; the account holder must record parental consent first."})
	case errors.Is(err, cases.ErrRulesMissing):
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "RULEPACK_UNAVAILABLE", Retryable: true, RetryAfter: 30 * time.Second})
	case ports.KindOf(err) != "":
		s.adapterError(w, r, err)
	default:
		s.deps.Log.ErrorContext(r.Context(), "case error", "err", err)
		internalError(w, r)
	}
}

func factsMap(f *gen.PlanFacts) map[string]any {
	if f == nil {
		return nil
	}
	out := map[string]any{}
	set := func(k string, v *bool) {
		if v != nil {
			out[k] = *v
		}
	}
	set("aadhaar_address_matches_residence", f.AadhaarAddressMatchesResidence)
	set("aadhaar_has_relation_line", f.AadhaarHasRelationLine)
	set("aadhaar_mobile_linked", f.AadhaarMobileLinked)
	set("home_test_device", f.HomeTestDevice)
	set("has_test_vehicle", f.HasTestVehicle)
	set("holds_foreign_licence", f.HoldsForeignLicence)
	set("moving_state", f.MovingState)
	set("nri", f.Nri)
	if f.DisabilityNeeds != nil {
		d := []any{}
		for _, x := range *f.DisabilityNeeds {
			d = append(d, string(x))
		}
		out["disability_needs"] = d
	}
	return out
}

// rawFacts reads the facts object keeping explicit nulls (merge patch: null clears a fact).
func rawFacts(body []byte) map[string]any {
	var m struct {
		Facts map[string]any `json:"facts"`
	}
	if json.Unmarshal(body, &m) != nil {
		return nil
	}
	return m.Facts
}

func (s *Server) writeCase(w http.ResponseWriter, status int, v *cases.View) {
	w.Header().Set("ETag", v.ETag())
	writeJSON(w, status, v)
}

// CreateCase is API-10 (MD-109).
func (s *Server) CreateCase(w http.ResponseWriter, r *http.Request, _ gen.CreateCaseParams) {
	var req gen.CaseCreate
	if !decodeJSON(w, r, &req, false) {
		return
	}
	in := cases.CreateInput{Facts: factsMap(req.Facts)}
	if req.PlanId != nil {
		in.PlanRef = *req.PlanId
	}
	if req.State != nil {
		in.State = string(*req.State)
	}
	for _, c := range req.Classes {
		in.Classes = append(in.Classes, string(c))
	}
	if req.Path != nil {
		in.Path = string(*req.Path)
	}
	if req.FamilyMemberId != nil {
		in.FamilyMemberID = *req.FamilyMemberId
	} else if req.ForFamilyMember != nil && *req.ForFamilyMember {
		validation(w, r, "/family_member_id", "required")
		return
	}
	if l := req.ExistingLl; l != nil {
		ll := &cases.LLInput{IssuedOn: istDay(l.IssuedOn.Year(), l.IssuedOn.Month(), l.IssuedOn.Day()),
			ExpiresOn: istDay(l.ExpiresOn.Year(), l.ExpiresOn.Month(), l.ExpiresOn.Day())}
		for _, c := range l.Classes {
			ll.Classes = append(ll.Classes, string(c))
		}
		if l.NumberLast4 != nil {
			ll.NumberLast4 = *l.NumberLast4
		}
		in.ExistingLL = ll
	}
	if d := req.ExistingDl; d != nil {
		dl := &cases.DLInput{ValidToNT: istDay(d.ValidToNonTransport.Year(), d.ValidToNonTransport.Month(), d.ValidToNonTransport.Day()), Source: string(d.Source)}
		if d.IssuedOn != nil {
			t := istDay(d.IssuedOn.Year(), d.IssuedOn.Month(), d.IssuedOn.Day())
			dl.IssuedOn = &t
		}
		if d.ValidToTransport != nil {
			t := istDay(d.ValidToTransport.Year(), d.ValidToTransport.Month(), d.ValidToTransport.Day())
			dl.ValidToTR = &t
		}
		for _, c := range d.Classes {
			dl.Classes = append(dl.Classes, string(c))
		}
		if d.NumberLast4 != nil {
			dl.NumberLast4 = *d.NumberLast4
		}
		in.ExistingDL = dl
	}
	v, err := s.deps.Cases.Create(r.Context(), principalFrom(r.Context()), tenantFrom(r.Context()), in)
	if err != nil {
		s.caseError(w, r, err)
		return
	}
	w.Header().Set("Location", "/v1/cases/"+v.CaseID)
	s.writeCase(w, http.StatusCreated, v)
}

// GetCase is API-11.
func (s *Server) GetCase(w http.ResponseWriter, r *http.Request, caseID gen.CaseId) {
	v, err := s.deps.Cases.Get(r.Context(), principalFrom(r.Context()), tenantFrom(r.Context()), string(caseID))
	if err != nil {
		s.caseError(w, r, err)
		return
	}
	s.writeCase(w, http.StatusOK, v)
}

// AutosaveCase is API-12: RFC 7396 merge patch with If-Match.
func (s *Server) AutosaveCase(w http.ResponseWriter, r *http.Request, caseID gen.CaseId, params gen.AutosaveCaseParams) {
	ifMatch, ok := cases.ParseIfMatch(string(params.IfMatch))
	if !ok {
		writeProblem(w, r, Problem{Status: http.StatusBadRequest, Code: "BAD_REQUEST", Detail: "If-Match must be the case ETag, e.g. W/\"3\""})
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeProblem(w, r, Problem{Status: http.StatusRequestEntityTooLarge, Code: "VALIDATION_FAILED", Detail: "request body too large"})
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	var req gen.CasePatch
	if !decodeJSON(w, r, &req, false) {
		return
	}
	in := cases.PatchInput{Facts: rawFacts(body)}
	if req.Answers != nil {
		in.Answers, in.HasAnswers = *req.Answers, true
	}
	if req.Classes != nil {
		in.Classes = []string{}
		for _, c := range *req.Classes {
			in.Classes = append(in.Classes, string(c))
		}
	}
	if req.Path != nil {
		p := string(*req.Path)
		in.Path = &p
	}
	// family_member_id: present with a string reassigns to that member, present with null back to
	// the account holder (merge-patch semantics, so presence is read from the raw body).
	var keys map[string]json.RawMessage
	if json.Unmarshal(body, &keys) == nil {
		if _, ok := keys["family_member_id"]; ok {
			in.SetMember, in.MemberRef = true, req.FamilyMemberId
		}
	}
	v, err := s.deps.Cases.Autosave(r.Context(), principalFrom(r.Context()), tenantFrom(r.Context()), string(caseID), ifMatch, in)
	if err != nil {
		s.caseError(w, r, err)
		return
	}
	s.writeCase(w, http.StatusOK, v)
}

// DeleteCase is API-17 (EC-26).
func (s *Server) DeleteCase(w http.ResponseWriter, r *http.Request, caseID gen.CaseId) {
	if err := s.deps.Cases.Delete(r.Context(), principalFrom(r.Context()), tenantFrom(r.Context()), string(caseID)); err != nil {
		s.caseError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetBlockers is API-13 (MD-106).
func (s *Server) GetBlockers(w http.ResponseWriter, r *http.Request, caseID gen.CaseId) {
	v, err := s.deps.Cases.Blockers(r.Context(), principalFrom(r.Context()), tenantFrom(r.Context()), string(caseID))
	if err != nil {
		s.caseError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// GetTimeline is API-14 (MD-125, EC-15).
func (s *Server) GetTimeline(w http.ResponseWriter, r *http.Request, caseID gen.CaseId, params gen.GetTimelineParams) {
	cursor, limit := "", 20
	if params.Cursor != nil {
		cursor = string(*params.Cursor)
	}
	if params.Limit != nil {
		limit = int(*params.Limit)
		if limit < 1 || limit > 100 {
			validation(w, r, "/limit", "out_of_range")
			return
		}
	}
	page, err := s.deps.Cases.Timeline(r.Context(), principalFrom(r.Context()), tenantFrom(r.Context()), string(caseID), cursor, limit)
	if err != nil {
		s.caseError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// RecordCaseEvent is API-15 (MD-117, MD-121).
func (s *Server) RecordCaseEvent(w http.ResponseWriter, r *http.Request, caseID gen.CaseId, params gen.RecordCaseEventParams) {
	var req gen.CaseEventCreate
	if !decodeJSON(w, r, &req, false) {
		return
	}
	if !req.Type.Valid() {
		validation(w, r, "/type", "invalid_enum")
		return
	}
	in := cases.EventInput{Type: string(req.Type), OccurredOn: istDay(req.OccurredOn.Year(), req.OccurredOn.Month(), req.OccurredOn.Day())}
	if pl := req.Payload; pl != nil {
		if pl.Classes != nil {
			for _, c := range *pl.Classes {
				in.Classes = append(in.Classes, string(c))
			}
		}
		if pl.ClassCode != nil {
			in.ClassCode = string(*pl.ClassCode)
		}
		if pl.Test != nil {
			in.Test = string(*pl.Test)
		}
		if pl.OfficeId != nil {
			in.OfficeID = *pl.OfficeId
		}
		if pl.SlotDate != nil {
			d := istDay(pl.SlotDate.Year(), pl.SlotDate.Month(), pl.SlotDate.Day())
			in.SlotDate = &d
		}
		if pl.ReasonCodes != nil {
			for _, rc := range *pl.ReasonCodes {
				if !tokenRe.MatchString(rc) {
					validation(w, r, "/payload/reason_codes", "invalid_code")
					return
				}
			}
			in.ReasonCodes = *pl.ReasonCodes
		}
		if pl.NumberLast4 != nil {
			in.NumberLast4 = strings.ToUpper(*pl.NumberLast4)
		}
		if pl.ValidTo != nil {
			d := istDay(pl.ValidTo.Year(), pl.ValidTo.Month(), pl.ValidTo.Day())
			in.ValidTo = &d
		}
		if pl.RemedialTrainingAck != nil {
			in.RemedialAck = *pl.RemedialTrainingAck
		}
	}
	key := ""
	if params.IdempotencyKey != nil {
		key = string(*params.IdempotencyKey)
	}
	res, err := s.deps.Cases.RecordEvent(r.Context(), principalFrom(r.Context()), tenantFrom(r.Context()), string(caseID), in, key)
	if err != nil {
		s.caseError(w, r, err)
		return
	}
	v := res.View
	out := map[string]any{
		"event": map[string]any{"seq": res.Seq, "type": string(req.Type), "occurred_on": res.OccurredOn, "recorded_at": res.RecordedAt.UTC()},
		"case": map[string]any{"case_id": v.CaseID, "state": v.State, "stage": v.Stage, "display_stage": v.DisplayStage, "next_action": v.NextAction,
			"version": v.Version},
		"idempotent_replay": res.Replay,
		"timeline_changes":  map[string]any{"scheduled": nonNil(res.Scheduled), "cancelled": nonNil(res.Cancelled)},
		"warnings":          res.Warnings,
	}
	if res.Warnings == nil {
		out["warnings"] = []any{}
	}
	w.Header().Set("ETag", v.ETag())
	writeJSON(w, http.StatusCreated, out)
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// GetHandoff is API-16 (MD-114 Mode A, MD-116 Mode B skeleton).
func (s *Server) GetHandoff(w http.ResponseWriter, r *http.Request, caseID gen.CaseId, params gen.GetHandoffParams) {
	step := ""
	if params.Step != nil {
		if !params.Step.Valid() {
			validation(w, r, "/step", "invalid_enum")
			return
		}
		step = string(*params.Step)
	}
	out, err := s.deps.Cases.Handoff(r.Context(), principalFrom(r.Context()), tenantFrom(r.Context()), string(caseID), step)
	if err != nil {
		s.caseError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// CreatePaymentIntent is API-19 (EC-09).
func (s *Server) CreatePaymentIntent(w http.ResponseWriter, r *http.Request, caseID gen.CaseId, _ gen.CreatePaymentIntentParams) {
	var req gen.CreatePaymentIntentJSONBody
	if !decodeJSON(w, r, &req, false) {
		return
	}
	stage, ret := "", ""
	if req.Stage != nil {
		stage = string(*req.Stage)
	}
	if req.ReturnPath != nil {
		ret = *req.ReturnPath
	}
	out, err := s.deps.Cases.PaymentIntent(r.Context(), principalFrom(r.Context()), tenantFrom(r.Context()), string(caseID), req.QuoteId, stage, ret)
	if err != nil {
		s.caseError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

// GetMyLicences is the My Licence tab (MD-124).
func (s *Server) GetMyLicences(w http.ResponseWriter, r *http.Request) {
	out, err := s.deps.Cases.Licences(r.Context(), principalFrom(r.Context()), tenantFrom(r.Context()))
	if err != nil {
		s.caseError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
