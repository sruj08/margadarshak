// Command seed loads the synthetic personas (MD-054): Kabir (P-01), Tanvi (P-02), Mohan-ji
// (P-03, family mode), Rahul via a parent's account (P-07) and a cyber-cafe helper (P-04).
// It also publishes the labelled sample Nazar clips (seed.SampleClips: the game-core fixture bank
// as ai_generated samples with placeholder media), so a Nazar mock works on a fresh database.
// Idempotent: running it twice changes nothing.
//
//	seed [--profile demo] [--synthetic] [--tenant JK] [--kabir-day 12|31] [--migrate=true] [--clips=true]
//
// Uses DATABASE_URL, or DEV_EMBEDDED_PG=true for the local embedded PostgreSQL.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/sruj08/margadarshak/services/api/internal/app"
	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/seed"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/store/pgembed"
)

var version = "dev"

func main() {
	profile := flag.String("profile", "demo", "seed profile (demo)")
	synthetic := flag.Bool("synthetic", true, "synthetic data only (always true; flag kept for CI compatibility)")
	tenant := flag.String("tenant", "", "tenant code (default TENANT_DEFAULT)")
	kabirDay := flag.Int("kabir-day", 12, "Kabir's LL day: 12 (bridge) or 31 (DL test bookable)")
	doMigrate := flag.Bool("migrate", true, "apply migrations first")
	sampleClips := flag.Bool("clips", true, "publish the labelled sample Nazar clips (game-core fixture bank, placeholder media)")
	flag.Parse()
	if err := run(*profile, *synthetic, *tenant, *kabirDay, *doMigrate, *sampleClips); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		os.Exit(1)
	}
}

func run(profile string, synthetic bool, tenant string, kabirDay int, doMigrate, sampleClips bool) error {
	if profile != "demo" || !synthetic {
		return fmt.Errorf("only --profile demo --synthetic is supported (no real data, ever)")
	}
	if kabirDay != 12 && kabirDay != 31 {
		return fmt.Errorf("--kabir-day must be 12 or 31")
	}
	cfg, warnings, err := config.Load()
	if err != nil {
		return err
	}
	log := logging.New(os.Stdout, cfg.LogLevel, slog.String("service", "margdarshak-seed"), slog.String("version", version))
	for _, w := range warnings {
		log.Warn(w)
	}
	if tenant == "" {
		tenant = cfg.DefaultTenant
	}
	ctx := context.Background()
	dsn := cfg.DatabaseURL
	if dsn == "" {
		if !cfg.EmbeddedPostgres {
			return fmt.Errorf("DATABASE_URL is not set (or DEV_EMBEDDED_PG=true)")
		}
		root := pgembed.ModuleRoot()
		inst, err := pgembed.Start(pgembed.Options{Port: cfg.EmbeddedPGPort, DataDir: filepath.Join(root, cfg.EmbeddedPGDataDir),
			WorkDir: filepath.Join(root, cfg.CacheDir, "pgwork"), CacheDir: pgembed.DefaultCacheDir()})
		if err != nil {
			return err
		}
		defer func() { _ = inst.Stop() }()
		dsn = inst.DSN
	}
	if doMigrate {
		if _, err := store.Migrate(ctx, dsn, "up"); err != nil {
			return err
		}
	}
	db, err := store.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	// The seed goes through the composition root so seeded cases are settled by the journey
	// service (catch-up, fee quote, timeline) exactly like live ones.
	a, err := app.New(cfg, db, log, app.Options{})
	if err != nil {
		return err
	}
	defer a.Close()
	deps := a.SeedDeps()
	deps.Now = servertime.System{}.Now()
	if a.Rules == nil {
		log.Warn("rule packs not loaded; the demo payment intent is skipped")
	}
	rep, err := seed.Run(ctx, deps, tenant, kabirDay)
	if err != nil {
		return err
	}
	log.Info("seed done", "tenant", tenant, "created", rep.Created, "existing", rep.Existing)
	if sampleClips {
		var objects seed.ClipObjects
		if a.P2 != nil && a.P2.ObjectStore != nil {
			objects = a.P2.ObjectStore
		} else {
			log.Warn("no object store; sample clips are seeded without media")
		}
		crep, err := seed.SampleClips(ctx, seed.ClipDeps{DB: a.DB, Objects: objects, Now: deps.Now})
		if err != nil {
			return err
		}
		log.Info("sample clips seeded (labelled samples, placeholder media)", "created", crep.Created, "existing", crep.Existing)
	}
	for _, p := range rep.Personas {
		fmt.Println(p)
	}
	return nil
}
