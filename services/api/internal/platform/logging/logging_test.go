package logging_test

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// MD-051: an Aadhaar-like number never reaches the logs, whichever way it is logged.
func TestRedactLogsNeverContainAadhaar(t *testing.T) {
	n := "23456789012"
	n += string(privacy.VerhoeffCheckDigit(n))
	spaced := n[:4] + " " + n[4:8] + " " + n[8:]
	var buf bytes.Buffer
	log := logging.New(&buf, "debug", slog.String("service", "test"))
	log.Info("user said " + spaced)
	log.Info("attr", "text", "aadhaar "+n, "num", 234567890123, "err", errors.New("bad input "+n))
	log.With("ctx", "aadhaar "+n).Warn("with")
	log.WithGroup("g").Info("group", slog.Group("inner", slog.String("v", n)))
	log.Info("map", "payload", map[string]string{"message": "my aadhaar " + n})
	out := buf.String()
	if strings.Contains(out, n) || strings.Contains(out, spaced) {
		t.Fatalf("Aadhaar reached the log:\n%s", out)
	}
	if !strings.Contains(out, "[aadhaar removed]") || !strings.Contains(out, `"pii_redacted":"aadhaar"`) {
		t.Fatalf("redaction marker missing:\n%s", out)
	}
}

func TestRedactLogsOTPPhoneEmail(t *testing.T) {
	var buf bytes.Buffer
	log := logging.New(&buf, "info")
	log.Info("sms", "body", "your OTP is 482913", "to", "+91 98765 43210", "email", "kabir@example.com")
	out := buf.String()
	for _, leak := range []string{"482913", "98765", "kabir@example.com"} {
		if strings.Contains(out, leak) {
			t.Fatalf("%s reached the log: %s", leak, out)
		}
	}
}

func TestRedactLogsTimestampsInIST(t *testing.T) {
	var buf bytes.Buffer
	logging.New(&buf, "info").Info("x")
	if !strings.Contains(buf.String(), "+05:30") {
		t.Fatalf("log time should be IST: %s", buf.String())
	}
}
