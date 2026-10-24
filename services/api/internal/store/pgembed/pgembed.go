// Package pgembed starts a real PostgreSQL 16 without Docker (fergusstrange/embedded-postgres),
// for tests and for `DEV_EMBEDDED_PG=true` local runs (BUILD_CONVENTIONS §2: Docker is not
// available on the team's Windows machines). Binaries are downloaded once into a cache directory.
package pgembed

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
)

// Options configures an instance.
type Options struct {
	// Port to listen on; 0 picks a free port.
	Port uint32
	// DataDir holds the cluster. Reused across runs when it already contains a PG 16 cluster.
	DataDir string
	// WorkDir holds extracted binaries and the runtime directory (per instance).
	WorkDir string
	// CacheDir holds the downloaded binary archive (shared, may be cached in CI).
	CacheDir string
	// Logger receives PostgreSQL output; nil discards it.
	Logger io.Writer
}

// Instance is a running PostgreSQL.
type Instance struct {
	pg   *embeddedpostgres.EmbeddedPostgres
	Port uint32
	// DSN connects to the "postgres" database as the superuser "postgres".
	DSN string
}

// Start launches PostgreSQL 16. Starts are serialised across processes with a lock file in
// CacheDir, because parallel `go test` packages would otherwise race on the first download.
func Start(o Options) (*Instance, error) {
	if o.Port == 0 {
		p, err := freePort()
		if err != nil {
			return nil, err
		}
		o.Port = p
	}
	if o.Logger == nil {
		o.Logger = io.Discard
	}
	for _, d := range []string{o.CacheDir, o.WorkDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, fmt.Errorf("pgembed: %w", err)
		}
	}
	unlock, err := lock(filepath.Join(o.CacheDir, ".pgembed.lock"))
	if err != nil {
		return nil, err
	}
	defer unlock()

	cfg := embeddedpostgres.DefaultConfig().
		Version(embeddedpostgres.V16).
		Port(o.Port).
		Username("postgres").
		Password("postgres").
		Database("postgres").
		Locale("C").
		Encoding("UTF8").
		CachePath(o.CacheDir).
		BinariesPath(filepath.Join(o.WorkDir, "bin")).
		RuntimePath(filepath.Join(o.WorkDir, "run")).
		DataPath(o.DataDir).
		StartTimeout(120 * time.Second).
		Logger(o.Logger)
	pg := embeddedpostgres.NewDatabase(cfg)
	if err := pg.Start(); err != nil {
		return nil, fmt.Errorf("pgembed: start: %w", err)
	}
	return &Instance{
		pg:   pg,
		Port: o.Port,
		DSN:  fmt.Sprintf("postgres://postgres:postgres@127.0.0.1:%d/postgres?sslmode=disable", o.Port),
	}, nil
}

// Stop shuts PostgreSQL down.
func (i *Instance) Stop() error {
	if i == nil || i.pg == nil {
		return nil
	}
	return i.pg.Stop()
}

// DSNFor returns a DSN for another database on the same instance.
func (i *Instance) DSNFor(db string) string {
	return fmt.Sprintf("postgres://postgres:postgres@127.0.0.1:%d/%s?sslmode=disable", i.Port, db)
}

func freePort() (uint32, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("pgembed: free port: %w", err)
	}
	defer func() { _ = l.Close() }()
	return uint32(l.Addr().(*net.TCPAddr).Port), nil
}

func lock(path string) (func(), error) {
	deadline := time.Now().Add(5 * time.Minute)
	for {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			_ = f.Close()
			return func() { _ = os.Remove(path) }, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return nil, fmt.Errorf("pgembed: lock: %w", err)
		}
		if st, serr := os.Stat(path); serr == nil && time.Since(st.ModTime()) > 5*time.Minute {
			_ = os.Remove(path) // stale lock from a killed process
			continue
		}
		if time.Now().After(deadline) {
			return nil, errors.New("pgembed: timed out waiting for the start lock")
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// ModuleRoot walks up from the working directory to the directory holding go.mod.
func ModuleRoot() string {
	dir, err := os.Getwd()
	if err != nil {
		return "."
	}
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, "go.mod")); err == nil {
			return d
		}
		if filepath.Dir(d) == d {
			return dir
		}
	}
}

// DefaultCacheDir is services/api/.cache/embedded-postgres (gitignored), or
// EMBEDDED_PG_CACHE when set (CI caches ~/.embedded-postgres-go).
func DefaultCacheDir() string {
	if v := os.Getenv("EMBEDDED_PG_CACHE"); v != "" {
		return v
	}
	if os.Getenv("CI") != "" {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, ".embedded-postgres-go")
		}
	}
	return filepath.Join(ModuleRoot(), ".cache", "embedded-postgres")
}
