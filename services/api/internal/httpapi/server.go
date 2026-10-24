// Package httpapi is the inbound HTTP adapter (MD-046, MD-055). Routing, parameter binding and
// the operation list are generated from api/openapi.yaml (oapi-codegen chi-server, package gen);
// authentication is enforced from the spec's own security requirements (gen.Operations), so a
// route cannot drift from its contract. Operations not built yet answer 501 problem+json.
//
// Middleware order (outermost first): request id -> recover -> OpenTelemetry -> access log ->
// security headers -> CORS -> body limit -> [routing] -> tenant -> auth (+CSRF) -> rate limit.
package httpapi

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/adapters"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/coach"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/commentary"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/debrief"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/decoder"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/scam"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/signsnap"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/tutor"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/voiceguide"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/speech"
	"github.com/sruj08/margadarshak/services/api/internal/analytics"
	"github.com/sruj08/margadarshak/services/api/internal/cases"
	"github.com/sruj08/margadarshak/services/api/internal/clips"
	clocksvc "github.com/sruj08/margadarshak/services/api/internal/clock"
	"github.com/sruj08/margadarshak/services/api/internal/dsr"
	"github.com/sruj08/margadarshak/services/api/internal/games"
	"github.com/sruj08/margadarshak/services/api/internal/gamify"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/jobs"
	"github.com/sruj08/margadarshak/services/api/internal/lab"
	"github.com/sruj08/margadarshak/services/api/internal/learn"
	"github.com/sruj08/margadarshak/services/api/internal/notify"
	"github.com/sruj08/margadarshak/services/api/internal/plans"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/platform/ratelimit"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/seed"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/study"
	"github.com/sruj08/margadarshak/services/api/internal/tenant"
)

// CookieName is the session cookie (api/openapi.yaml securitySchemes.deviceSession).
const CookieName = "md_sid"

// Deps are the services the HTTP layer uses.
type Deps struct {
	Log            *slog.Logger
	DB             *store.DB
	Clock          servertime.Clock
	Tenants        *tenant.Service
	Accounts       *accounts.Service
	Jobs           *jobs.Service
	Notify         *notify.Service
	Registry       *adapters.Registry
	Vault          *privacy.Vault
	Limiter        ratelimit.Limiter
	InternalHMAC   *hmacsig.Verifier
	InternalTokens []string
	CORSOrigins    []string
	PublicBaseURL  string
	WebBaseURL     string
	CookieSecure   bool
	TrustProxy     bool
	// DeviceSessionRateLimit overrides the createDeviceSession limit per IP and hour (0 = 10).
	DeviceSessionRateLimit int
	Version                string
	Commit                 string
	// Ping checks optional dependencies for deep health (name -> check).
	Ping map[string]func(context.Context) error

	// P1 journey services.
	Plans     *plans.Service
	Cases     *cases.Service
	CaseClock *clocksvc.Service
	DSR       *dsr.Service
	Analytics *analytics.Service
	Lab       *lab.Service
	LabTokens []string
	// DemoPersonas allows the persona switcher (dev/test only; the tenant flag decides per tenant).
	DemoPersonas bool
	// TestNumber marks WhatsApp sends as going through the Meta test number (demo tenant).
	TestNumber bool
	Seed       seed.Deps

	// P2 services (plan §2.1). A nil service makes its endpoints answer 503.
	Games      *games.Service
	Learn      *learn.Service
	Gamify     *gamify.Service
	Clips      *clips.Service
	Study      *study.Service
	StudyStore *store.StudyStore
	Staircase  store.GamesStaircase
	// MockMedia serves /mock/media/* (OBJECT_STORE=mock, decision D5).
	MockMedia   http.Handler
	ObjectStore ports.ObjectStore
	// WebBaseURLShare is where API-57 redirects for the share-card image (the web renders it).
	WebBaseURLShare string
	// N8NResumeToken is sent as X-MD-Resume-Token when a saved rating resumes a W08 Wait node
	// (N8N_RESUME_AUTH_TOKEN); empty disables the resume (W08 then times out to review_timeout).
	N8NResumeToken string
	// ResumeHTTP posts the resume; nil uses a client with a 5 s timeout.
	ResumeHTTP *http.Client
	// Scam is the API-43 checker (rules + optional Google ADK explainer); nil answers 503.
	Scam *scam.Checker
	// Debrief (API-36), Tutor (API-41) and Decoder (API-42): Google ADK agents behind a consent gate.
	Debrief *debrief.Generator
	Tutor   *tutor.Tutor
	Decoder *decoder.Decoder
	// P3 agents: commentary transcription (API-74), Sign Snap (API-75), the weekly coach plan
	// (API-76) and the voice guide (API-40) with its Dogri speech port. Nil answers 503.
	Commentary commentary.Transcriber
	SignSnap   *signsnap.Snapper
	Coach      *coach.Coach
	Voice      *voiceguide.Guide
	Speech     speech.Port
	// VoiceCapMin is the monthly voice minutes per account (MD_VOICE_MONTHLY_CAP_MIN; 0 = 10).
	VoiceCapMin int
}

