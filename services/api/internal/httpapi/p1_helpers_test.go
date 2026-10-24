package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	adnotify "github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
	"github.com/sruj08/margadarshak/services/api/internal/app"
	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/testdb"
)

var keySeq atomic.Int64

// idem returns a fresh Idempotency-Key header (16..64 chars).
func idem() map[string]string {
	return map[string]string{"Idempotency-Key": fmt.Sprintf("test-key-%016d", keySeq.Add(1))}
}

// newEnvWith builds an env with a config mutation (adapters, n8n URL).
func newEnvWith(t *testing.T, mutate func(cfg *config.Config)) *env {
	t.Helper()
	db := testdb.Open(t)
	srv := httptest.NewUnstartedServer(http.NotFoundHandler())
	srv.Start()
	t.Cleanup(srv.Close)
	cfg := config.ForTest()
	cfg.PublicBaseURL = srv.URL
	if mutate != nil {
		mutate(cfg)
	}
	logs := &syncBuffer{}
	e := &env{t: t, srv: srv, clock: servertime.NewFixed(testNow), email: &captureEmail{}, logs: logs, cfg: cfg}
	a, err := app.New(cfg, db, logging.New(logs, "debug"), app.Options{Clock: e.clock, Email: e.email})
	require.NoError(t, err)
	srv.Config.Handler = a.Handler
	e.app = a
	return e
}

// fakeN8n is the W02 webhook: it verifies the signed envelope and records the messages.
type fakeN8n struct {
	mu       sync.Mutex
	secret   []byte
	now      func() time.Time
	payloads []adnotify.EnvelopePayload
	tokens   []string
	fail     atomic.Bool
}

func (f *fakeN8n) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if f.fail.Load() {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	var env adnotify.Envelope
	b, _ := io.ReadAll(r.Body)
	if json.Unmarshal(b, &env) != nil || adnotify.VerifyEnvelope(f.secret, env, f.now()) != nil || r.URL.Path != "/webhook/md/milestone" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var p adnotify.EnvelopePayload
	_ = json.Unmarshal([]byte(env.Payload), &p)
	f.mu.Lock()
	f.payloads = append(f.payloads, p)
	f.tokens = append(f.tokens, r.Header.Get("X-MD-Webhook-Token"))
	f.mu.Unlock()
	w.WriteHeader(http.StatusAccepted)
}

func (f *fakeN8n) messages() []adnotify.OutboundMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []adnotify.OutboundMessage
	for _, p := range f.payloads {
		out = append(out, p.Messages...)
	}
	return out
}

// newEnvN8n is an env whose W02 webhook is a verifying fake.
func newEnvN8n(t *testing.T) (*env, *fakeN8n) {
	f := &fakeN8n{secret: []byte("test-n8n-envelope-secret")}
	ts := httptest.NewServer(f)
	t.Cleanup(ts.Close)
	e := newEnvWith(t, func(cfg *config.Config) { cfg.N8NBaseURL, cfg.N8NWebhookToken = ts.URL, "test-webhook-token" })
	f.now = e.clock.Now
	return e, f
}

// internalGet sends a signed GET (HMAC over the empty body).
func (e *env) internalGet(path string) resp {
	e.t.Helper()
	req, _ := http.NewRequest("GET", e.srv.URL+path, nil)
	req.Header.Set("Authorization", "Bearer "+e.cfg.InternalBearerTokens[0])
	req.Header.Set(hmacsig.Header, hmacsig.Sign([]byte(e.cfg.InternalHMACSecret), e.clock.Now(), nil))
	res, err := http.DefaultClient.Do(req)
	require.NoError(e.t, err)
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{Status: res.StatusCode, Header: res.Header, Body: b}
}

// step calls a job step as the Workflows service does (bearer + HMAC, fresh signature).
func (e *env) step(name string, args map[string]any) resp {
	e.t.Helper()
	e.clock.Advance(time.Second) // a new signature per call (replay cache)
	return e.internal("/internal/job-steps/"+name, map[string]any{"run_id": "trn-test", "args": args}, nil)
}

// plan creates a plan and returns its body.
func (c *client) plan(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	r := c.do("POST", "/v1/plans", body, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/plans", r)
	return r.json(t)
}

// newCase creates a case and returns its body.
func (c *client) newCase(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	r := c.do("POST", "/v1/cases", body, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/cases", r)
	return r.json(t)
}

func (c *client) event(t *testing.T, caseID string, body map[string]any) resp {
	t.Helper()
	r := c.do("POST", "/v1/cases/"+caseID+"/events", body, idem())
	if r.Status < 300 {
		assertContract(t, "POST", "/v1/cases/{caseId}/events", r)
	}
	return r
}

func (c *client) getCase(t *testing.T, caseID string) map[string]any {
	t.Helper()
	r := c.do("GET", "/v1/cases/"+caseID, nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/cases/{caseId}", r)
	return r.json(t)
}

func (c *client) grant(t *testing.T, purpose string) {
	t.Helper()
	r := c.do("POST", "/v1/me/consents", map[string]any{"purpose": purpose, "action": "grant", "notice_version": "notice-2026.10.23-en"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
}

func (c *client) revoke(t *testing.T, purpose string) {
	t.Helper()
	r := c.do("POST", "/v1/me/consents", map[string]any{"purpose": purpose, "action": "revoke", "notice_version": "notice-2026.10.23-en"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
}

func (e *env) count(q string, args ...any) int {
	e.t.Helper()
	var n int
	require.NoError(e.t, e.app.DB.Pool.QueryRow(context.Background(), q, args...).Scan(&n))
	return n
}

func ist(y int, m time.Month, d, h, min int) time.Time {
	return time.Date(y, m, d, h, min, 0, 0, servertime.IST).UTC()
}

func blockerIDs(list any) map[string]bool {
	out := map[string]bool{}
	for _, b := range list.([]any) {
		out[b.(map[string]any)["blocker_id"].(string)] = true
	}
	return out
}

var _ = bytes.NewReader
