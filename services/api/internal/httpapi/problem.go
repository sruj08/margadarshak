package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
)

// problemBase is the placeholder host for problem type URIs (owner Backend lead, 2026-10-30).
const problemBase = "https://margdarshak.example/problems/"

// FieldError is one RFC 6901 pointer-level error.
type FieldError struct {
	Pointer    string `json:"pointer"`
	Code       string `json:"code"`
	MessageKey string `json:"message_key,omitempty"`
}

// Problem is an RFC 9457 problem with the Margdarshak extensions (api/openapi.yaml Problem).
type Problem struct {
	Status     int
	Code       string
	Title      string
	Detail     string
	Errors     []FieldError
	Retryable  bool
	RetryAfter time.Duration
}

var problemTitles = map[string]string{
	"VALIDATION_FAILED":          "Validation failed",
	"PROHIBITED_FIELD":           "This information is never collected",
	"UNAUTHENTICATED":            "Sign-in needed",
	"FORBIDDEN":                  "Not allowed",
	"CSRF_REJECTED":              "Request blocked",
	"PARENT_CONSENT_REQUIRED":    "A parent's consent is needed",
	"CONSENT_REQUIRED":           "Consent needed",
	"NOT_FOUND":                  "Not found",
	"METHOD_NOT_ALLOWED":         "Method not allowed",
	"GONE_DELETED":               "Deleted",
	"PRECONDITION_FAILED":        "Edited elsewhere",
	"IDEMPOTENCY_KEY_REUSED":     "Idempotency key reused",
	"IDEMPOTENCY_IN_PROGRESS":    "Request still in progress",
	"JOURNEY_INVALID_TRANSITION": "This step is not available yet",
	"JOURNEY_TOO_EARLY":          "Too early for this step",
	"JOURNEY_REMEDIAL_REQUIRED":  "Remedial training first",
	"CASE_EXISTS":                "A case already exists",
	"QUOTE_STALE":                "The fee table changed",
	"PAYMENT_PENDING":            "A payment is still pending",
	"RULEPACK_UNAVAILABLE":       "Rules for this state are not available",
	"RATE_LIMITED":               "Too many requests",
	"ADAPTER_UNAVAILABLE":        "A connected service is not responding",
	"NOT_IMPLEMENTED":            "Not available yet",
	"TENANT_UNKNOWN":             "Unknown state",
	"BAD_REQUEST":                "Malformed request",
	"INTERNAL":                   "Something went wrong",
}

func (p Problem) slug() string {
	return strings.ReplaceAll(strings.ToLower(p.Code), "_", "-")
}

// writeProblem writes application/problem+json. Error text never echoes user input or PII.
func writeProblem(w http.ResponseWriter, r *http.Request, p Problem) {
	if p.Title == "" {
		p.Title = problemTitles[p.Code]
	}
	if p.Title == "" {
		p.Title = http.StatusText(p.Status)
	}
	code, typ, inst := p.Code, problemBase+p.slug(), r.URL.Path
	titleKey := "errors." + strings.ToLower(p.Code)
	trace := traceID(r.Context())
	body := gen.Problem{Type: typ, Title: p.Title, Status: p.Status, Code: &code, Instance: &inst, TitleKey: &titleKey, TraceId: &trace}
	if p.Detail != "" {
		body.Detail = &p.Detail
	}
	if p.Retryable {
		body.Retryable = &p.Retryable
	}
	if len(p.Errors) > 0 {
		errs := make([]struct {
			Code       string  `json:"code"`
			MessageKey *string `json:"message_key,omitempty"`
			Pointer    string  `json:"pointer"`
		}, len(p.Errors))
		for i, e := range p.Errors {
			errs[i].Code, errs[i].Pointer = e.Code, e.Pointer
			if e.MessageKey != "" {
				mk := e.MessageKey
				errs[i].MessageKey = &mk
			}
		}
		body.Errors = &errs
	}
	if p.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(p.RetryAfter.Seconds()+0.999)))
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(p.Status)
	_ = json.NewEncoder(w).Encode(body)
}

func notFound(w http.ResponseWriter, r *http.Request) {
	writeProblem(w, r, Problem{Status: http.StatusNotFound, Code: "NOT_FOUND"})
}

func badRequest(w http.ResponseWriter, r *http.Request, detail string) {
	writeProblem(w, r, Problem{Status: http.StatusBadRequest, Code: "BAD_REQUEST", Detail: detail})
}

func validation(w http.ResponseWriter, r *http.Request, pointer, code string) {
	writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Detail: "1 field failed validation",
		Errors: []FieldError{{Pointer: pointer, Code: code, MessageKey: "errors." + strings.ToLower(code)}}})
}

func internalError(w http.ResponseWriter, r *http.Request) {
	writeProblem(w, r, Problem{Status: http.StatusInternalServerError, Code: "INTERNAL", Retryable: true})
}

// writeJSON writes a JSON response.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
