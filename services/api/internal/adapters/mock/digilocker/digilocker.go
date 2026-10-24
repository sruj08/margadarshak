// Package digilocker is the simulated DigiLocker requester flow (MD-038). It mimics the shape
// of the DigiLocker Requester API spec v1.12: OAuth 2.0 authorization code with PKCE S256
// required, a token response with consent validity, an issued-files list and a DRVLC pull.
// The consent screen (served by the API under /mock/digilocker) is labelled "Simulated
// DigiLocker consent" and shows the real consent pattern: purpose, documents, validity.
//
// Fixture DL URIs follow the documented pattern (in.gov.transport-DRVLC-<DL no.>) with fake numbers.
package digilocker

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net/url"
	"sync"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

const port = "digilocker"

// FixtureDLNumber is a fake DL number in the documented format (state code, RTO, year, serial).
const FixtureDLNumber = "JK0220190000001"

// ConsentScreen is what the simulated consent page shows.
type ConsentScreen struct {
	RequestID   string
	Purpose     string
	Doctypes    []string
	ValidFor    time.Duration
	RedirectURI string
	State       string
}

type authRequest struct {
	ConsentScreen
	challenge string
	created   time.Time
}

type grant struct {
	challenge   string
	redirectURI string
	expires     time.Time
	used        bool
}

type token struct {
	expires time.Time
}

// Mock is the simulated authorisation server and resource API.
type Mock struct {
	ClientID    string
	ConsentBase string // absolute URL of the simulated consent page

	mu       sync.Mutex
	requests map[string]*authRequest
	grants   map[string]*grant
	tokens   map[string]*token
	fault    ports.Fault
	now      func() time.Time
}

// NewMock returns a simulator whose consent page lives at consentBase.
func NewMock(consentBase string, now func() time.Time) *Mock {
	return &Mock{
		ClientID:    "margdarshak-sim",
		ConsentBase: consentBase,
		requests:    map[string]*authRequest{},
		grants:      map[string]*grant{},
		tokens:      map[string]*token{},
		now:         now,
	}
}

// Mode implements ports.DigiLockerPort.
func (m *Mock) Mode() string { return "mock" }

// InjectFault implements ports.FaultInjector.
func (m *Mock) InjectFault(f ports.Fault) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fault = f
}

func (m *Mock) faultErr(ctx context.Context, op string) error {
	m.mu.Lock()
	f := m.fault
	m.mu.Unlock()
	switch f {
	case ports.FaultOutage:
		return ports.E(port, op, ports.KindUnavailable, "simulated DigiLocker outage")
	case ports.FaultTimeout:
		<-ctx.Done()
		return ports.E(port, op, ports.KindTimeout, "simulated timeout")
	}
	return nil
}

// StartConsent implements ports.DigiLockerPort.
func (m *Mock) StartConsent(ctx context.Context, req ports.ConsentRequest) (ports.AuthRedirect, error) {
	if err := m.faultErr(ctx, "StartConsent"); err != nil {
		return ports.AuthRedirect{}, err
	}
	if req.Method != "S256" || len(req.CodeChallenge) < 43 {
		return ports.AuthRedirect{}, ports.E(port, "StartConsent", ports.KindInvalid, "PKCE S256 code_challenge required")
	}
	if req.State == "" || req.RedirectURI == "" {
		return ports.AuthRedirect{}, ports.E(port, "StartConsent", ports.KindInvalid, "state and redirect_uri required")
	}
	doctypes := req.Doctypes
	if len(doctypes) == 0 {
		doctypes = []string{"DRVLC"}
	}
	for _, d := range doctypes {
		if d != "DRVLC" {
			return ports.AuthRedirect{}, ports.E(port, "StartConsent", ports.KindInvalid, "only DRVLC is requested")
		}
	}
	id := randomToken(12)
	m.mu.Lock()
	m.requests[id] = &authRequest{
		ConsentScreen: ConsentScreen{RequestID: id, Purpose: req.Purpose, Doctypes: doctypes, ValidFor: 30 * 24 * time.Hour,
			RedirectURI: req.RedirectURI, State: req.State},
		challenge: req.CodeChallenge,
		created:   m.now(),
	}
	m.mu.Unlock()
	q := url.Values{
		"request":               {id},
		"response_type":         {"code"},
		"client_id":             {m.ClientID},
		"redirect_uri":          {req.RedirectURI},
		"state":                 {req.State},
		"code_challenge":        {req.CodeChallenge},
		"code_challenge_method": {"S256"},
		"req_doctype":           {"DRVLC"},
	}
	return ports.AuthRedirect{URL: m.ConsentBase + "?" + q.Encode(), Simulated: true}, nil
}

