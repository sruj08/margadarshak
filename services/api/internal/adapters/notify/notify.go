// Package notify holds NotificationPort implementations (MD-042, F-53, D-16):
//
//   - Console: dev; writes the rendered message to the (PII-redacting) log.
//   - SMTP: e-mail through a transactional provider's SMTP relay (SMTP_* env).
//   - SMSDisabled: SMS stays off until TRAI DLT registration; returns disabled_until_dlt.
//   - Pending: placeholder for channels delivered by n8n (WhatsApp, MD-129) or web push (VAPID).
//   - Router: picks the implementation per channel.
//
// Delivery state is persisted to E-13 by notifysvc, not here.
package notify

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/smtp"
	"sort"
	"strings"

	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

const port = "notification"

// Template is a minimal message template. Vars are substituted as {{name}}.
type Template struct {
	Subject string
	Body    string
}

// Templates are the platform templates (product templates arrive with MD-129 / n8n).
var Templates = map[string]map[string]Template{
	"auth.magic_link": {
		"en": {Subject: "Your Margdarshak sign-in link", Body: "Open this link within {{ttl_minutes}} minutes to sign in:\n{{link}}\n\nIf you did not ask for it, ignore this e-mail. Margdarshak never asks for your Aadhaar number or an OTP.\n\nIndependent prototype. Not affiliated with MoRTH, NIC or any State Transport Department."},
		"hi": {Subject: "आपका मार्गदर्शक साइन-इन लिंक", Body: "साइन इन करने के लिए {{ttl_minutes}} मिनट के अंदर यह लिंक खोलें:\n{{link}}\n\nअगर आपने यह नहीं माँगा, तो इस ईमेल को अनदेखा करें। मार्गदर्शक कभी आपका आधार नंबर या OTP नहीं माँगता।\n\nस्वतंत्र प्रोटोटाइप। MoRTH, NIC या किसी राज्य परिवहन विभाग से संबद्ध नहीं।"},
	},
}

// Render fills a template; unknown templates render the id and vars (dev only).
func Render(templateID, lang string, vars map[string]string) Template {
	byLang, ok := Templates[templateID]
	if !ok {
		keys := make([]string, 0, len(vars))
		for k := range vars {
			keys = append(keys, k+"="+vars[k])
		}
		sort.Strings(keys)
		return Template{Subject: templateID, Body: strings.Join(keys, "\n")}
	}
	t, ok := byLang[lang]
	if !ok {
		t = byLang["en"]
	}
	for k, v := range vars {
		t.Subject = strings.ReplaceAll(t.Subject, "{{"+k+"}}", v)
		t.Body = strings.ReplaceAll(t.Body, "{{"+k+"}}", v)
	}
	return t
}

// Console logs messages (dev). The logger's redaction masks the recipient address; the body is
// logged so a developer can click a magic link locally.
type Console struct{ Log *slog.Logger }

// Name implements ports.NotificationPort.
func (c Console) Name() string { return "console" }

// Send implements ports.NotificationPort.
func (c Console) Send(ctx context.Context, m ports.Message) (ports.DeliveryResult, error) {
	t := Render(m.TemplateID, m.Language, m.Vars)
	c.Log.InfoContext(ctx, "console notification (dev only)", "channel", m.Channel, "template", m.TemplateID,
		"to", m.To, "subject", t.Subject, "body", t.Body, "idempotency_key", m.IdempotencyKey,
		// The redactor can mask digit runs inside the token; a dev logger writes this one verbatim
		// (logging.NewDev, APP_ENV dev/test only); any other logger redacts it as usual.
		"dev_link", logging.DevValue(m.Vars["link"]))
	return ports.DeliveryResult{Status: ports.DeliverySent, Provider: "console", ProviderMessageID: "console-" + randomID()}, nil
}

// SMTP sends e-mail through an SMTP relay with STARTTLS (net/smtp upgrades when offered).
type SMTP struct {
	Host, User, Pass, From string
	Port                   int
	// send is replaceable in tests.
	send func(addr string, a smtp.Auth, from string, to []string, msg []byte) error
}

// Name implements ports.NotificationPort.
func (s *SMTP) Name() string { return "smtp" }

