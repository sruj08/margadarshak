// Package app is the composition root: it wires config, store, adapters, services and the HTTP
// handler. cmd/api (serve, migrate, healthcheck, worker), cmd/seed and the integration tests
// all build the API through here, so tests exercise the production wiring.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/adapters"
	adnotify "github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
	"github.com/sruj08/margadarshak/services/api/internal/analytics"
	"github.com/sruj08/margadarshak/services/api/internal/cases"
	clocksvc "github.com/sruj08/margadarshak/services/api/internal/clock"
	"github.com/sruj08/margadarshak/services/api/internal/dsr"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi"
	"github.com/sruj08/margadarshak/services/api/internal/jobs"
	"github.com/sruj08/margadarshak/services/api/internal/lab"
	"github.com/sruj08/margadarshak/services/api/internal/notify"
	"github.com/sruj08/margadarshak/services/api/internal/plans"
	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/platform/ratelimit"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/rulekit"
	"github.com/sruj08/margadarshak/services/api/internal/rules"
	"github.com/sruj08/margadarshak/services/api/internal/seed"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/tenant"
)

// App holds the wired services.
type App struct {
	Config    *config.Config
	Log       *slog.Logger
	DB        *store.DB
	Clock     servertime.Clock
	Vault     *privacy.Vault
	Registry  *adapters.Registry
	Tenants   *tenant.Service
	Accounts  *accounts.Service
	Jobs      *jobs.Service
	Notify    *notify.Service
	Rules     *rules.Library
	Plans     *plans.Service
	Cases     *cases.Service
	ClockSvc  *clocksvc.Service
	N8n       *adnotify.N8n
	DSR       *dsr.Service
	Analytics *analytics.Service
	Lab       *lab.Service
	P2        *P2
	Handler   http.Handler
	redis     *ratelimit.Redis
}

// Options override parts of the wiring (tests).
type Options struct {
	Clock  servertime.Clock
	Runner ports.JobRunner
	Rules  ports.RulesPort
	// Email overrides the e-mail sender (tests capture magic links here).
	Email ports.NotificationPort
	// Compute replaces the score verifier client (tests: a fake /verify and compute routes).
	Compute ComputeService
	// ObjectStore replaces the clip media store (tests: a mock store in a temp dir).
	ObjectStore ports.ObjectStore
	// AI replaces the Google ADK agents (tests: agents over a scripted model).
	AI *AIAgents
}

