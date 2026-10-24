package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// OutboundMessage is one message n8n delivers (api/openapi.yaml OutboundMessage; read by the W02
// "Split + drop duplicate keys" and channel nodes). Content comes from approved templates: the
// backend sends the template ID and variables only, never free text, and `to` only for a user who
// opted in to that channel (E-14, E-15).
type OutboundMessage struct {
	NotificationID string            `json:"notification_id"`
	IdempotencyKey string            `json:"idempotency_key"`
	Channel        string            `json:"channel"`
	TemplateID     string            `json:"template_id"`
	Lang           string            `json:"lang"`
	To             string            `json:"to"`
	Vars           map[string]string `json:"vars"`
	Subject        string            `json:"subject,omitempty"`
	TextBody       string            `json:"text_body,omitempty"`
}

// Envelope is the W02 webhook body: {ts, payload, sig}. payload is the JSON string of
// {event, event_id, tenant, messages}; sig = "sha256=" + hex(HMAC-SHA256(secret, ts + "." + payload)),
// verified by the W02 Crypto/Code node before any work (n8n/README.md security pattern).
type Envelope struct {
	TS      string `json:"ts"`
	Payload string `json:"payload"`
	Sig     string `json:"sig"`
}

// EnvelopePayload is what the payload string carries.
type EnvelopePayload struct {
	Event    string            `json:"event"`
	EventID  string            `json:"event_id"`
	Tenant   string            `json:"tenant"`
	Messages []OutboundMessage `json:"messages"`
}

// SignEnvelope builds the signed envelope for payload at time t.
func SignEnvelope(secret []byte, t time.Time, payload []byte) Envelope {
	ts := strconv.FormatInt(t.Unix(), 10)
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(ts))
	m.Write([]byte("."))
	m.Write(payload)
	return Envelope{TS: ts, Payload: string(payload), Sig: "sha256=" + hex.EncodeToString(m.Sum(nil))}
}

// VerifyEnvelope checks an envelope the way the W02 node does (tests, tooling).
func VerifyEnvelope(secret []byte, e Envelope, now time.Time) error {
	ts, err := strconv.ParseInt(e.TS, 10, 64)
	if err != nil {
		return errors.New("bad ts")
	}
	if d := now.Unix() - ts; d > 300 || d < -300 {
		return errors.New("stale")
	}
	want := SignEnvelope(secret, time.Unix(ts, 0), []byte(e.Payload)).Sig
	if !hmac.Equal([]byte(want), []byte(e.Sig)) {
		return errors.New("bad signature")
	}
	return nil
}

// N8n posts milestone envelopes to the W02 webhook (MD-128, MD-129). With no base URL configured
// (dev, CI) the envelope is logged and treated as sent, so local runs need no n8n.
type N8n struct {
	BaseURL string // N8N_BASE_URL, e.g. https://<workspace>.app.n8n.cloud
	Path    string // webhook path, default /webhook/md/milestone
	Token   string // N8N_WEBHOOK_TOKEN (n8n Header Auth credential, header X-MD-Webhook-Token)
	Secret  []byte // N8N_HMAC_SECRET (n8n Variable MD_HMAC_SECRET)
	HTTP    *http.Client
	Now     func() time.Time
	Log     *slog.Logger
}

// Configured reports whether a real n8n endpoint is set.
func (n *N8n) Configured() bool { return n != nil && n.BaseURL != "" }

// Provider is the provider name recorded in E-13.
func (n *N8n) Provider() string {
	if n.Configured() {
		return "n8n"
	}
	return "console"
}

// Send posts one envelope. Errors are ports errors: unavailable (network, 5xx), timeout,
// invalid (4xx: the webhook rejected the envelope).
func (n *N8n) Send(ctx context.Context, p EnvelopePayload) error {
	if p.Messages == nil {
		p.Messages = []OutboundMessage{}
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	now := time.Now
	if n.Now != nil {
		now = n.Now
	}
	env := SignEnvelope(n.Secret, now(), raw)
	if !n.Configured() {
		if n != nil && n.Log != nil {
			// The redacting logger masks phone numbers and e-mail addresses in `to`.
			n.Log.InfoContext(ctx, "n8n envelope (dev only, N8N_BASE_URL unset)", "event", p.Event, "event_id", p.EventID, "messages", len(p.Messages),
				"payload", env.Payload)
		}
		return nil
	}
	path := n.Path
	if path == "" {
		path = "/webhook/md/milestone"
	}
	return n.post(ctx, path, env)
}

// PostEnvelope posts a prebuilt signed envelope to another webhook path (W08 md/clip-ready, W14
// md/session-end): same transport, token and errors as Send. With no base URL configured the
// envelope is logged (event id only) and treated as sent.
func (n *N8n) PostEnvelope(ctx context.Context, path string, env Envelope) error {
	if path == "" {
		return ports.E(port, "n8n", ports.KindInvalid, "n8n webhook path is empty")
	}
	if !n.Configured() {
		if n != nil && n.Log != nil {
			n.Log.InfoContext(ctx, "n8n envelope (dev only, N8N_BASE_URL unset)", "path", path, "bytes", len(env.Payload))
		}
		return nil
	}
	return n.post(ctx, path, env)
}

func (n *N8n) post(ctx context.Context, path string, env Envelope) error {
	body, _ := json.Marshal(env)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(n.BaseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if n.Token != "" {
		req.Header.Set("X-MD-Webhook-Token", n.Token)
	}
	client := n.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return ports.E(port, "n8n", ports.KindTimeout, "n8n webhook timeout")
		}
		return ports.E(port, "n8n", ports.KindUnavailable, "n8n webhook unreachable")
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	switch {
	case resp.StatusCode >= 500:
		return ports.E(port, "n8n", ports.KindUnavailable, fmt.Sprintf("n8n webhook %d", resp.StatusCode))
	case resp.StatusCode >= 400:
		return ports.E(port, "n8n", ports.KindInvalid, fmt.Sprintf("n8n webhook %d", resp.StatusCode))
	}
	return nil
}
