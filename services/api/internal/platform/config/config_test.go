package config

import (
	"strings"
	"testing"
	"time"
)

// DEV_CLOCK_OFFSET shifts the server clock for the full-stack e2e; it must never be honoured
// outside dev and test (EC-15: server time is the source of truth).
func TestDevClockOffsetIsDevOnly(t *testing.T) {
	t.Setenv("DEV_CLOCK_OFFSET", "9h")
	t.Setenv("APP_ENV", "dev")
	c, warnings, err := Load()
	if err != nil {
		t.Fatalf("dev: %v", err)
	}
	if c.DevClockOffset != 9*time.Hour {
		t.Fatalf("offset = %v, want 9h", c.DevClockOffset)
	}
	found := false
	for _, w := range warnings {
		if w == "DEV_CLOCK_OFFSET set: the server clock is shifted by 9h0m0s" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no warning for the shifted clock: %v", warnings)
	}

	// Every secret present, so the only reason to refuse is the offset.
	for _, k := range []string{"SESSION_SIGNING_KEY", "CONTACT_ENCRYPTION_KEY", "INTERNAL_HMAC_SECRET",
		"PAYMENT_CALLBACK_SECRET", "AADHAAR_MOCK_SIGNING_KEY", "INTERNAL_BEARER_TOKENS"} {
		t.Setenv(k, "test-value-"+k)
	}
	for _, env := range []string{"staging", "production", "field"} {
		t.Setenv("APP_ENV", env)
		t.Setenv("DEV_CLOCK_OFFSET", "")
		if _, _, err := Load(); err != nil {
			t.Fatalf("%s without the offset: %v", env, err)
		}
		t.Setenv("DEV_CLOCK_OFFSET", "9h")
		if _, _, err := Load(); err == nil || !strings.Contains(err.Error(), "DEV_CLOCK_OFFSET") {
			t.Fatalf("%s accepted DEV_CLOCK_OFFSET (err %v)", env, err)
		}
	}
}
