// Package compute is the HMAC-signed JSON client for the private TypeScript compute service
// (services/score-verifier, decision D1). Go keeps auth, policy, persistence and orchestration;
// the verifier replays game sessions and runs the learning, gamification and clip maths, so the
// browser and the server share one implementation.
//
// Every POST carries `Margdarshak-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`
// (internal/platform/hmacsig). The verifier rejects a signature it has already accepted, so every
// attempt is signed again with a fresh timestamp. One retry is made on a 5xx answer or a
// connection error, inside the caller's time budget.
//
// Errors:
//   - ErrUnavailable: network failure, timeout, 5xx, 401/403 (a secret or clock problem on our side,
//     never the user's fault), a response over the size cap or one that does not decode. Callers
//     degrade (API-35 stores the session as pending_verification).
//   - ErrInvalid: any other 4xx. The concrete error is a *ProblemError carrying the problem type
//     slug ("digest-mismatch", "content-not-found", ...).
//
// Request and response bodies, replay inputs and signatures are never logged.
//
// The interfaces (ports.ScoreVerifier, ports.LearnCompute, ports.ClipCompute, ports.ComputePoster),
// the error values and the wire types live in internal/ports; this package implements them.
package compute

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// Clock is the source of server time (servertime.Clock satisfies it).
type Clock interface{ Now() time.Time }

// Sentinel errors (ports.ErrComputeUnavailable, ports.ErrComputeInvalid). Match with errors.Is.
var (
	ErrUnavailable = ports.ErrComputeUnavailable
	ErrInvalid     = ports.ErrComputeInvalid
)

// ProblemBase is the verifier's problem type prefix (services/score-verifier/src/http-util.ts).
const ProblemBase = "https://margdarshak.example/problems/"

// Default limits.
const (
	DefaultTimeout          = 2 * time.Second
	DefaultMaxRequestBytes  = 1 << 20 // the verifier's own limit is VERIFIER_BODY_LIMIT_BYTES
	DefaultMaxResponseBytes = 4 << 20
	// minRetryBudget is the least time left in the budget for a retry to be worth making.
	minRetryBudget = 50 * time.Millisecond
)

// FieldIssue is one validation issue: path and message, never the submitted value.
type FieldIssue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ProblemError is an RFC 9457 problem answered by the compute service, or produced locally when
// a request breaks a client-side limit (Status 413, Local true).
type ProblemError struct {
	Path    string
	Status  int
	Type    string // slug, e.g. "digest-mismatch"
	Title   string
	Detail  string
	Code    string
	Errors  []FieldIssue
	Local   bool
	Attempt int
}

func (e *ProblemError) Error() string {
	s := fmt.Sprintf("compute %s: %d %s", e.Path, e.Status, e.Type)
	if e.Code != "" {
		s += " (" + e.Code + ")"
	}
	return s
}

// Is maps a problem onto ErrUnavailable (5xx, 401, 403, 429) or ErrInvalid (other 4xx).
func (e *ProblemError) Is(target error) bool {
	switch target {
	case ErrUnavailable:
		return e.unavailable()
	case ErrInvalid:
		return !e.unavailable()
	}
	return false
}

// ProblemType returns the problem type slug (ports.ComputeProblemType reads it).
func (e *ProblemError) ProblemType() string { return e.Type }

// Unavailable reports whether the problem means the service could not answer (5xx, 401, 403,
// 429); the domain packages' IsUnavailable helpers read it.
func (e *ProblemError) Unavailable() bool { return e.unavailable() }

func (e *ProblemError) unavailable() bool {
	return e.Status >= 500 || e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden ||
		e.Status == http.StatusTooManyRequests
}

// ProblemType returns the problem slug of err, or "" when err is not a *ProblemError.
func ProblemType(err error) string {
	var p *ProblemError
	if errors.As(err, &p) {
		return p.Type
	}
	return ""
}

// Client calls the compute service. The zero value is not usable; build it with New.
type Client struct {
	baseURL string
	secret  []byte
	timeout time.Duration
	clock   Clock

	// HTTP is the transport client; its own Timeout is ignored in favour of the per-call budget.
	HTTP *http.Client
	// Log receives one line per attempt (path, status, attempt, duration, problem type). Optional.
	Log *slog.Logger
	// MaxRequestBytes and MaxResponseBytes cap bodies in each direction.
	MaxRequestBytes  int
	MaxResponseBytes int64

	strict bool // tests: reject unknown response fields
}

// New returns a client for baseURL (e.g. "http://score-verifier:8081"). timeout is the total
// budget of one call, retry included (≤ 0 means DefaultTimeout).
func New(baseURL, secret string, timeout time.Duration, clock Clock) *Client {
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	return &Client{
		baseURL:          strings.TrimRight(baseURL, "/"),
		secret:           []byte(secret),
		timeout:          timeout,
		clock:            clock,
		HTTP:             &http.Client{},
		MaxRequestBytes:  DefaultMaxRequestBytes,
		MaxResponseBytes: DefaultMaxResponseBytes,
	}
}

// nowMs is the server time in epoch milliseconds (the `now` field every compute route takes).
func (c *Client) nowMs() int64 { return c.clock.Now().UnixMilli() }

