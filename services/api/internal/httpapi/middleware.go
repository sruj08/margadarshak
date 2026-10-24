package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"slices"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"go.opentelemetry.io/otel/trace"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/platform/ratelimit"
	"github.com/sruj08/margadarshak/services/api/internal/tenant"
)

type ctxKey int

const (
	keyRequestID ctxKey = iota
	keyTenant
	keyPrincipal
	keyCookieAuth
)

func requestID(ctx context.Context) string {
	v, _ := ctx.Value(keyRequestID).(string)
	return v
}

// traceID is the W3C trace id when tracing is on, else the request id.
func traceID(ctx context.Context) string {
	if sc := trace.SpanContextFromContext(ctx); sc.HasTraceID() {
		return sc.TraceID().String()
	}
	return requestID(ctx)
}

func tenantFrom(ctx context.Context) *tenant.Tenant {
	t, _ := ctx.Value(keyTenant).(*tenant.Tenant)
	return t
}

func principalFrom(ctx context.Context) *accounts.Principal {
	p, _ := ctx.Value(keyPrincipal).(*accounts.Principal)
	return p
}

// withRequestID assigns X-Request-Id (accepts a sane inbound one).
func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if len(id) < 8 || len(id) > 64 || strings.ContainsFunc(id, func(c rune) bool { return c <= ' ' || c > '~' }) {
			id = ulid.Make().String()
		}
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), keyRequestID, id)))
	})
}

// recoverer turns panics into 500 problem+json (details only in logs, by trace id).
func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if v := recover(); v != nil {
					if err, ok := v.(error); ok && errors.Is(err, http.ErrAbortHandler) {
						panic(v)
					}
					log.ErrorContext(r.Context(), "panic", "panic", fmt.Sprint(v), "stack", string(debug.Stack()), "trace_id", traceID(r.Context()))
					internalError(w, r)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// securityHeaders sets the API's response hardening headers.
func securityHeaders(hsts bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			h.Set("Cross-Origin-Resource-Policy", "same-site")
			h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
			if hsts {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// cors allows only configured origins (no wildcard; credentials allowed for the md_sid cookie).
func cors(origins []string) func(http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range origins {
		allowed[strings.TrimRight(strings.TrimSpace(o), "/")] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && allowed[origin] {
				h := w.Header()
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Allow-Credentials", "true")
				h.Add("Vary", "Origin")
				h.Set("Access-Control-Expose-Headers", "ETag, X-Request-Id, Retry-After, RateLimit, RateLimit-Policy, Idempotent-Replayed, Location")
				if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
					h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
					h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant, X-Requested-With, X-Request-Id, X-Lab-Token, Idempotency-Key, If-Match, If-None-Match, Prefer, Accept-Language, traceparent, tracestate")
					h.Set("Access-Control-Max-Age", "600")
					w.WriteHeader(http.StatusNoContent)
					return
				}
			} else if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
	// convert501 turns the generated Unimplemented stubs' bare 501 into problem+json.
	convert501 bool
	swallow    bool
	r          *http.Request
}

func (s *statusWriter) WriteHeader(code int) {
	if s.status != 0 {
		return
	}
	s.status = code
	if code == http.StatusNotImplemented && s.convert501 && s.Header().Get("Content-Type") == "" {
		s.swallow = true
		writeProblem(s.ResponseWriter, s.r, Problem{Status: http.StatusNotImplemented, Code: "NOT_IMPLEMENTED",
			Detail: "This endpoint is in the contract but is built in a later phase."})
		return
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.WriteHeader(http.StatusOK)
	}
	if s.swallow {
		return len(b), nil
	}
	return s.ResponseWriter.Write(b)
}

func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// accessLog writes one structured line per request (through the PII-redacting logger) and
// converts bare 501s.
func accessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w, convert501: true, r: r}
			next.ServeHTTP(sw, r)
			if sw.status == 0 {
				sw.status = http.StatusOK
			}
			lvl := slog.LevelInfo
			if sw.status >= 500 && sw.status != http.StatusNotImplemented {
				lvl = slog.LevelError
			}
			if r.URL.Path == "/v1/health" && sw.status == http.StatusOK {
				lvl = slog.LevelDebug
			}
			log.Log(r.Context(), lvl, "http", "method", r.Method, "path", r.URL.Path, "status", sw.status,
				"duration_ms", time.Since(start).Milliseconds(), "request_id", requestID(r.Context()), "trace_id", traceID(r.Context()))
		})
	}
}

