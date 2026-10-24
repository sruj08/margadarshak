// Package payment holds the PaymentPort implementations (MD-041, EC-09, D-07). Margdarshak never
// collects government fees: the real path is a redirect to Sarathi's fee page or the state's
// gateway, which collects under the state's own merchant account.
//
//   - Mock: a clearly labelled fake payment page (served by the API under /mock/payment) that
//     returns success, failure or "debited but pending" through an HMAC-signed callback
//     (Margdarshak-Signature scheme, timestamp window, replay cache).
//   - SarathiRedirect: the hackathon default; sends the user to Sarathi and receives no callback.
package payment

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"sync"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

const port = "payment"

// CallbackBody is the signed callback payload (API-24).
type CallbackBody struct {
	PaymentIntentID string    `json:"payment_intent_id"`
	Status          string    `json:"status"`
	ReceiptNumber   string    `json:"receipt_number,omitempty"`
	At              time.Time `json:"at"`
}

// Mock is the fake gateway.
type Mock struct {
	PageBase string // absolute URL of the fake payment page, e.g. http://localhost:8000/mock/payment
	secret   []byte
	verifier *hmacsig.Verifier
	now      func() time.Time

	mu    sync.Mutex
	fault ports.Fault
}

// NewMock returns the fake gateway. replay is shared across instances in production-like runs.
func NewMock(pageBase string, secret []byte, replay hmacsig.ReplayCache, now func() time.Time) *Mock {
	return &Mock{
		PageBase: pageBase,
		secret:   secret,
		verifier: &hmacsig.Verifier{Secret: secret, Window: 5 * time.Minute, Replay: replay, Now: now},
		now:      now,
	}
}

// Mode implements ports.PaymentPort.
func (m *Mock) Mode() string { return "mock" }

// InjectFault implements ports.FaultInjector; FaultPendingPayment makes the page's default
// outcome "debited but pending" (EC-09).
func (m *Mock) InjectFault(f ports.Fault) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fault = f
}

// DefaultOutcome is the outcome the fake page preselects.
func (m *Mock) DefaultOutcome() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fault == ports.FaultPendingPayment {
		return "pending"
	}
	return "success"
}

// StartPayment implements ports.PaymentPort.
func (m *Mock) StartPayment(_ context.Context, req ports.PaymentRequest) (ports.PaymentRedirect, error) {
	if req.AmountPaise <= 0 {
		return ports.PaymentRedirect{}, ports.E(port, "StartPayment", ports.KindInvalid, "amount must be positive integer paise")
	}
	if req.IntentRef == "" {
		return ports.PaymentRedirect{}, ports.E(port, "StartPayment", ports.KindInvalid, "intent reference required")
	}
	q := url.Values{}
	if req.ReturnURL != "" {
		q.Set("return", req.ReturnURL)
	}
	u := m.PageBase + "/" + url.PathEscape(req.IntentRef)
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	return ports.PaymentRedirect{URL: u, CollectedBy: "state_gateway", Simulated: true}, nil
}

// SignCallback builds the signed callback the fake gateway sends.
func (m *Mock) SignCallback(cb ports.PaymentCallback) (signature string, body []byte) {
	return m.SignCallbackAt(cb, m.now())
}

// SignCallbackAt signs as if sent at t (contract tests use it for stale timestamps).
func (m *Mock) SignCallbackAt(cb ports.PaymentCallback, t time.Time) (signature string, body []byte) {
	if cb.At.IsZero() {
		cb.At = t
	}
	body, _ = json.Marshal(CallbackBody{PaymentIntentID: cb.IntentRef, Status: cb.Status, ReceiptNumber: cb.ReceiptNumber, At: cb.At.UTC()})
	return hmacsig.Sign(m.secret, t, body), body
}

// VerifyCallback implements ports.PaymentPort.
func (m *Mock) VerifyCallback(ctx context.Context, signature string, body []byte) (ports.PaymentCallback, error) {
	if err := m.verifier.Verify(ctx, signature, body); err != nil {
		kind := ports.KindInvalid
		if !errors.Is(err, hmacsig.ErrMissing) && !errors.Is(err, hmacsig.ErrMalformed) && !errors.Is(err, hmacsig.ErrStale) &&
			!errors.Is(err, hmacsig.ErrMismatch) && !errors.Is(err, hmacsig.ErrReplay) {
			kind = ports.KindUnavailable
		}
		return ports.PaymentCallback{}, ports.E(port, "VerifyCallback", kind, err.Error())
	}
	var cb CallbackBody
	if err := json.Unmarshal(body, &cb); err != nil {
		return ports.PaymentCallback{}, ports.E(port, "VerifyCallback", ports.KindInvalid, "bad body")
	}
	switch cb.Status {
	case "success", "pending", "failed":
	default:
		return ports.PaymentCallback{}, ports.E(port, "VerifyCallback", ports.KindInvalid, "bad status")
	}
	if cb.PaymentIntentID == "" {
		return ports.PaymentCallback{}, ports.E(port, "VerifyCallback", ports.KindInvalid, "missing intent")
	}
	return ports.PaymentCallback{IntentRef: cb.PaymentIntentID, Status: cb.Status, ReceiptNumber: cb.ReceiptNumber, At: cb.At}, nil
}

// Health implements ports.PaymentPort.
func (m *Mock) Health(context.Context) ports.Health {
	return ports.Health{Implementation: "mock", Status: "ok"}
}

// SarathiRedirect sends the user to Sarathi's own fee page (hackathon default).
type SarathiRedirect struct{}

// Mode implements ports.PaymentPort.
func (SarathiRedirect) Mode() string { return "sarathi_redirect" }

// StartPayment implements ports.PaymentPort.
func (SarathiRedirect) StartPayment(_ context.Context, req ports.PaymentRequest) (ports.PaymentRedirect, error) {
	if req.AmountPaise <= 0 {
		return ports.PaymentRedirect{}, ports.E(port, "StartPayment", ports.KindInvalid, "amount must be positive integer paise")
	}
	return ports.PaymentRedirect{URL: "https://sarathi.parivahan.gov.in/", CollectedBy: "state_gateway"}, nil
}

// VerifyCallback implements ports.PaymentPort: Sarathi sends no callbacks to Margdarshak.
func (SarathiRedirect) VerifyCallback(context.Context, string, []byte) (ports.PaymentCallback, error) {
	return ports.PaymentCallback{}, ports.E(port, "VerifyCallback", ports.KindUnsupported, "sarathi_redirect has no callbacks; the user reports the outcome")
}

// Health implements ports.PaymentPort.
func (SarathiRedirect) Health(context.Context) ports.Health {
	return ports.Health{Implementation: "sarathi_redirect", Status: "ok"}
}
