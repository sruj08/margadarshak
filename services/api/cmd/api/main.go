// Command api is the Margdarshak Go API.
//
//	api serve                  run the HTTP API (default)
//	api migrate up|down|status run the embedded goose migrations
//	api healthcheck            GET http://$API_INTERNAL_HOSTPORT/v1/health, exit 0/1 (distroless HEALTHCHECK)
//	api worker                 production JobRunner worker (Temporal; design only, not built)
//	api version                print the build version
//
// Build: go build -tags timetzdata -ldflags "-X main.version=<sha>" ./cmd/api
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/app"
	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
	"github.com/sruj08/margadarshak/services/api/internal/platform/telemetry"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/store/pgembed"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve()
	case "migrate":
		dir := "up"
		if len(os.Args) > 2 {
			dir = os.Args[2]
		}
		err = migrate(dir)
	case "healthcheck":
		err = healthcheck()
	case "worker":
		fmt.Fprintln(os.Stderr, "api worker: the production JobRunner worker (Temporal) is design-only in this phase (INFRASTRUCTURE.md §4.5); use JOB_RUNNER=inline or render_workflows")
		os.Exit(3)
	case "version":
		fmt.Println(version)
	default:
		fmt.Fprintf(os.Stderr, "usage: api [serve|migrate up|down|status|healthcheck|worker|version]\nunknown command %q\n", cmd)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "api:", err)
		os.Exit(1)
	}
}

func load() (*config.Config, *slog.Logger, error) {
	cfg, warnings, err := config.Load()
	if err != nil {
		return nil, nil, err
	}
	if cfg.Version == "" {
		cfg.Version = version
	}
	if cfg.Commit == "dev" && version != "dev" {
		cfg.Commit = version
	}
	newLog := logging.New
	if cfg.Env == "dev" || cfg.Env == "test" {
		// The magic link in the console notifier stays readable (DevValue); never in production.
		newLog = logging.NewDev
	}
	log := newLog(os.Stdout, cfg.LogLevel, slog.String("service", "margdarshak-api"), slog.String("env", cfg.Env), slog.String("version", cfg.Version))
	for _, w := range warnings {
		log.Warn(w)
	}
	return cfg, log, nil
}

// database returns a DSN, starting embedded PostgreSQL 16 when DEV_EMBEDDED_PG=true (dev only).
func database(cfg *config.Config, log *slog.Logger) (string, func(), error) {
	if cfg.DatabaseURL != "" {
		return cfg.DatabaseURL, func() {}, nil
	}
	if !cfg.EmbeddedPostgres {
		return "", nil, errors.New("DATABASE_URL is not set (or set DEV_EMBEDDED_PG=true for a local embedded PostgreSQL)")
	}
	if cfg.IsProduction() {
		return "", nil, errors.New("DEV_EMBEDDED_PG is for local development only")
	}
	root := pgembed.ModuleRoot()
	abs := func(p string) string {
		if filepath.IsAbs(p) {
			return p
		}
		return filepath.Join(root, p)
	}
	inst, err := pgembed.Start(pgembed.Options{Port: cfg.EmbeddedPGPort, DataDir: abs(cfg.EmbeddedPGDataDir), WorkDir: abs(filepath.Join(cfg.CacheDir, "pgwork")),
		CacheDir: pgembed.DefaultCacheDir()})
	if err != nil {
		return "", nil, err
	}
	log.Info("embedded PostgreSQL 16 started (dev only)", "port", inst.Port)
	return inst.DSN, func() { _ = inst.Stop() }, nil
}

func serve() error {
	cfg, log, err := load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownOTel, err := telemetry.Setup(ctx, "margdarshak-api", cfg.Version, cfg.TracesExporter)
	if err != nil {
		return err
	}
	dsn, stopPG, err := database(cfg, log)
	if err != nil {
		return err
	}
	defer stopPG()
	if cfg.MigrateOnStart || cfg.EmbeddedPostgres {
		if _, err := store.Migrate(ctx, dsn, "up"); err != nil {
			return err
		}
		log.Info("migrations applied")
	}
	db, err := store.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer db.Close()

	opts := app.Options{}
	if rp, dir, err := app.LoadRules(cfg.RulepackDir); err == nil {
		opts.Rules = rp
		log.Info("rule packs loaded", "dir", dir)
	} else {
		log.Warn("rule packs not loaded; tenant rule-pack columns are used", "err", err)
	}
	a, err := app.New(cfg, db, log, opts)
	if err != nil {
		return err
	}
	defer a.Close()
	log.Info("adapters", "tenant", cfg.DefaultTenant, "modes", a.DescribeAdapters(ctx), "job_runner", a.Jobs.Runner.Name())

	srv := &http.Server{Addr: cfg.Addr, Handler: a.Handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		WriteTimeout: 60 * time.Second, IdleTimeout: 120 * time.Second, MaxHeaderBytes: 32 << 10}
	if cfg.DebugPprof && !cfg.IsProduction() {
		go servePprof(log)
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
		close(errc)
	}()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down (draining up to 25 s)")
	sctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		log.Warn("shutdown", "err", err)
	}
	_ = shutdownOTel(sctx)
	return nil
}

func servePprof(log *slog.Logger) {
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/heap", pprof.Handler("heap").ServeHTTP)
	log.Info("pprof on 127.0.0.1:6060 (DEBUG_PPROF)")
	_ = (&http.Server{Addr: "127.0.0.1:6060", Handler: mux, ReadHeaderTimeout: 5 * time.Second}).ListenAndServe()
}

func migrate(dir string) error {
	cfg, log, err := load()
	if err != nil {
		return err
	}
	dsn, stopPG, err := database(cfg, log)
	if err != nil {
		return err
	}
	defer stopPG()
	out, err := store.Migrate(context.Background(), dsn, dir)
	if err != nil {
		return err
	}
	if out != "" {
		fmt.Print(out)
	}
	log.Info("migrate done", "direction", dir)
	return nil
}

func healthcheck() error {
	hp := os.Getenv("API_INTERNAL_HOSTPORT")
	if hp == "" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8000"
		}
		hp = net.JoinHostPort("127.0.0.1", port)
	}
	c := &http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://" + hp + "/v1/health")
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health status %d", resp.StatusCode)
	}
	return nil
}
