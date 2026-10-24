package httpapi

import (
	"bytes"
	"crypto/sha256"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// IdempotencyTTL is how long a stored response is replayed (BACKEND §13, API_SPEC §1.5).
const IdempotencyTTL = 24 * time.Hour

// replayHeaders are the response headers stored with a replayable response.
var replayHeaders = []string{"Content-Type", "ETag", "Location"}

// captureWriter tees the response so it can be stored.
type captureWriter struct {
	http.ResponseWriter
	status int
	buf    bytes.Buffer
}

func (c *captureWriter) WriteHeader(code int) {
	if c.status == 0 {
		c.status = code
	}
	c.ResponseWriter.WriteHeader(code)
}

func (c *captureWriter) Write(b []byte) (int, error) {
	if c.status == 0 {
		c.status = http.StatusOK
	}
	if c.buf.Len() < 256<<10 {
		c.buf.Write(b)
	}
	return c.ResponseWriter.Write(b)
}

// idempotencyMW implements the Idempotency-Key contract for writes: the same key and body replay
// the stored response (Idempotent-Replayed: true); the same key with another body is 422
// IDEMPOTENCY_KEY_REUSED; a request still in flight is 409 IDEMPOTENCY_IN_PROGRESS. The scope is
// the caller (pseudonymous subject, or "internal" for service calls). 5xx responses are not
// stored, so a retry runs again. Domain idempotency (event keys, timeline keys, notification
// keys) backs it up.
func (s *Server) idempotencyMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Idempotency-Key")
		if key == "" || r.Method == http.MethodGet || r.Method == http.MethodHead {
			next.ServeHTTP(w, r)
			return
		}
		if len(key) < 16 || len(key) > 64 {
			writeProblem(w, r, Problem{Status: http.StatusBadRequest, Code: "BAD_REQUEST", Detail: "Idempotency-Key must be 16 to 64 characters",
				Errors: []FieldError{{Pointer: "/headers/Idempotency-Key", Code: "invalid_length"}}})
			return
		}
		t := tenantFrom(r.Context())
		if t == nil {
			next.ServeHTTP(w, r)
			return
		}
		scope := "anonymous:" + clientIP(r, s.deps.TrustProxy)
		if p := principalFrom(r.Context()); p != nil {
			scope = p.Subject()
		} else if len(r.URL.Path) > 10 && r.URL.Path[:10] == "/internal/" {
			scope = "internal"
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeProblem(w, r, Problem{Status: http.StatusRequestEntityTooLarge, Code: "VALIDATION_FAILED", Detail: "request body too large"})
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		sum := sha256.Sum256(append([]byte(r.Method+" "+r.URL.Path+"\n"), body...))
		var claimed bool
		var rec *store.IdemRecord
		err = s.deps.DB.System(r.Context(), func(tx pgx.Tx) error {
			var err error
			claimed, rec, err = store.ClaimIdempotencyKey(r.Context(), tx, t.TenantID, scope, key, r.Method, r.URL.Path, sum[:], IdempotencyTTL)
			return err
		})
		if err != nil {
			s.deps.Log.ErrorContext(r.Context(), "idempotency store failed", "err", err)
			internalError(w, r)
			return
		}
		if !claimed {
			switch {
			case !bytes.Equal(rec.RequestSHA256, sum[:]):
				writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "IDEMPOTENCY_KEY_REUSED",
					Detail: "this Idempotency-Key was used with a different request"})
			case rec.StatusCode == nil:
				writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "IDEMPOTENCY_IN_PROGRESS", Retryable: true, RetryAfter: time.Second})
			default:
				for k, v := range rec.Headers {
					w.Header().Set(k, v)
				}
				w.Header().Set("Idempotent-Replayed", "true")
				w.WriteHeader(*rec.StatusCode)
				_, _ = w.Write(rec.Body)
			}
			return
		}
		cw := &captureWriter{ResponseWriter: w}
		next.ServeHTTP(cw, r)
		ctx := r.Context()
		_ = s.deps.DB.System(ctx, func(tx pgx.Tx) error {
			if cw.status >= 500 || cw.status == 0 || cw.status == http.StatusTooManyRequests {
				return store.ReleaseIdempotencyKey(ctx, tx, t.TenantID, scope, key)
			}
			hdr := map[string]string{}
			for _, h := range replayHeaders {
				if v := cw.Header().Get(h); v != "" {
					hdr[h] = v
				}
			}
			return store.CompleteIdempotencyKey(ctx, tx, t.TenantID, scope, key, cw.status, hdr, cw.buf.Bytes())
		})
	})
}