// New wires the API on an open database.
func New(cfg *config.Config, db *store.DB, log *slog.Logger, opt Options) (*App, error) {
	clock := opt.Clock
	if clock == nil {
		clock = servertime.System{}
		if cfg.DevClockOffset != 0 {
			clock = servertime.Offset{By: cfg.DevClockOffset}
		}
	}
	kek, err := config.Key32(cfg.KEK)
	if err != nil {
		return nil, err
	}
	vault, err := privacy.NewVault(kek, config.Bytes(cfg.BlindIndexPepper))
	if err != nil {
		return nil, err
	}
	a := &App{Config: cfg, Log: log, DB: db, Clock: clock, Vault: vault}

	var limiter ratelimit.Limiter = ratelimit.NewMemory()
	var replay hmacsig.ReplayCache = store.ReplayCache{DB: db}
	pings := map[string]func(context.Context) error{}
	if cfg.RedisURL != "" {
		rd, err := ratelimit.NewRedis(cfg.RedisURL)
		if err != nil {
			return nil, fmt.Errorf("app: REDIS_URL: %w", err)
		}
		a.redis, limiter, replay = rd, rd, rd
		pings["key_value"] = rd.Ping
	}

	email := opt.Email
	if email == nil {
		if cfg.SMTPHost != "" {
			email = &adnotify.SMTP{Host: cfg.SMTPHost, Port: cfg.SMTPPort, User: cfg.SMTPUser, Pass: cfg.SMTPPass, From: cfg.SMTPFrom}
		} else {
			email = adnotify.Console{Log: log}
		}
	}
	a.Registry = adapters.NewRegistry(adapters.Deps{
		Now: clock.Now, PublicBaseURL: cfg.PublicBaseURL, PaymentSecret: []byte(cfg.PaymentCallbackKey), AadhaarKey: []byte(cfg.AadhaarMockKey),
		Replay: replay, Log: log, Email: email, SlotSeed: 2026, Overrides: cfg.AdapterOverrides(),
	})
	if opt.Email != nil {
		// Tests: every tenant's e-mail channel goes to the capture sender.
		for _, impl := range []string{"console", "n8n"} {
			if v, err := a.Registry.Get(adapters.PortNotification, impl); err == nil {
				if r, ok := v.(*adnotify.Router); ok {
					r.ByChannel["email"] = opt.Email
				}
			}
		}
	}
	a.Tenants = &tenant.Service{DB: db, Registry: a.Registry, Rules: opt.Rules, Default: cfg.DefaultTenant}
	a.Notify = &notify.Service{DB: db, Log: log}

	var google accounts.GoogleVerifier = accounts.UnconfiguredGoogle{}
	if !cfg.IsProduction() {
		google = accounts.StubGoogle{}
	}
	a.Accounts = &accounts.Service{DB: db, Vault: vault, Clock: clock, Notify: a.Notify, Log: log, Limiter: limiter, Google: google,
		SessionSecret: []byte(cfg.SessionSecret), SessionTTL: cfg.SessionTTL, MagicTTL: cfg.MagicLinkTTL, WebBaseURL: cfg.WebBaseURL}
	if err := a.Accounts.Init(); err != nil {
		return nil, err
	}

	// P1 journey services (BE-journey).
	rp := opt.Rules
	if rp == nil {
		if loaded, _, err := LoadRules(cfg.RulepackDir); err == nil {
			rp = loaded
			a.Tenants.Rules = loaded
		} else {
			log.Warn("rule packs not loaded; plan and case endpoints answer 503", "err", err)
		}
	}
	lib := RulesLibrary(rp)
	a.Rules = lib
	a.Plans = &plans.Service{DB: db, Vault: vault, Clock: clock, Rules: lib, Log: log}
	a.Cases = &cases.Service{DB: db, Vault: vault, Clock: clock, Rules: lib, Plans: a.Plans, Log: log, WebBaseURL: cfg.WebBaseURL, PublicBaseURL: cfg.PublicBaseURL}
	envelopeSecret := cfg.N8NHMACSecret
	if envelopeSecret == "" {
		envelopeSecret = cfg.InternalHMACSecret
	}
	a.N8n = &adnotify.N8n{BaseURL: cfg.N8NBaseURL, Path: cfg.N8NWebhookPath, Token: cfg.N8NWebhookToken, Secret: []byte(envelopeSecret), Now: clock.Now, Log: log}
	a.ClockSvc = &clocksvc.Service{DB: db, Vault: vault, Clock: clock, Cases: a.Cases, Accounts: a.Accounts, N8n: a.N8n, Email: email,
		WebPush: adnotify.Pending{Provider: "webpush"}, Log: log, WebBaseURL: cfg.WebBaseURL}
	a.Cases.OnEvent = a.ClockSvc.OnCaseEvent
	a.DSR = &dsr.Service{DB: db, Vault: vault, Clock: clock, Log: log}
	a.Analytics = &analytics.Service{DB: db, Vault: vault, Clock: clock}
	a.Lab = &lab.Service{DB: db, Clock: clock}

	// P2: compute, object storage, games, learn, gamify, clips, study (plan §2.1).
	if a.P2, err = a.wireP2(cfg, opt); err != nil {
		return nil, err
	}
	if a.P2.StudyStore != nil {
		a.Lab.Study = a.P2.StudyStore
	}

	steps := jobs.Steps(db, clock.Now, map[string]jobs.StepFunc{
		"clock.plan_pages": a.ClockSvc.PlanPages,
		"clock.fire_batch": func(ctx context.Context, args map[string]any) (map[string]any, error) {
			res, err := a.ClockSvc.FireBatch(ctx, args)
			if err != nil {
				return res.Map(), err
			}
			return res.Map(), nil
		},
		"retention.sweep": func(ctx context.Context, _ map[string]any) (map[string]any, error) {
			counts, err := a.DSR.Retention(ctx, clock.Now())
			out := map[string]any{}
			for k, v := range counts {
				out[k] = v
			}
			return out, err
		},
	})
	for k, f := range a.P2.p2Steps() {
		steps[k] = f
	}
	runner := opt.Runner
	if runner == nil {
		extra := map[string]jobs.TaskFunc{
			"case_clock_sweep": jobs.TaskFromStep(a.ClockSvc.Sweep),
			"retention_sweep":  jobs.TaskFromStep(steps["retention.sweep"]),
		}
		for k, t := range p2Tasks(steps) {
			extra[k] = t
		}
		tasks := jobs.Tasks(extra)
		runner, err = NewRunner(cfg, tasks)
		if err != nil {
			return nil, err
		}
	}
	a.Jobs = &jobs.Service{DB: db, Runner: runner, Log: log, Steps: steps}

	if cfg.ScoreVerifierHP != "" {
		hp := cfg.ScoreVerifierHP
		pings["score_verifier"] = func(ctx context.Context) error { return httpPing(ctx, "http://"+hp+"/healthz") }
	}
	agents := opt.AI
	if agents == nil {
		built := newAIAgents(context.Background(), cfg, log, ContentDir(cfg.ContentDir))
		agents = &built
	}
	a.Handler = httpapi.New(httpapi.Deps{
		Log: log, DB: db, Clock: clock, Tenants: a.Tenants, Accounts: a.Accounts, Jobs: a.Jobs, Notify: a.Notify, Registry: a.Registry,
		Vault: vault, Limiter: limiter,
		InternalHMAC:   &hmacsig.Verifier{Secret: []byte(cfg.InternalHMACSecret), Window: 5 * time.Minute, Replay: replay, Now: clock.Now},
		InternalTokens: cfg.InternalBearerTokens, CORSOrigins: cfg.CORSOrigins, PublicBaseURL: cfg.PublicBaseURL, WebBaseURL: cfg.WebBaseURL,
		CookieSecure: cfg.CookieSecure, Version: cfg.Version, Commit: cfg.Commit, Ping: pings,
		DeviceSessionRateLimit: cfg.DevDeviceSessionRateLimit,
		Plans:                  a.Plans, Cases: a.Cases, CaseClock: a.ClockSvc, DSR: a.DSR, Analytics: a.Analytics, Lab: a.Lab, LabTokens: cfg.LabTokens,
		DemoPersonas: cfg.DemoAllowed(), TestNumber: !cfg.IsProduction(), Seed: a.SeedDeps(),
		Games: a.P2.Games, Learn: a.P2.Learn, Gamify: a.P2.Gamify, Clips: a.P2.Clips, Study: a.P2.Study,
		StudyStore: a.P2.StudyStore, Staircase: a.P2.Staircase, MockMedia: a.P2.MockMedia, ObjectStore: a.P2.ObjectStore,
		WebBaseURLShare: cfg.WebBaseURL, N8NResumeToken: cfg.N8NResumeAuthToken,
		Scam: agents.Scam, Debrief: agents.Debrief, Tutor: agents.Tutor, Decoder: agents.Decoder,
	})
	return a, nil
}

