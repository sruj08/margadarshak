package logging_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
)

// P1 follow-up: the dev console prints the magic link verbatim (its token can contain a digit
// run next to "code", which the OTP rule masks); every non-dev logger still redacts it, and the
// dev logger still redacts ordinary values.
func TestDevValueOnlyUnredactedInDevLogger(t *testing.T) {
	link := "http://localhost:3000/en/signin/verify?code=123456"
	var dev, prod bytes.Buffer
	logging.NewDev(&dev, "info").Info("console notification", "dev_link", logging.DevValue(link), "note", "your otp is 654321")
	logging.New(&prod, "info").Info("console notification", "dev_link", logging.DevValue(link), "note", "your otp is 654321")
	if !strings.Contains(dev.String(), link) {
		t.Fatalf("dev logger masked the link: %s", dev.String())
	}
	if strings.Contains(dev.String(), "654321") {
		t.Fatalf("dev logger must still redact ordinary values: %s", dev.String())
	}
	if strings.Contains(prod.String(), "123456") || strings.Contains(prod.String(), "654321") {
		t.Fatalf("production logger leaked a code: %s", prod.String())
	}
}
