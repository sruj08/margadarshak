// Package config reads the API configuration from environment variables (caarlos0/env).
// Every variable is listed in services/api/README.md. Names used by infra/render.yaml,
// infra/docker/compose.yaml and .github/workflows/ci.yml are accepted as aliases.
//
// No real secrets are needed locally: in dev and test, missing secrets fall back to
// deterministic, clearly-insecure dev values (so data encrypted by a dev run stays readable after
// a restart). staging, production and field refuse to start without them.
package config

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/caarlos0/env/v11"
)

// Config is the full API configuration.
type Config struct {
	Env      string `env:"APP_ENV" envDefault:"dev"` // dev | test | staging | production | field
	Port     string `env:"PORT" envDefault:"8000"`
	Addr     string `env:"API_ADDR"` // overrides PORT when set, e.g. "127.0.0.1:8000"
	Commit   string `env:"COMMIT_SHA" envDefault:"dev"`
	Version  string `env:"APP_VERSION"`
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`

	// API_INTERNAL_HOSTPORT is what `api healthcheck` calls (default 127.0.0.1:$PORT).
	InternalHostPort string `env:"API_INTERNAL_HOSTPORT"`
	DebugPprof       bool   `env:"DEBUG_PPROF" envDefault:"false"`

	// Database. With DEV_EMBEDDED_PG=true (dev only) the API starts a local PostgreSQL 16 with
	// fergusstrange/embedded-postgres, so no Docker is needed.
	DatabaseURL       string `env:"DATABASE_URL"`
	EmbeddedPostgres  bool   `env:"DEV_EMBEDDED_PG" envDefault:"false"`
	EmbeddedPGAlias   bool   `env:"EMBEDDED_POSTGRES" envDefault:"false"`
	EmbeddedPGPort    uint32 `env:"EMBEDDED_POSTGRES_PORT" envDefault:"5439"`
	EmbeddedPGDataDir string `env:"EMBEDDED_POSTGRES_DATA" envDefault:".cache/pgdata"`
	CacheDir          string `env:"MD_CACHE_DIR" envDefault:".cache"`
	MigrateOnStart    bool   `env:"MIGRATE_ON_START" envDefault:"false"`

	// REDIS_URL: rate limits and the HMAC replay cache. Empty means in-memory (single instance).
	RedisURL string `env:"REDIS_URL"`

	DefaultTenant   string   `env:"TENANT_DEFAULT" envDefault:"JK"`
	PublicBaseURL   string   `env:"PUBLIC_BASE_URL" envDefault:"http://localhost:8000"`
	WebBaseURL      string   `env:"WEB_BASE_URL" envDefault:"http://localhost:3000"`
	CORSOrigins     []string `env:"CORS_ALLOWED_ORIGINS" envSeparator:","`
	CORSOriginsAlt  []string `env:"CORS_ORIGINS" envSeparator:","`
	RulepackDir     string   `env:"RULEPACK_DIR"`
	ScoreVerifierHP string   `env:"SCORE_VERIFIER_HOSTPORT"`

	// P2 compute service (services/score-verifier, decision D1): every POST is signed with
	// SCORE_VERIFIER_SHARED_SECRET (alias VERIFIER_SHARED_SECRET, the name the verifier reads);
	// one call, retry included, gets SCORE_VERIFIER_TIMEOUT. SCORE_VERIFIER_URL overrides
	// http://.
	ScoreVerifierSecret    string        `env:"SCORE_VERIFIER_SHARED_SECRET"`
	ScoreVerifierSecretAlt string        `env:"VERIFIER_SHARED_SECRET"`
	ScoreVerifierURL       string        `env:"SCORE_VERIFIER_URL"`
	ScoreVerifierTimeout   time.Duration `env:"SCORE_VERIFIER_TIMEOUT" envDefault:"2s"`

	// P2 content: CONTENT_DIR is the repo content/ folder (curriculum/*.json and
	// generated/game-items.json). Empty means ../../content relative to services/api, then ./content.
	ContentDir string `env:"CONTENT_DIR"`

	// P2 object storage (decision D5): OBJECT_STORE=mock (filesystem under MOCK_MEDIA_DIR, served
	// by the API at /mock/media/) or r2 (Cloudflare R2, SigV4). MEDIA_PUBLIC_BASE_URL, when set,
	// serves published media from a CDN host instead of presigned URLs; MEDIA_URL_TTL is the
	// presigned URL lifetime.
	ObjectStore        string        `env:"OBJECT_STORE" envDefault:"mock"`
	MockMediaDir       string        `env:"MOCK_MEDIA_DIR"`
	R2AccountID        string        `env:"R2_ACCOUNT_ID"`
	R2AccessKeyID      string        `env:"R2_ACCESS_KEY_ID"`
	R2SecretAccessKey  string        `env:"R2_SECRET_ACCESS_KEY"`
	R2BucketClips      string        `env:"R2_BUCKET_CLIPS"`
	R2BucketIngest     string        `env:"R2_BUCKET_INGEST"`
	R2Endpoint         string        `env:"R2_ENDPOINT"`
	MediaPublicBaseURL string        `env:"MEDIA_PUBLIC_BASE_URL"`
	MediaURLTTL        time.Duration `env:"MEDIA_URL_TTL" envDefault:"2h"`

	// Adapter overrides (ADAPTER_SARATHI=mock|deeplink, ...). Empty means the tenant config in
	// core.tenant_adapter_config decides. Swapping an implementation is a config change only.
	AdapterSarathi        string `env:"ADAPTER_SARATHI"`
	AdapterDigiLocker     string `env:"ADAPTER_DIGILOCKER"`
	AdapterAadhaarOffline string `env:"ADAPTER_AADHAAR_OFFLINE"`
	AdapterBhashini       string `env:"ADAPTER_BHASHINI"`
	AdapterPayment        string `env:"ADAPTER_PAYMENT"`
	AdapterNotification   string `env:"ADAPTER_NOTIFICATION"`
	AdapterSlot           string `env:"ADAPTER_SLOT"`

	// Secrets (base64 or raw strings).
	SessionSecret        string   `env:"SESSION_SIGNING_KEY"` // signs md_sid cookies and consent artefacts
	SessionSecretAlt     string   `env:"SESSION_SECRET"`
	KEK                  string   `env:"CONTACT_ENCRYPTION_KEY"` // base64 32 bytes; derives per-tenant DEKs
	KEKAlt               string   `env:"DATA_KEK"`
	BlindIndexPepper     string   `env:"BLIND_INDEX_PEPPER"`
	InternalHMACSecret   string   `env:"INTERNAL_HMAC_SECRET"` // n8n / Workflows -> /internal/*
	N8NHMACSecret        string   `env:"N8N_HMAC_SECRET"`
	InternalBearerTokens []string `env:"INTERNAL_BEARER_TOKENS" envSeparator:","`
	PaymentCallbackKey   string   `env:"PAYMENT_CALLBACK_SECRET"` // mock gateway callback signatures
	AadhaarMockKey       string   `env:"AADHAAR_MOCK_SIGNING_KEY"`

	SessionTTL   time.Duration `env:"SESSION_TTL" envDefault:"4320h"` // 180 days sliding
	MagicLinkTTL time.Duration `env:"MAGIC_LINK_TTL" envDefault:"15m"`
	CookieSecure bool          `env:"COOKIE_SECURE" envDefault:"false"`

	// Google OIDC. The hackathon build ships a stub verifier for dev; see accounts.GoogleVerifier.
	GoogleClientID string `env:"GOOGLE_CLIENT_ID"`

	// Notifications (MD-042). Empty SMTP_HOST means e-mail goes to the console notifier.
	SMTPHost string `env:"SMTP_HOST"`
	SMTPPort int    `env:"SMTP_PORT" envDefault:"587"`
	SMTPUser string `env:"SMTP_USER"`
	SMTPPass string `env:"SMTP_PASSWORD"`
	SMTPFrom string `env:"SMTP_FROM" envDefault:"Margdarshak <no-reply@margdarshak.example>"`

	// n8n messaging edge (MD-128/129): the W02 milestone webhook. Empty N8N_BASE_URL logs the
	// envelope instead (dev, CI). The envelope is signed with N8N_HMAC_SECRET (falls back to
	// INTERNAL_HMAC_SECRET); the webhook token is n8n's Header Auth credential (X-MD-Webhook-Token).
	N8NBaseURL      string `env:"N8N_BASE_URL"`
	N8NWebhookPath  string `env:"N8N_MILESTONE_WEBHOOK_PATH" envDefault:"/webhook/md/milestone"`
	N8NWebhookToken string `env:"N8N_WEBHOOK_TOKEN"`
	// P2 webhooks: W08 md/clip-ready (clip review queue) and W14 md/session-end (field study).
	// N8N_RESUME_AUTH_TOKEN is sent as X-MD-Resume-Token when a saved rating resumes a W08 wait.
	N8NClipReadyPath    string `env:"N8N_CLIP_READY_PATH" envDefault:"/webhook/md/clip-ready"`
	N8NStudyWebhookPath string `env:"N8N_STUDY_WEBHOOK_PATH" envDefault:"/webhook/md/session-end"`
	N8NResumeAuthToken  string `env:"N8N_RESUME_AUTH_TOKEN"`

	// DEMO_MODE enables the demo-tenant persona switcher (MD-122) outside dev/test, e.g. on the
	// hackathon staging deploy. It is never honoured in production or field mode.
	DemoMode bool `env:"DEMO_MODE" envDefault:"false"`

	// DEV_CLOCK_OFFSET shifts the server clock (e.g. "9h") so the full-stack e2e can run the case
	// clock outside quiet hours whatever the wall time. dev/test only; refused anywhere else.
	DevClockOffset time.Duration `env:"DEV_CLOCK_OFFSET"`

	// Field-study lab (MD-139/140): X-Lab-Token values that unlock API-70. Dev default dev-lab-token.
	LabTokens []string `env:"LAB_TOKENS" envSeparator:","`

	// DEV_DEVICE_SESSION_RATE_LIMIT raises the anonymous device-session limit (createDeviceSession,
	// 10 per hour per IP) for the e2e suites, which open many sessions from one IP. dev/test only;
	// 0 keeps the default; refused anywhere else.
	DevDeviceSessionRateLimit int `env:"DEV_DEVICE_SESSION_RATE_LIMIT"`

	// Jobs (MD-052): inline | render_workflows | temporal (design only).
	JobRunner          string `env:"JOB_RUNNER" envDefault:"inline"`
	RenderAPIBase      string `env:"RENDER_API_BASE" envDefault:"https://api.render.com"`
	RenderAPIKey       string `env:"RENDER_API_KEY"`
	RenderWorkflowSlug string `env:"WORKFLOW_SLUG"`
	RenderSlugAlt      string `env:"RENDER_WORKFLOW_SLUG"`
	RenderUseLocalDev  bool   `env:"RENDER_USE_LOCAL_DEV" envDefault:"false"`
	RenderLocalDevURL  string `env:"RENDER_LOCAL_DEV_URL" envDefault:"http://localhost:8120"`

	// AI model IDs live only in env vars (PROJECT_BRIEF §10); the AI layer reads them.
	GeminiModelDebrief      string `env:"GEMINI_MODEL_DEBRIEF"`
	GeminiModelVision       string `env:"GEMINI_MODEL_VISION"`
	GeminiModelLive         string `env:"GEMINI_MODEL_LIVE"`
	GeminiModelLiveFallback string `env:"GEMINI_MODEL_LIVE_FALLBACK"`

	// Observability: none | stdout.
	TracesExporter string `env:"OTEL_TRACES_EXPORTER" envDefault:"none"`
	OTelDisabled   bool   `env:"OTEL_SDK_DISABLED" envDefault:"false"`
}

// Load reads the environment, resolves aliases and fills dev secrets.
func Load() (*Config, []string, error) {
	var c Config
	if err := env.Parse(&c); err != nil {
		return nil, nil, fmt.Errorf("config: %w", err)
	}
	c.resolveAliases()
	warnings, err := c.fillSecrets()
	return &c, warnings, err
}

func (c *Config) resolveAliases() {
	pick := func(dst *string, alts ...string) {
		for _, a := range alts {
			if *dst == "" && a != "" {
				*dst = a
			}
		}
	}
	pick(&c.SessionSecret, c.SessionSecretAlt)
	pick(&c.KEK, c.KEKAlt)
	pick(&c.InternalHMACSecret, c.N8NHMACSecret)
	pick(&c.N8NHMACSecret, c.InternalHMACSecret)
	pick(&c.ScoreVerifierSecret, c.ScoreVerifierSecretAlt)
	pick(&c.RenderWorkflowSlug, c.RenderSlugAlt, "mg-workflows")
	if c.ScoreVerifierURL == "" && c.ScoreVerifierHP != "" {
		c.ScoreVerifierURL = "http://" + c.ScoreVerifierHP
	}
	if c.ScoreVerifierTimeout <= 0 {
		c.ScoreVerifierTimeout = 2 * time.Second
	}
	if c.MediaURLTTL <= 0 {
		c.MediaURLTTL = 2 * time.Hour
	}
	if c.ObjectStore == "" {
		c.ObjectStore = "mock"
	}
	if c.Addr == "" {
		c.Addr = ":" + c.Port
	}
	if c.InternalHostPort == "" {
		c.InternalHostPort = "127.0.0.1:" + c.Port
	}
	if len(c.CORSOrigins) == 0 {
		c.CORSOrigins = c.CORSOriginsAlt
	}
	if len(c.CORSOrigins) == 0 {
		c.CORSOrigins = []string{"http://localhost:3000"}
	}
	c.EmbeddedPostgres = c.EmbeddedPostgres || c.EmbeddedPGAlias
	if c.TracesExporter == "" || c.OTelDisabled {
		c.TracesExporter = "none"
	}
}

// DemoAllowed reports whether demo-only endpoints may run (persona switcher).
func (c *Config) DemoAllowed() bool {
	switch c.Env {
	case "dev", "test":
		return true
	case "staging":
		return c.DemoMode
	}
	return false
}

// IsProduction reports whether strict settings apply.
func (c *Config) IsProduction() bool {
	return c.Env == "production" || c.Env == "field" || c.Env == "staging"
}

// AdapterOverrides returns the ADAPTER_* environment overrides keyed by port name.
func (c *Config) AdapterOverrides() map[string]string {
	out := map[string]string{}
	for port, v := range map[string]string{
		"sarathi": c.AdapterSarathi, "digilocker": c.AdapterDigiLocker, "aadhaar_offline": c.AdapterAadhaarOffline,
		"bhashini": c.AdapterBhashini, "payment": c.AdapterPayment, "notification": c.AdapterNotification, "slot": c.AdapterSlot,
	} {
		if v != "" {
			out[port] = v
		}
	}
	return out
}

func (c *Config) fillSecrets() ([]string, error) {
	var warnings []string
	fields := []struct {
		name string
		v    *string
	}{
		{"SESSION_SIGNING_KEY", &c.SessionSecret},
		{"CONTACT_ENCRYPTION_KEY", &c.KEK},
		{"INTERNAL_HMAC_SECRET", &c.InternalHMACSecret},
		{"PAYMENT_CALLBACK_SECRET", &c.PaymentCallbackKey},
		{"AADHAAR_MOCK_SIGNING_KEY", &c.AadhaarMockKey},
	}
	var missing []string
	for _, f := range fields {
		if *f.v == "" {
			missing = append(missing, f.name)
			*f.v = DevSecret(f.name)
		}
	}
	if c.BlindIndexPepper == "" {
		// Derived from the KEK so it is stable across restarts; set it explicitly in production.
		sum := sha256.Sum256([]byte("blind-index-pepper:" + c.KEK))
		c.BlindIndexPepper = base64.StdEncoding.EncodeToString(sum[:])
	}
	if len(missing) > 0 {
		if c.IsProduction() {
			return nil, fmt.Errorf("config: missing secrets in %s: %s", c.Env, strings.Join(missing, ", "))
		}
		warnings = append(warnings, "using insecure dev-only secrets for: "+strings.Join(missing, ", "))
	}
	if len(c.InternalBearerTokens) == 0 {
		if c.IsProduction() {
			return nil, errors.New("config: INTERNAL_BEARER_TOKENS is required")
		}
		c.InternalBearerTokens = []string{"dev-internal-token"}
		warnings = append(warnings, "INTERNAL_BEARER_TOKENS not set; using dev-internal-token")
	}
	if len(c.LabTokens) == 0 && !c.IsProduction() {
		c.LabTokens = []string{"dev-lab-token"}
	}
	if c.DevClockOffset != 0 {
		if c.Env != "dev" && c.Env != "test" {
			return nil, fmt.Errorf("config: DEV_CLOCK_OFFSET is for dev and test only (APP_ENV=%s)", c.Env)
		}
		warnings = append(warnings, "DEV_CLOCK_OFFSET set: the server clock is shifted by "+c.DevClockOffset.String())
	}
	if c.ScoreVerifierSecret == "" {
		if c.IsProduction() {
			// Not fatal: without the verifier every game session stays pending_verification.
			warnings = append(warnings, "SCORE_VERIFIER_SHARED_SECRET not set: game sessions stay pending_verification")
		} else {
			// Dev value; start the verifier with VERIFIER_SHARED_SECRET=dev-only-verifier-secret.
			c.ScoreVerifierSecret = "dev-only-verifier-secret"
		}
	}
	if c.DevDeviceSessionRateLimit != 0 {
		if c.Env != "dev" && c.Env != "test" {
			return nil, fmt.Errorf("config: DEV_DEVICE_SESSION_RATE_LIMIT is for dev and test only (APP_ENV=%s)", c.Env)
		}
		warnings = append(warnings, fmt.Sprintf("DEV_DEVICE_SESSION_RATE_LIMIT set: %d device sessions per hour per IP", c.DevDeviceSessionRateLimit))
	}
	switch c.ObjectStore {
	case "mock":
		if c.IsProduction() && c.Env != "staging" {
			warnings = append(warnings, "OBJECT_STORE=mock in "+c.Env+": clip media is served from the API filesystem")
		}
	case "r2":
		if c.R2AccountID == "" && c.R2Endpoint == "" || c.R2AccessKeyID == "" || c.R2SecretAccessKey == "" || c.R2BucketClips == "" {
			return nil, errors.New("config: OBJECT_STORE=r2 needs R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_CLIPS")
		}
	default:
		return nil, fmt.Errorf("config: unknown OBJECT_STORE %q (mock | r2)", c.ObjectStore)
	}
	if c.IsProduction() {
		c.CookieSecure = true
	}
	return warnings, nil
}

// DevSecret is the deterministic, insecure secret used in dev and test when a variable is unset.
func DevSecret(name string) string {
	sum := sha256.Sum256([]byte("margdarshak-dev-only-insecure:" + name))
	return base64.StdEncoding.EncodeToString(sum[:])
}

// Bytes decodes a secret given as base64 (std or URL) or returns its raw bytes.
func Bytes(s string) []byte {
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if b, err := enc.DecodeString(s); err == nil && len(b) >= 16 {
			return b
		}
	}
	return []byte(s)
}

// Key32 returns exactly 32 bytes for an AES-256 KEK. A key that does not decode to 32 bytes is
// rejected rather than stretched, so a typo cannot silently weaken encryption.
func Key32(s string) ([]byte, error) {
	b := Bytes(s)
	if len(b) != 32 {
		return nil, fmt.Errorf("config: encryption key must decode to 32 bytes, got %d", len(b))
	}
	return b, nil
}

// ForTest returns a config with deterministic test secrets.
func ForTest() *Config {
	c := &Config{
		Env:                  "test",
		Port:                 "0",
		Addr:                 ":0",
		Commit:               "test",
		Version:              "0.0.0-test",
		LogLevel:             "debug",
		DefaultTenant:        "JK",
		PublicBaseURL:        "http://api.test",
		WebBaseURL:           "http://web.test",
		CORSOrigins:          []string{"http://web.test"},
		SessionSecret:        "test-session-secret-0123456789abcdef",
		KEK:                  base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")),
		InternalHMACSecret:   "test-internal-hmac-secret",
		InternalBearerTokens: []string{"test-internal-token"},
		N8NHMACSecret:        "test-n8n-envelope-secret",
		N8NWebhookPath:       "/webhook/md/milestone",
		N8NClipReadyPath:     "/webhook/md/clip-ready",
		N8NStudyWebhookPath:  "/webhook/md/session-end",
		ScoreVerifierSecret:  "test-score-verifier-secret",
		ScoreVerifierTimeout: 2 * time.Second,
		ObjectStore:          "mock",
		MediaURLTTL:          2 * time.Hour,
		LabTokens:            []string{"test-lab-token"},
		PaymentCallbackKey:   "test-payment-callback-secret",
		AadhaarMockKey:       "test-aadhaar-mock-key",
		SessionTTL:           180 * 24 * time.Hour,
		MagicLinkTTL:         15 * time.Minute,
		JobRunner:            "inline",
		RenderAPIBase:        "https://api.render.com",
		RenderWorkflowSlug:   "mg-workflows",
		TracesExporter:       "none",
		SMTPFrom:             "Margdarshak <no-reply@margdarshak.example>",
	}
	sum := sha256.Sum256([]byte("test-pepper"))
	c.BlindIndexPepper = base64.StdEncoding.EncodeToString(sum[:])
	return c
}
