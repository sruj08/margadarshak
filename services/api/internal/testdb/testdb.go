// Package testdb gives tests a real PostgreSQL 16 (embedded-postgres, no Docker). One instance
// is started lazily per test binary; every test gets its own database cloned from a migrated
// template, so tests are isolated and fast. Tests are skipped under `go test -short`.
//
// Usage:
//
//	func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }
//	func TestX(t *testing.T) { db := testdb.Open(t) ... }
package testdb

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/store/pgembed"
)

var (
	once      sync.Once
	inst      *pgembed.Instance
	startErr  error
	workDir   string
	tmplOnce  sync.Once
	tmplErr   error
	dbCounter atomic.Int64
)

const templateDB = "md_template"

// Main runs the tests and stops the embedded instance afterwards.
func Main(m *testing.M) int {
	if !flag.Parsed() {
		flag.Parse()
	}
	code := m.Run()
	if inst != nil {
		_ = inst.Stop()
	}
	if workDir != "" {
		_ = os.RemoveAll(workDir)
	}
	return code
}

func instance(t testing.TB) *pgembed.Instance {
	t.Helper()
	if testing.Short() {
		t.Skip("embedded Postgres integration test: skipped with -short")
	}
	once.Do(func() {
		// Work directories live under services/api/.cache (gitignored), not the system temp dir.
		base := filepath.Join(pgembed.ModuleRoot(), ".cache", "tmp")
		if startErr = os.MkdirAll(base, 0o755); startErr != nil {
			return
		}
		workDir, startErr = os.MkdirTemp(base, "md-pg-")
		if startErr != nil {
			return
		}
		inst, startErr = pgembed.Start(pgembed.Options{
			DataDir:  filepath.Join(workDir, "data"),
			WorkDir:  workDir,
			CacheDir: pgembed.DefaultCacheDir(),
		})
	})
	if startErr != nil {
		t.Fatalf("embedded postgres: %v", startErr)
	}
	return inst
}

// Empty returns the DSN of a new, empty database (no migrations), dropped after the test.
func Empty(t testing.TB) string {
	t.Helper()
	in := instance(t)
	name := fmt.Sprintf("md_t%d_%d", os.Getpid(), dbCounter.Add(1))
	exec(t, in.DSN, "CREATE DATABASE "+name)
	t.Cleanup(func() { drop(in, name) })
	return in.DSNFor(name)
}

// DSN returns the DSN of a fresh, fully migrated database, dropped after the test.
func DSN(t testing.TB) string {
	t.Helper()
	in := instance(t)
	tmplOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		conn, err := pgx.Connect(ctx, in.DSN)
		if err != nil {
			tmplErr = err
			return
		}
		_, tmplErr = conn.Exec(ctx, "CREATE DATABASE "+templateDB)
		_ = conn.Close(ctx)
		if tmplErr != nil {
			return
		}
		_, tmplErr = store.Migrate(ctx, in.DSNFor(templateDB), "up")
	})
	if tmplErr != nil {
		t.Fatalf("migrate template: %v", tmplErr)
	}
	name := fmt.Sprintf("md_t%d_%d", os.Getpid(), dbCounter.Add(1))
	exec(t, in.DSN, "CREATE DATABASE "+name+" TEMPLATE "+templateDB)
	t.Cleanup(func() { drop(in, name) })
	return in.DSNFor(name)
}

// Open returns a pool on a fresh migrated database.
func Open(t testing.TB) *store.DB {
	t.Helper()
	dsn := DSN(t)
	db, err := store.Open(context.Background(), dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func exec(t testing.TB, dsn, sql string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer func() { _ = conn.Close(ctx) }()
	if _, err := conn.Exec(ctx, sql); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func drop(in *pgembed.Instance, name string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, in.DSN)
	if err != nil {
		return
	}
	defer func() { _ = conn.Close(ctx) }()
	_, _ = conn.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
}