// Screen returns the pending consent request for the simulated consent page.
func (m *Mock) Screen(requestID string) (ConsentScreen, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.requests[requestID]
	if !ok || m.now().Sub(r.created) > 10*time.Minute {
		return ConsentScreen{}, false
	}
	return r.ConsentScreen, true
}

// Decide records the user's answer on the simulated consent page and returns the redirect back
// to the requester (with code+state on approval, error=access_denied otherwise).
func (m *Mock) Decide(requestID string, approve bool) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.requests[requestID]
	if !ok {
		return "", ports.E(port, "Decide", ports.KindNotFound, "consent request expired")
	}
	delete(m.requests, requestID)
	q := url.Values{"state": {r.State}}
	if !approve {
		q.Set("error", "access_denied")
		return r.RedirectURI + "?" + q.Encode(), nil
	}
	code := randomToken(16)
	m.grants[code] = &grant{challenge: r.challenge, redirectURI: r.RedirectURI, expires: m.now().Add(10 * time.Minute)}
	q.Set("code", code)
	return r.RedirectURI + "?" + q.Encode(), nil
}

// ExchangeCode implements ports.DigiLockerPort. The PKCE verifier must hash to the challenge.
func (m *Mock) ExchangeCode(ctx context.Context, code, verifier, redirectURI string) (ports.TokenSet, error) {
	if err := m.faultErr(ctx, "ExchangeCode"); err != nil {
		return ports.TokenSet{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.grants[code]
	if !ok || g.used || m.now().After(g.expires) {
		return ports.TokenSet{}, ports.E(port, "ExchangeCode", ports.KindInvalid, "invalid_grant")
	}
	g.used = true // a code is single use even when the verifier is wrong
	if g.redirectURI != redirectURI {
		return ports.TokenSet{}, ports.E(port, "ExchangeCode", ports.KindInvalid, "redirect_uri mismatch")
	}
	if subtle.ConstantTimeCompare([]byte(S256(verifier)), []byte(g.challenge)) != 1 {
		return ports.TokenSet{}, ports.E(port, "ExchangeCode", ports.KindInvalid, "PKCE verifier mismatch")
	}
	tok := randomToken(24)
	m.tokens[tok] = &token{expires: m.now().Add(time.Hour)}
	return ports.TokenSet{AccessToken: tok, ExpiresIn: time.Hour, ConsentValidTill: m.now().Add(30 * 24 * time.Hour), Scope: "partners.DRVLC"}, nil
}

func (m *Mock) checkToken(op, tok string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.tokens[tok]
	if !ok || m.now().After(t.expires) {
		return ports.E(port, op, ports.KindInvalid, "invalid or expired token")
	}
	return nil
}

// ListIssued implements ports.DigiLockerPort.
func (m *Mock) ListIssued(_ context.Context, tok string) ([]ports.DocumentRef, error) {
	if err := m.checkToken("ListIssued", tok); err != nil {
		return nil, err
	}
	return []ports.DocumentRef{{Doctype: "DRVLC", URI: "in.gov.transport-DRVLC-" + FixtureDLNumber, Issuer: "Transport Department (simulated)"}}, nil
}

// PullLicence implements ports.DigiLockerPort: the "XML" is reduced to minimal facts here, and
// the full DL number is discarded after computing last4 and a hash.
func (m *Mock) PullLicence(_ context.Context, tok string) (ports.LicenceFacts, error) {
	if err := m.checkToken("PullLicence", tok); err != nil {
		return ports.LicenceFacts{}, err
	}
	issued := time.Date(2019, time.March, 4, 0, 0, 0, 0, time.UTC)
	sum := sha256.Sum256([]byte("mock-dl-pepper:" + FixtureDLNumber))
	return ports.LicenceFacts{
		Classes:             []string{"MCWG", "LMV-NT"},
		IssuedOn:            issued,
		ValidToNonTransport: issued.AddDate(20, 0, -1),
		NumberLast4:         FixtureDLNumber[len(FixtureDLNumber)-4:],
		NumberHash:          sum[:],
		Source:              "digilocker",
		Simulated:           true,
	}, nil
}

// Revoke implements ports.DigiLockerPort.
func (m *Mock) Revoke(_ context.Context, tok string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.tokens, tok)
	return nil
}

// Health implements ports.DigiLockerPort.
func (m *Mock) Health(context.Context) ports.Health {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fault == ports.FaultOutage {
		return ports.Health{Implementation: "mock", Status: "down", Detail: "simulated outage"}
	}
	return ports.Health{Implementation: "mock", Status: "ok"}
}

// S256 returns the PKCE S256 challenge for a verifier.
func S256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// NewVerifier returns a random 43+ character PKCE verifier.
func NewVerifier() string { return randomToken(32) }

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
