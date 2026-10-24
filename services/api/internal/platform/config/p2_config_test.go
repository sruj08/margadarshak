package config

import (
	"strings"
	"testing"
	"time"
)

func setProdSecrets(t *testing.T) {
	t.Helper()
	for _, k := range []string{"SESSION_SIGNING_KEY", "CONTACT_ENCRYPTION_KEY", "INTERNAL_HMAC_SECRET",
		"PAYMENT_CALLBACK_SECRET", "AADHAAR_MOCK_SIGNING_KEY", "INTERNAL_BEARER_TOKENS"} {
		t.Setenv(k, "test-value-"+k)
	}
}

// P2: the verifier secret is read under the API's name or the verifier's own name, with a
// 2 s budget by default; the address comes from SCORE_VERIFIER_HOSTPORT.
func TestScoreVerifierConfig(t *testing.T) {
	t.Setenv("APP_ENV", "dev")
	t.Setenv("SCORE_VERIFIER_SHARED_SECRET", "")
	t.Setenv("VERIFIER_SHARED_SECRET", "shared-by-both")
	t.Setenv("SCORE_VERIFIER_HOSTPORT", "score-verifier:8081")
	c, _, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.ScoreVerifierSecret != "shared-by-both" || c.ScoreVerifierTimeout != 2*time.Second || c.ScoreVerifierURL != "http://score-verifier:8081" {
		t.Fatalf("got secret %q timeout %v url %q", c.ScoreVerifierSecret, c.ScoreVerifierTimeout, c.ScoreVerifierURL)
	}
	if c.ObjectStore != "mock" || c.MediaURLTTL != 2*time.Hour || c.N8NClipReadyPath != "/webhook/md/clip-ready" {
		t.Fatalf("defaults: %q %v %q", c.ObjectStore, c.MediaURLTTL, c.N8NClipReadyPath)
	}
	// Production without a verifier secret starts (with a warning): sessions stay pending.
	setProdSecrets(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("VERIFIER_SHARED_SECRET", "")
	_, warnings, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(warnings, "\n"), "SCORE_VERIFIER_SHARED_SECRET") {
		t.Fatalf("no warning: %v", warnings)
	}
}

// OBJECT_STORE=r2 needs its credentials; an unknown store is refused.
func TestObjectStoreConfig(t *testing.T) {
	t.Setenv("APP_ENV", "dev")
	t.Setenv("OBJECT_STORE", "r2")
	if _, _, err := Load(); err == nil || !strings.Contains(err.Error(), "R2_") {
		t.Fatalf("r2 without credentials accepted (err %v)", err)
	}
	t.Setenv("R2_ACCOUNT_ID", "acct")
	t.Setenv("R2_ACCESS_KEY_ID", "id")
	t.Setenv("R2_SECRET_ACCESS_KEY", "secret")
	t.Setenv("R2_BUCKET_CLIPS", "clips")
	if _, _, err := Load(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OBJECT_STORE", "s3")
	if _, _, err := Load(); err == nil {
		t.Fatal("unknown OBJECT_STORE accepted")
	}
}

// P1 follow-up (c): the device-session limit override is for dev and test only.
func TestDevDeviceSessionRateLimitIsDevOnly(t *testing.T) {
	t.Setenv("DEV_DEVICE_SESSION_RATE_LIMIT", "500")
	t.Setenv("APP_ENV", "test")
	c, _, err := Load()
	if err != nil || c.DevDeviceSessionRateLimit != 500 {
		t.Fatalf("test: %v %d", err, c.DevDeviceSessionRateLimit)
	}
	setProdSecrets(t)
	for _, env := range []string{"staging", "production", "field"} {
		t.Setenv("APP_ENV", env)
		if _, _, err := Load(); err == nil || !strings.Contains(err.Error(), "DEV_DEVICE_SESSION_RATE_LIMIT") {
			t.Fatalf("%s accepted the override (err %v)", env, err)
		}
	}
}