// SeedDeps returns the seed dependencies wired to the journey services (cmd/seed, persona switcher).
func (a *App) SeedDeps() seed.Deps {
	d := seed.Deps{DB: a.DB, Vault: a.Vault, Now: a.Clock.Now()}
	if a.Rules != nil {
		lib := a.Rules
		d.FeeTotal = func(state string, classes []string) (int64, error) {
			c, ok := lib.Pack(state)
			if !ok {
				return 0, fmt.Errorf("rules: no pack for %s", state)
			}
			return c.FeeQuote(classes).TotalPaise, nil
		}
		d.LLDates = func(state string, issued time.Time) (time.Time, time.Time) {
			c, ok := lib.Pack(state)
			if !ok {
				return issued.AddDate(0, 0, 30), issued.AddDate(0, 6, 0)
			}
			p := rulekit.ParamsOf(c)
			return issued.AddDate(0, 0, p.MinWaitDays), issued.AddDate(0, p.LLValidityMonths, 0)
		}
	}
	if a.Cases != nil {
		d.AfterCase = a.Cases.Rebuild
	}
	return d
}

// NewRunner picks the JobRunner from JOB_RUNNER (inline | render_workflows | temporal).
func NewRunner(cfg *config.Config, tasks map[string]jobs.TaskFunc) (ports.JobRunner, error) {
	switch cfg.JobRunner {
	case "", "inline":
		return jobs.NewInline(tasks, ports.DefaultRetry), nil
	case "render_workflows":
		base := cfg.RenderAPIBase
		if cfg.RenderUseLocalDev {
			base = cfg.RenderLocalDevURL
		}
		if cfg.RenderAPIKey == "" && !cfg.RenderUseLocalDev {
			return nil, fmt.Errorf("app: JOB_RUNNER=render_workflows needs RENDER_API_KEY")
		}
		return &jobs.RenderWorkflows{BaseURL: base, APIKey: cfg.RenderAPIKey, Slug: cfg.RenderWorkflowSlug}, nil
	case "temporal":
		return nil, fmt.Errorf("app: JOB_RUNNER=temporal is the production design (INFRASTRUCTURE §4.5) and is not built in this phase")
	default:
		return nil, fmt.Errorf("app: unknown JOB_RUNNER %q", cfg.JobRunner)
	}
}

// Close releases resources.
func (a *App) Close() {
	if a.redis != nil {
		_ = a.redis.Client.Close()
	}
}

func httpPing(ctx context.Context, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	_ = resp.Body.Close()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}

// DescribeAdapters is a one-line summary for start-up logs.
func (a *App) DescribeAdapters(ctx context.Context) string {
	t, err := a.Tenants.Get(ctx, a.Config.DefaultTenant)
	if err != nil {
		return "tenant " + a.Config.DefaultTenant + " not loaded: " + err.Error()
	}
	var parts []string
	for _, p := range []string{"sarathi", "digilocker", "aadhaar_offline", "bhashini", "payment", "notification", "slot"} {
		parts = append(parts, p+"="+t.Adapters.Modes[p])
	}
	return strings.Join(parts, " ")
}