// Send implements ports.NotificationPort.
func (s *SMTP) Send(ctx context.Context, m ports.Message) (ports.DeliveryResult, error) {
	if m.Channel != "email" {
		return ports.DeliveryResult{Status: ports.DeliveryFailed}, ports.E(port, "Send", ports.KindUnsupported, "smtp sends email only")
	}
	if err := ctx.Err(); err != nil {
		return ports.DeliveryResult{Status: ports.DeliveryFailed}, ports.E(port, "Send", ports.KindTimeout, err.Error())
	}
	t := Render(m.TemplateID, m.Language, m.Vars)
	id := randomID() + "@margdarshak"
	msg := "From: " + s.From + "\r\nTo: " + m.To + "\r\nSubject: " + mimeHeader(t.Subject) + "\r\nMessage-ID: <" + id + ">\r\n" +
		"MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n" + t.Body + "\r\n"
	var auth smtp.Auth
	if s.User != "" {
		auth = smtp.PlainAuth("", s.User, s.Pass, s.Host)
	}
	send := s.send
	if send == nil {
		send = smtp.SendMail
	}
	from := s.From
	if i := strings.LastIndex(from, "<"); i >= 0 {
		from = strings.TrimSuffix(from[i+1:], ">")
	}
	if err := send(fmt.Sprintf("%s:%d", s.Host, s.Port), auth, from, []string{m.To}, []byte(msg)); err != nil {
		return ports.DeliveryResult{Status: ports.DeliveryFailed, Provider: "smtp"}, ports.E(port, "Send", ports.KindUnavailable, "smtp relay error")
	}
	return ports.DeliveryResult{Status: ports.DeliverySent, Provider: "smtp", ProviderMessageID: id}, nil
}

func mimeHeader(s string) string {
	for _, r := range s {
		if r > 127 {
			return "=?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(s)) + "?="
		}
	}
	return s
}

// SMSDisabled is the SMS path until TRAI DLT registration (D-16).
type SMSDisabled struct{}

// Name implements ports.NotificationPort.
func (SMSDisabled) Name() string { return "sms_disabled" }

// Send implements ports.NotificationPort.
func (SMSDisabled) Send(context.Context, ports.Message) (ports.DeliveryResult, error) {
	return ports.DeliveryResult{Status: ports.DeliveryDisabledUntilDLT, Provider: "none"},
		ports.E(port, "Send", ports.KindUnsupported, "disabled_until_dlt")
}

// Pending accepts a message for a channel whose sender lives elsewhere (n8n WhatsApp, MD-129;
// web push, VAPID) and reports it queued.
type Pending struct{ Provider string }

// Name implements ports.NotificationPort.
func (p Pending) Name() string { return p.Provider }

// Send implements ports.NotificationPort.
func (p Pending) Send(context.Context, ports.Message) (ports.DeliveryResult, error) {
	return ports.DeliveryResult{Status: ports.DeliveryQueued, Provider: p.Provider}, nil
}

// Router dispatches by channel.
type Router struct {
	ByChannel map[string]ports.NotificationPort
}

// NewRouter builds the default router: e-mail via SMTP when configured, else console; SMS
// disabled; WhatsApp queued for n8n; web push queued; in-app console.
func NewRouter(email ports.NotificationPort, log *slog.Logger) *Router {
	return &Router{ByChannel: map[string]ports.NotificationPort{
		"email":    email,
		"sms":      SMSDisabled{},
		"whatsapp": Pending{Provider: "n8n"},
		"web_push": Pending{Provider: "webpush"},
		"in_app":   Console{Log: log},
	}}
}

// Name implements ports.NotificationPort.
func (r *Router) Name() string { return "router" }

// Send implements ports.NotificationPort.
func (r *Router) Send(ctx context.Context, m ports.Message) (ports.DeliveryResult, error) {
	p, ok := r.ByChannel[m.Channel]
	if !ok {
		return ports.DeliveryResult{Status: ports.DeliveryFailed}, ports.E(port, "Send", ports.KindUnsupported, "channel "+m.Channel)
	}
	return p.Send(ctx, m)
}

func randomID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