// post signs and sends in to path and decodes a 200 answer into out.
func (c *Client) post(ctx context.Context, path string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("compute %s: encode request: %w", path, err)
	}
	if c.MaxRequestBytes > 0 && len(body) > c.MaxRequestBytes {
		return &ProblemError{Path: path, Status: http.StatusRequestEntityTooLarge, Type: "payload-too-large",
			Title: "Request exceeds the client cap", Local: true}
	}
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	var last time.Time
	for attempt := 1; ; attempt++ {
		// A fresh timestamp per attempt; never the same second twice, so a retry of the same body
		// never repeats a signature the verifier's replay cache already holds.
		ts := c.clock.Now()
		if !last.IsZero() && ts.Unix() <= last.Unix() {
			ts = last.Add(time.Second)
		}
		last = ts
		started := time.Now()
		status, raw, err := c.send(ctx, path, body, hmacsig.Sign(c.secret, ts, body))
		dur := time.Since(started)

		retryable := (err != nil && !errors.Is(err, errTooLarge)) || status >= 500
		if retryable && attempt == 1 && ctx.Err() == nil && remaining(ctx) > minRetryBudget {
			c.log(ctx, slog.LevelWarn, path, status, attempt, dur, "", "retrying")
			continue
		}
		if err != nil {
			c.log(ctx, slog.LevelWarn, path, status, attempt, dur, "", "transport error")
			if ctx.Err() != nil {
				return fmt.Errorf("%w: %s: %w", ErrUnavailable, path, ctx.Err())
			}
			return fmt.Errorf("%w: %s: %w", ErrUnavailable, path, err)
		}
		if status == http.StatusOK {
			c.log(ctx, slog.LevelDebug, path, status, attempt, dur, "", "ok")
			if out == nil {
				return nil
			}
			if err := c.decode(raw, out); err != nil {
				return fmt.Errorf("%w: %s: undecodable response: %w", ErrUnavailable, path, err)
			}
			return nil
		}
		p := parseProblem(path, status, raw)
		p.Attempt = attempt
		c.log(ctx, slog.LevelWarn, path, status, attempt, dur, p.Type, "problem")
		return p
	}
}

var errTooLarge = errors.New("response exceeds the size cap")

// send makes one attempt and returns the status and the (capped) body.
func (c *Client) send(ctx context.Context, path string, body []byte, sig string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, application/problem+json")
	req.Header.Set(hmacsig.Header, sig)
	return c.do(req)
}

func (c *Client) do(req *http.Request) (int, []byte, error) {
	hc := c.HTTP
	if hc == nil {
		hc = http.DefaultClient
	}
	resp, err := hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	limit := c.MaxResponseBytes
	if limit <= 0 {
		limit = DefaultMaxResponseBytes
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return resp.StatusCode, nil, err
	}
	if int64(len(raw)) > limit {
		return resp.StatusCode, nil, errTooLarge
	}
	return resp.StatusCode, raw, nil
}

func (c *Client) decode(raw []byte, out any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if c.strict {
		dec.DisallowUnknownFields()
	}
	return dec.Decode(out)
}

func parseProblem(path string, status int, raw []byte) *ProblemError {
	var body struct {
		Type   string       `json:"type"`
		Title  string       `json:"title"`
		Detail string       `json:"detail"`
		Code   string       `json:"code"`
		Errors []FieldIssue `json:"errors"`
	}
	p := &ProblemError{Path: path, Status: status}
	if json.Unmarshal(raw, &body) == nil && body.Type != "" {
		p.Type = strings.TrimPrefix(body.Type, ProblemBase)
		p.Title, p.Detail, p.Code, p.Errors = body.Title, body.Detail, body.Code, body.Errors
	} else {
		// Not problem+json (a proxy page, an empty 502): classify by status only.
		p.Type = "http-" + fmt.Sprint(status)
		p.Title = http.StatusText(status)
	}
	return p
}

func remaining(ctx context.Context) time.Duration {
	dl, ok := ctx.Deadline()
	if !ok {
		return time.Hour
	}
	return time.Until(dl)
}

func (c *Client) log(ctx context.Context, lvl slog.Level, path string, status, attempt int, dur time.Duration, problem, msg string) {
	if c.Log == nil {
		return
	}
	attrs := []slog.Attr{
		slog.String("path", path), slog.Int("status", status), slog.Int("attempt", attempt),
		slog.Int64("dur_ms", dur.Milliseconds()),
	}
	if problem != "" {
		attrs = append(attrs, slog.String("problem", problem))
	}
	c.Log.LogAttrs(ctx, lvl, "compute: "+msg, attrs...)
}

// Versions is GET /versions (unauthenticated, private network).
type Versions struct {
	GameCore        string              `json:"gameCore"`
	ScoringVersions map[string][]string `json:"scoringVersions"`
	Games           []string            `json:"games"`
	Routes          []string            `json:"routes"`
}

// Versions reads the scoring versions the verifier has loaded (readiness checks, drift alerts).
func (c *Client) Versions(ctx context.Context) (*Versions, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/versions", nil)
	if err != nil {
		return nil, err
	}
	status, raw, err := c.do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: /versions: %w", ErrUnavailable, err)
	}
	if status != http.StatusOK {
		return nil, parseProblem("/versions", status, raw)
	}
	var v Versions
	if err := c.decode(raw, &v); err != nil {
		return nil, fmt.Errorf("%w: /versions: %w", ErrUnavailable, err)
	}
	return &v, nil
}

// PostJSON signs and POSTs in to path and decodes the 200 answer into out (ports.ComputePoster).
// The learn, gamify and clips packages use it with their own request types; errors satisfy
// ports.IsComputeUnavailable when the service could not answer.
func (c *Client) PostJSON(ctx context.Context, path string, in, out any) error {
	return c.post(ctx, path, in, out)
}

// ScoreVerifier, LearnCompute and ClipCompute are the ports this client implements.
type (
	ScoreVerifier = ports.ScoreVerifier
	LearnCompute  = ports.LearnCompute
	ClipCompute   = ports.ClipCompute
)

var (
	_ ports.ScoreVerifier = (*Client)(nil)
	_ ports.LearnCompute  = (*Client)(nil)
	_ ports.ClipCompute   = (*Client)(nil)
	_ ports.ComputePoster = (*Client)(nil)
)