// Server implements gen.ServerInterface. Operations it does not override come from
// gen.Unimplemented (501, converted to problem+json).
type Server struct {
	gen.Unimplemented
	deps  Deps
	root  http.Handler
	voice *voiceState
}

// New builds the HTTP handler.
func New(d Deps) http.Handler {
	if d.Limiter == nil {
		d.Limiter = ratelimit.NewMemory()
	}
	s := &Server{deps: d, voice: newVoiceState()}
	r := chi.NewRouter()
	r.Use(withRequestID, recoverer(d.Log),
		func(next http.Handler) http.Handler { return otelhttp.NewHandler(next, "api") },
		accessLog(d.Log), securityHeaders(d.CookieSecure), cors(d.CORSOrigins), bodyLimit)
	r.NotFound(notFound)
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		writeProblem(w, r, Problem{Status: http.StatusMethodNotAllowed, Code: "METHOD_NOT_ALLOWED"})
	})
	s.mountMockPages(r)
	gen.HandlerWithOptions(s, gen.ChiServerOptions{
		BaseRouter: r,
		// The generated wrapper applies these in reverse: tenant runs first, then auth, then limits.
		Middlewares:      []gen.MiddlewareFunc{s.idempotencyMW, s.rateLimitMW, s.authMW, s.tenantMW},
		ErrorHandlerFunc: s.paramError,
	})
	s.root = r
	return r
}

func (s *Server) paramError(w http.ResponseWriter, r *http.Request, err error) {
	var pointer string
	var ip *gen.InvalidParamFormatError
	var rp *gen.RequiredParamError
	switch {
	case errors.As(err, &ip):
		pointer = ip.ParamName
	case errors.As(err, &rp):
		pointer = rp.ParamName
	}
	writeProblem(w, r, Problem{Status: http.StatusBadRequest, Code: "BAD_REQUEST", Detail: "invalid parameter " + pointer,
		Errors: []FieldError{{Pointer: pointer, Code: "invalid_parameter"}}})
}

// operation finds the contract entry for the matched route.
func operation(r *http.Request) (gen.Operation, bool) {
	rc := chi.RouteContext(r.Context())
	if rc == nil {
		return gen.Operation{}, false
	}
	op, ok := gen.Operations[r.Method+" "+rc.RoutePattern()]
	return op, ok
}

// tenantMW resolves the tenant (MD-056). Paths that carry the state ({state}) resolve it there.
func (s *Server) tenantMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := strings.ToUpper(strings.TrimSpace(r.Header.Get("X-Tenant")))
		// Rule look-ups (API-02/03/05) name a rule pack, not a tenant: any supported pack can be read
		// from any tenant, so the path state does not select the tenant there.
		if st := chi.URLParam(r, "state"); st != "" && header == "" && !strings.HasPrefix(r.URL.Path, "/v1/rules/") {
			header = strings.ToUpper(st)
		}
		if header == "" && r.URL.Query().Get("state") != "" && r.Method == http.MethodGet {
			header = strings.ToUpper(r.URL.Query().Get("state"))
		}
		t, err := s.deps.Tenants.Resolve(r.Context(), header, r.Host)
		switch {
		case errors.Is(err, tenant.ErrUnknown):
			writeProblem(w, r, Problem{Status: http.StatusNotFound, Code: "TENANT_UNKNOWN", Detail: "unknown state/tenant code"})
			return
		case errors.Is(err, tenant.ErrHostMismatch):
			writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "FORBIDDEN", Detail: "tenant not served on this host"})
			return
		case err != nil:
			s.deps.Log.ErrorContext(r.Context(), "tenant resolve failed", "err", err)
			writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Retryable: true, RetryAfter: 5 * time.Second})
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), keyTenant, t)))
	})
}

func sessionToken(r *http.Request) (token string, fromCookie bool) {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer ")), false
	}
	if c, err := r.Cookie(CookieName); err == nil {
		return c.Value, true
	}
	return "", false
}