// bodyLimit caps request bodies (64 KB JSON default; 2 MB for the Aadhaar mock artefact).
func bodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		limit := int64(64 << 10)
		if strings.HasSuffix(r.URL.Path, "/identity/aadhaar-offline") {
			limit = 2<<20 + 64<<10
		}
		// API-35: a replay of up to 512 KB of base64 plus a 64 KB client result preview.
		if strings.HasPrefix(r.URL.Path, "/v1/games/sessions/") && strings.HasSuffix(r.URL.Path, "/complete") {
			limit = 640 << 10
		}
		if r.ContentLength > limit {
			writeProblem(w, r, Problem{Status: http.StatusRequestEntityTooLarge, Code: "VALIDATION_FAILED", Detail: "request body too large"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		next.ServeHTTP(w, r)
	})
}

// ---- Rate limits (BACKEND §15, API_SPEC §1.8) ------------------------------------------------

type ratePolicy struct {
	name   string
	limit  int
	window time.Duration
	by     string // ip | subject
}

var ratePolicies = map[string]ratePolicy{
	"createDeviceSession":  {"auth-device", 10, time.Hour, "ip"},
	"requestMagicLink":     {"auth-magic-ip", 20, time.Hour, "ip"},
	"exchangeToken":        {"auth-token", 30, time.Minute, "ip"},
	"getHealth":            {"public-read", 120, time.Minute, "ip"},
	"getTenant":            {"public-read", 120, time.Minute, "ip"},
	"listOffices":          {"public-read", 120, time.Minute, "ip"},
	"listSlots":            {"public-read", 120, time.Minute, "ip"},
	"verifyAadhaarOffline": {"user-write", 60, time.Minute, "subject"},
	"addFamilyMember":      {"user-write", 60, time.Minute, "subject"},
	"grantOrRevokeConsent": {"user-write", 60, time.Minute, "subject"},
	// P2 (API_SPEC §1.8 placement, decisions.md §2).
	"startGameSession":     {"games", 60, time.Minute, "subject"},
	"completeGameSession":  {"games", 60, time.Minute, "subject"},
	"getGameSessionReplay": {"games", 120, time.Minute, "subject"},
	"getShareCardData":     {"public-read", 120, time.Minute, "ip"},
	"getShareCard":         {"public-read", 120, time.Minute, "ip"},
	"listNazarClips":       {"public-read", 120, time.Minute, "ip"},
	"enrolNazarStudy":      {"user-write", 20, time.Minute, "subject"},
	"recordNazarNearMiss":  {"user-write", 20, time.Minute, "subject"},
}

const defaultInternalLimit = 600

func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if f := r.Header.Get("X-Forwarded-For"); f != "" {
			return strings.TrimSpace(strings.Split(f, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) rateLimit(op string, w http.ResponseWriter, r *http.Request) bool {
	pol, ok := ratePolicies[op]
	if op == "createDeviceSession" && s.deps.DeviceSessionRateLimit > 0 {
		// DEV_DEVICE_SESSION_RATE_LIMIT (dev/test only; config refuses it elsewhere) for the e2e suites.
		pol.limit = s.deps.DeviceSessionRateLimit
	}
	if !ok {
		switch {
		case strings.HasPrefix(r.URL.Path, "/internal/"):
			pol = ratePolicy{"internal", defaultInternalLimit, time.Minute, "ip"}
		case r.Method == http.MethodGet:
			pol = ratePolicy{"read", 300, time.Minute, "ip"}
		default:
			pol = ratePolicy{"user-write", 60, time.Minute, "subject"}
		}
	}
	key := "ip:" + clientIP(r, s.deps.TrustProxy)
	if pol.by == "subject" {
		if p := principalFrom(r.Context()); p != nil {
			key = "sub:" + p.ApplicantID.String()
		}
	}
	d, err := s.deps.Limiter.Allow(r.Context(), pol.name+":"+key, pol.limit, pol.window)
	if err != nil {
		s.deps.Log.WarnContext(r.Context(), "rate limiter unavailable", "err", err)
		return true // fail open on limiter outage; abuse controls at the edge remain
	}
	w.Header().Set("RateLimit-Policy", fmt.Sprintf(`"%s";q=%d;w=%d`, pol.name, pol.limit, int(pol.window.Seconds())))
	w.Header().Set("RateLimit", fmt.Sprintf(`"%s";r=%d;t=%d`, pol.name, d.Remaining, int(d.Reset.Seconds())))
	if !d.Allowed {
		writeProblem(w, r, Problem{Status: http.StatusTooManyRequests, Code: "RATE_LIMITED", Retryable: true, RetryAfter: d.RetryAfter})
		return false
	}
	return true
}

var _ ratelimit.Limiter = (*ratelimit.Memory)(nil)

func containsFold(list []string, v string) bool {
	return slices.ContainsFunc(list, func(s string) bool { return strings.EqualFold(s, v) })
}
