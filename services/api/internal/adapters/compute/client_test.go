package compute

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

const testSecret = "test-secret"

var t0 = time.Date(2026, 10, 24, 4, 30, 0, 0, time.UTC)

// seen records what the fake verifier received.
type seen struct {
	mu      sync.Mutex
	headers []string
	bodies  [][]byte
}

func (s *seen) add(r *http.Request) []byte {
	b, _ := io.ReadAll(r.Body)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.headers = append(s.headers, r.Header.Get(hmacsig.Header))
	s.bodies = append(s.bodies, b)
	return b
}

func (s *seen) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.headers)
}

func newClient(t *testing.T, h http.Handler) (*Client, *servertime.Fixed) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	clk := servertime.NewFixed(t0)
	c := New(srv.URL, testSecret, 2*time.Second, clk)
	return c, clk
}

func problem(w http.ResponseWriter, status int, slug, code string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type": ProblemBase + slug, "title": "t", "status": status, "code": code,
	})
}

func okFinalWindow(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"op":"final_window","window":{"aMs":12267,"bMs":16767}}`)
}

func call(c *Client) (*ClipAgreementResponse, error) {
	return c.ClipAgreement(context.Background(), FinalWindowOp(WindowMark{AMs: 12000, BMs: 16500}, WindowMark{AMs: 12500, BMs: 17000}))
}

// The header is exactly hmacsig's scheme over the raw body at the clock's second.
func TestSignatureFormat(t *testing.T) {
	var s seen
	c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("method %s content-type %q", r.Method, r.Header.Get("Content-Type"))
		}
		s.add(r)
		okFinalWindow(w)
	}))
	out, err := call(c)
	if err != nil {
		t.Fatal(err)
	}
	if out.Window == nil || out.Window.AMs != 12267 {
		t.Fatalf("window %+v", out.Window)
	}
	want := hmacsig.Sign([]byte(testSecret), t0, s.bodies[0])
	if s.headers[0] != want {
		t.Fatalf("header %q, want %q", s.headers[0], want)
	}
	if !strings.HasPrefix(s.headers[0], "t="+strconv.FormatInt(t0.Unix(), 10)+",v1=") {
		t.Fatalf("header %q", s.headers[0])
	}
	v := hmacsig.Verifier{Secret: []byte(testSecret), Now: func() time.Time { return t0 }}
	if err := v.Verify(context.Background(), s.headers[0], s.bodies[0]); err != nil {
		t.Fatal(err)
	}
	// `now` is filled from the injected clock (epoch ms).
	var body map[string]any
	_ = json.Unmarshal(s.bodies[0], &body)
	if body["now"] != float64(t0.UnixMilli()) {
		t.Fatalf("now = %v", body["now"])
	}
}

// A 5xx is retried once with a new signature: the verifier's replay cache would reject the old one.
func TestRetryResigns(t *testing.T) {
	var s seen
	c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.add(r)
		if s.count() == 1 {
			problem(w, 500, "internal", "")
			return
		}
		okFinalWindow(w)
	}))
	if _, err := call(c); err != nil {
		t.Fatal(err)
	}
	if s.count() != 2 {
		t.Fatalf("attempts = %d", s.count())
	}
	if s.headers[0] == s.headers[1] {
		t.Fatal("retry reused the signature")
	}
	if !bytes.Equal(s.bodies[0], s.bodies[1]) {
		t.Fatal("retry changed the body")
	}
	// The clock is frozen, so the retry moves to the next second; both verify within the window.
	if want := hmacsig.Sign([]byte(testSecret), t0.Add(time.Second), s.bodies[1]); s.headers[1] != want {
		t.Fatalf("retry header %q, want %q", s.headers[1], want)
	}
	cache := map[string]bool{}
	v := hmacsig.Verifier{Secret: []byte(testSecret), Now: func() time.Time { return t0 }, Replay: replayFunc(func(k string) bool {
		was := cache[k]
		cache[k] = true
		return was
	})}
	for i := range s.headers {
		if err := v.Verify(context.Background(), s.headers[i], s.bodies[i]); err != nil {
			t.Fatalf("attempt %d: %v", i+1, err)
		}
	}
}

type replayFunc func(string) bool

func (f replayFunc) Seen(_ context.Context, k string, _ time.Duration) (bool, error) {
	return f(k), nil
}

// A connection reset is retried once too.
func TestRetryOnConnectionError(t *testing.T) {
	var n atomic.Int32
	c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if n.Add(1) == 1 {
			hj, _ := w.(http.Hijacker)
			conn, _, _ := hj.Hijack()
			_ = conn.Close()
			return
		}
		okFinalWindow(w)
	}))
	if _, err := call(c); err != nil {
		t.Fatal(err)
	}
	if n.Load() != 2 {
		t.Fatalf("attempts = %d", n.Load())
	}
}

// Two 5xx answers: ErrUnavailable, never more than two attempts.
func TestPersistent5xxIsUnavailable(t *testing.T) {
	var n atomic.Int32
	c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		w.WriteHeader(http.StatusBadGateway) // not problem+json (a proxy page)
		_, _ = io.WriteString(w, "<html>bad gateway</html>")
	}))
	_, err := call(c)
	if !errors.Is(err, ErrUnavailable) || errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v", err)
	}
	if ProblemType(err) != "http-502" {
		t.Fatalf("type %q", ProblemType(err))
	}
	if n.Load() != 2 {
		t.Fatalf("attempts = %d", n.Load())
	}
}

// The whole call, retry included, stays inside the budget.
func TestTimeout(t *testing.T) {
	var n atomic.Int32
	release := make(chan struct{})
	c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		_, _ = io.ReadAll(r.Body) // lets the server notice the client hanging up
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	t.Cleanup(func() { close(release) }) // runs before the server's Close
	c.timeout = 150 * time.Millisecond
	start := time.Now()
	_, err := call(c)
	if !errors.Is(err, ErrUnavailable) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v", err)
	}
	if d := time.Since(start); d > time.Second {
		t.Fatalf("took %v", d)
	}
	if n.Load() != 1 {
		t.Fatalf("attempts = %d (no retry once the budget is spent)", n.Load())
	}
}

func TestProblemMapping(t *testing.T) {
	cases := []struct {
		status            int
		slug, code        string
		invalid, unavail  bool
		wantAttempts      int32
		wantType, wantErr string
	}{
		{422, "digest-mismatch", "DIGEST_MISMATCH", true, false, 1, "digest-mismatch", ""},
		{422, "content-not-found", "CONTENT_NOT_FOUND", true, false, 1, "content-not-found", ""},
		{400, "validation-failed", "", true, false, 1, "validation-failed", ""},
		{413, "payload-too-large", "", true, false, 1, "payload-too-large", ""},
		{401, "unauthorized", "signature_replayed", false, true, 1, "unauthorized", ""},
		{503, "internal", "", false, true, 2, "internal", ""},
	}
	for _, tc := range cases {
		t.Run(strconv.Itoa(tc.status)+"-"+tc.slug, func(t *testing.T) {
			var n atomic.Int32
			c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n.Add(1)
				problem(w, tc.status, tc.slug, tc.code)
			}))
			_, err := call(c)
			if errors.Is(err, ErrInvalid) != tc.invalid || errors.Is(err, ErrUnavailable) != tc.unavail {
				t.Fatalf("err = %v (invalid=%v unavailable=%v)", err, errors.Is(err, ErrInvalid), errors.Is(err, ErrUnavailable))
			}
			var p *ProblemError
			if !errors.As(err, &p) || p.Type != tc.wantType || p.Code != tc.code || p.Status != tc.status {
				t.Fatalf("problem %+v", p)
			}
			if n.Load() != tc.wantAttempts {
				t.Fatalf("attempts = %d", n.Load())
			}
		})
	}
}

func TestBodyCaps(t *testing.T) {
	t.Run("response", func(t *testing.T) {
		var n atomic.Int32
		c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			n.Add(1)
			_, _ = io.WriteString(w, `{"op":"final_window","pad":"`+strings.Repeat("x", 4096)+`"}`)
		}))
		c.MaxResponseBytes = 1024
		_, err := call(c)
		if !errors.Is(err, ErrUnavailable) {
			t.Fatalf("err = %v", err)
		}
		if n.Load() != 1 {
			t.Fatalf("attempts = %d (an oversized answer is not retried)", n.Load())
		}
	})
	t.Run("request", func(t *testing.T) {
		var n atomic.Int32
		c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { n.Add(1) }))
		c.MaxRequestBytes = 512
		_, err := c.Verify(context.Background(), VerifyRequest{Inputs: strings.Repeat("A", 1024)})
		var p *ProblemError
		if !errors.Is(err, ErrInvalid) || !errors.As(err, &p) || !p.Local || p.Status != 413 {
			t.Fatalf("err = %v", err)
		}
		if n.Load() != 0 {
			t.Fatal("an oversized request was sent")
		}
	})
}

// Bodies, replay inputs and signatures never reach the logs.
func TestLogsCarryNoBodies(t *testing.T) {
	var buf bytes.Buffer
	var n atomic.Int32
	c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.ReadAll(r.Body)
		if n.Add(1) == 1 {
			problem(w, 500, "internal", "")
			return
		}
		problem(w, 422, "bad-replay", "BAD_REPLAY")
	}))
	c.Log = slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	_, err := c.Verify(context.Background(), VerifyRequest{
		SID: "00000000-0000-4000-8000-000000000001", GameID: "nazar", Inputs: "U0VDUkVUSU5QVVRT",
		ClientResult: json.RawMessage(`{"score":{"pct":71},"findings":[],"marker":"CLIENT-MARKER"}`),
	})
	if ProblemType(err) != "bad-replay" {
		t.Fatalf("err = %v", err)
	}
	logs := buf.String()
	for _, secret := range []string{"U0VDUkVUSU5QVVRT", "CLIENT-MARKER", "v1=", testSecret, "00000000-0000-4000-8000-000000000001"} {
		if strings.Contains(logs, secret) {
			t.Fatalf("log leaked %q:\n%s", secret, logs)
		}
	}
	if !strings.Contains(logs, `"path":"/verify"`) || !strings.Contains(logs, `"problem":"bad-replay"`) {
		t.Fatalf("log lacks path/problem:\n%s", logs)
	}
}

// A 200 whose result is not a SessionResult is the verifier's fault: unavailable, not invalid.
func TestVerifyUndecodableResult(t *testing.T) {
	c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"result":{"foo":1},"digest":"sha256:x","eventsDigest":"sha256:y","comparison":null,"serverChecked":true}`)
	}))
	_, err := c.Verify(context.Background(), VerifyRequest{})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v", err)
	}
}

func TestUnknownOpRejectedLocally(t *testing.T) {
	c, _ := newClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("sent") }))
	if _, err := c.ClipAgreement(context.Background(), ClipAgreementRequest{Op: "nope"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v", err)
	}
}
