// Package logging builds the JSON slog logger with a PII-redaction handler (MD-051, D-18).
// Every message and every string-like attribute passes through privacy.Redact before it is
// written, so an Aadhaar number (Verhoeff-checked), VID, OTP-like code, phone number, e-mail or
// PAN never reaches stdout, the log drain or the retention store.
package logging

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// New returns a JSON logger writing to w at the given level, wrapped in the redactor.
// Timestamps are written in IST (server time is the source of truth, EC-15).
func New(w io.Writer, level string, attrs ...slog.Attr) *slog.Logger {
	var lv slog.Level
	if err := lv.UnmarshalText([]byte(level)); err != nil {
		lv = slog.LevelInfo
	}
	base := slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level: lv,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if len(groups) == 0 && a.Key == slog.TimeKey && a.Value.Kind() == slog.KindTime {
				return slog.String(slog.TimeKey, a.Value.Time().In(servertime.IST).Format(time.RFC3339Nano))
			}
			return a
		},
	})
	return slog.New(NewRedactor(base)).With(attrsToAny(attrs)...)
}

// NewDev is New for APP_ENV dev and test: values wrapped in DevValue (the magic link a developer
// clicks locally) are written as they are. Everything else is still redacted, and New (staging,
// production, field) redacts DevValue like any other string.
func NewDev(w io.Writer, level string, attrs ...slog.Attr) *slog.Logger {
	l := New(w, level)
	r := l.Handler().(*Redactor)
	return slog.New(&Redactor{next: r.next, allowDev: true}).With(attrsToAny(attrs)...)
}

// DevValue marks a log value that only a dev logger (NewDev) writes unredacted.
type DevValue string

func attrsToAny(attrs []slog.Attr) []any {
	out := make([]any, len(attrs))
	for i, a := range attrs {
		out[i] = a
	}
	return out
}

// Redactor is a slog.Handler that redacts PII before delegating.
type Redactor struct {
	next     slog.Handler
	allowDev bool
}

// NewRedactor wraps next.
func NewRedactor(next slog.Handler) *Redactor { return &Redactor{next: next} }

// Enabled implements slog.Handler.
func (h *Redactor) Enabled(ctx context.Context, l slog.Level) bool { return h.next.Enabled(ctx, l) }

// Handle implements slog.Handler.
func (h *Redactor) Handle(ctx context.Context, r slog.Record) error {
	msg, kinds := privacy.Redact(r.Message)
	out := slog.NewRecord(r.Time, r.Level, msg, r.PC)
	r.Attrs(func(a slog.Attr) bool {
		ra, k := h.redactAttr(a)
		kinds = append(kinds, k...)
		out.AddAttrs(ra)
		return true
	})
	if len(kinds) > 0 {
		// Record that a redaction happened (type only, never the value).
		out.AddAttrs(slog.Any("pii_redacted", uniqueKinds(kinds)))
	}
	return h.next.Handle(ctx, out)
}

// WithAttrs implements slog.Handler.
func (h *Redactor) WithAttrs(attrs []slog.Attr) slog.Handler {
	red := make([]slog.Attr, len(attrs))
	for i, a := range attrs {
		red[i], _ = h.redactAttr(a)
	}
	return &Redactor{next: h.next.WithAttrs(red), allowDev: h.allowDev}
}

// WithGroup implements slog.Handler.
func (h *Redactor) WithGroup(name string) slog.Handler {
	return &Redactor{next: h.next.WithGroup(name), allowDev: h.allowDev}
}

func (h *Redactor) redactAttr(a slog.Attr) (slog.Attr, []privacy.Kind) {
	v := a.Value.Resolve()
	if dv, ok := v.Any().(DevValue); ok && v.Kind() == slog.KindAny {
		if h.allowDev {
			return slog.String(a.Key, string(dv)), nil
		}
		s, k := privacy.Redact(string(dv))
		return slog.String(a.Key, s), k
	}
	switch v.Kind() {
	case slog.KindString:
		s, k := privacy.Redact(v.String())
		return slog.String(a.Key, s), k
	case slog.KindGroup:
		var kinds []privacy.Kind
		group := v.Group()
		out := make([]any, 0, len(group))
		for _, g := range group {
			ra, k := h.redactAttr(g)
			kinds = append(kinds, k...)
			out = append(out, ra)
		}
		return slog.Group(a.Key, out...), kinds
	case slog.KindInt64, slog.KindUint64:
		// A 12-digit Aadhaar or a 10-digit phone can arrive as a number.
		s, k := privacy.Redact(v.String())
		if len(k) > 0 {
			return slog.String(a.Key, s), k
		}
		return slog.Attr{Key: a.Key, Value: v}, nil
	case slog.KindAny:
		val := v.Any()
		if err, ok := val.(error); ok {
			s, k := privacy.Redact(err.Error())
			return slog.String(a.Key, s), k
		}
		if st, ok := val.(fmt.Stringer); ok {
			s, k := privacy.Redact(st.String())
			return slog.String(a.Key, s), k
		}
		b, err := json.Marshal(val)
		if err != nil {
			s, k := privacy.Redact(fmt.Sprint(val))
			return slog.String(a.Key, s), k
		}
		s, k := privacy.Redact(string(b))
		if len(k) == 0 {
			return slog.Attr{Key: a.Key, Value: v}, nil
		}
		return slog.String(a.Key, s), k
	default:
		return slog.Attr{Key: a.Key, Value: v}, nil
	}
}

func uniqueKinds(kinds []privacy.Kind) string {
	seen := map[privacy.Kind]bool{}
	var out []string
	for _, k := range kinds {
		if !seen[k] {
			seen[k] = true
			out = append(out, string(k))
		}
	}
	return strings.Join(out, ",")
}

// Discard returns a logger that drops everything (tests).
func Discard() *slog.Logger { return slog.New(slog.DiscardHandler) }