// authMW enforces the operation's OpenAPI security requirements (OR of AND-sets):
// deviceSession (any session), userBearer [scopes] (session scope in the list), internalBearer +
// internalHmac (service token + Margdarshak-Signature). {} allows anonymous calls.
func (s *Server) authMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		op, ok := operation(r)
		if !ok {
			notFound(w, r)
			return
		}
		t := tenantFrom(r.Context())
		var principal *accounts.Principal
		var fromCookie bool
		if tok, cookie := sessionToken(r); tok != "" && t != nil && !strings.HasPrefix(op.Path, "/internal/") {
			if p, err := s.deps.Accounts.Authenticate(r.Context(), t.TenantID, tok); err == nil {
				principal, fromCookie = p, cookie
			} else if !errors.Is(err, accounts.ErrUnauthenticated) {
				s.deps.Log.ErrorContext(r.Context(), "session lookup failed", "err", err)
			}
		}
		ctx := context.WithValue(r.Context(), keyPrincipal, principal)
		ctx = context.WithValue(ctx, keyCookieAuth, fromCookie)
		r = r.WithContext(ctx)

		allowed, needsInternal := len(op.Security) == 0, false
		for _, req := range op.Security {
			if len(req) == 0 {
				allowed = true
				break
			}
			sat := true
			for _, scheme := range req {
				switch scheme.Scheme {
				case "deviceSession":
					sat = sat && principal != nil
				case "userBearer":
					sat = sat && principal != nil && (len(scheme.Scopes) == 0 || containsFold(scheme.Scopes, principal.Scope))
				case "internalBearer", "internalHmac":
					needsInternal = true
					sat = false
				default:
					sat = false
				}
			}
			if sat {
				allowed = true
				break
			}
		}
		if !allowed && needsInternal {
			if err := s.verifyInternal(r, op); err != nil {
				s.deps.Log.WarnContext(r.Context(), "internal auth rejected", "op", op.OperationID, "reason", err.Error())
				writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Detail: "internal credentials rejected"})
				return
			}
			allowed = true
		}
		if !allowed {
			if principal == nil {
				writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED"})
			} else {
				writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "FORBIDDEN", Detail: "this action needs a signed-in account"})
			}
			return
		}
		// CSRF defence for cookie sessions on unsafe methods (deviceSession scheme description).
		if fromCookie && r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Requested-With") != "margdarshak" {
			writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "CSRF_REJECTED", Detail: "send X-Requested-With: margdarshak"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// verifyInternal checks the service bearer token and the HMAC body signature. The payment
// callback's signature is adapter-specific and is verified by the PaymentPort in the handler.
func (s *Server) verifyInternal(r *http.Request, op gen.Operation) error {
	tok := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	okTok := false
	for _, t := range s.deps.InternalTokens {
		if t != "" && subtle.ConstantTimeCompare([]byte(t), []byte(tok)) == 1 {
			okTok = true
		}
	}
	if !okTok {
		return errors.New("bad or missing bearer token")
	}
	if op.OperationID == "paymentCallback" {
		return nil
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	pq := r.URL.Path
	if r.URL.RawQuery != "" {
		pq += "?" + r.URL.RawQuery
	}
	return s.deps.InternalHMAC.VerifyRequest(r.Context(), r.Method, pq, r.Header.Get(hmacsig.Header), body)
}

func (s *Server) rateLimitMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		op, _ := operation(r)
		if !s.rateLimit(op.OperationID, w, r) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

// decodeJSON reads a JSON body into dst: size-capped, PII-guarded (Aadhaar/VID/OTP values and
// prohibited keys are rejected with 422 PROHIBITED_FIELD, EC-20) and strict (unknown fields are
// rejected, so server-computed fields such as age_band cannot be set by a client).
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any, optional bool) bool {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeProblem(w, r, Problem{Status: http.StatusRequestEntityTooLarge, Code: "VALIDATION_FAILED", Detail: "request body too large"})
		return false
	}
	if len(bytes.TrimSpace(body)) == 0 {
		if optional {
			return true
		}
		badRequest(w, r, "a JSON body is required")
		return false
	}
	viol, err := privacy.ScanJSON(body)
	if err != nil {
		badRequest(w, r, "body is not valid JSON")
		return false
	}
	if viol != nil {
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED",
			Detail: "Margdarshak never collects Aadhaar numbers, VIDs or OTPs.",
			Errors: []FieldError{{Pointer: viol.Pointer, Code: "PROHIBITED_FIELD", MessageKey: "errors.prohibited_field"}}})
		return false
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		pointer, code := "", "invalid"
		var ute *json.UnmarshalTypeError
		switch {
		case errors.As(err, &ute):
			pointer, code = "/"+strings.ReplaceAll(ute.Field, ".", "/"), "wrong_type"
		case strings.HasPrefix(err.Error(), "json: unknown field "):
			pointer, code = "/"+strings.Trim(strings.TrimPrefix(err.Error(), "json: unknown field "), `"`), "unknown_field"
		}
		validation(w, r, pointer, code)
		return false
	}
	return true
}

func (s *Server) setSessionCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: token, Path: "/", Expires: expires, MaxAge: int(time.Until(expires).Seconds()),
		HttpOnly: true, Secure: s.deps.CookieSecure, SameSite: http.SameSiteLaxMode})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.deps.CookieSecure, SameSite: http.SameSiteLaxMode})
}

func (s *Server) now() time.Time { return s.deps.Clock.Now() }
