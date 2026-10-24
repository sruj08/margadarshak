// Package store is the PostgreSQL adapter: a pgx v5 pool, embedded goose migrations and
// tenant-scoped transactions. Every request transaction runs as the RLS-bound role mg_app with
// app.tenant_id set (SET LOCAL), so a query can only see its own tenant's rows even if a
// repository forgot a WHERE clause (repository-layer test: store_test.go). Cross-tenant jobs and
// seeds run as mg_jobs through System.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/sruj08/margadarshak/services/api/migrations"
)

// ErrNotFound is returned when a row does not exist or is not visible to the tenant.
var ErrNotFound = errors.New("store: not found")

// ErrConflict is returned on a unique-constraint violation.
var ErrConflict = errors.New("store: conflict")

// DB wraps the pgx pool.
type DB struct {
	Pool *pgxpool.Pool
}

// Open connects to dsn and pings it.
func Open(ctx context.Context, dsn string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("store: parse dsn: %w", err)
	}
	cfg.MaxConns = 16
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	cfg.ConnConfig.RuntimeParams["application_name"] = "margdarshak-api"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	return &DB{Pool: pool}, nil
}

// Close closes the pool.
func (d *DB) Close() { d.Pool.Close() }

// Ping checks connectivity and returns the round-trip time.
func (d *DB) Ping(ctx context.Context) (time.Duration, error) {
	start := time.Now()
	err := d.Pool.Ping(ctx)
	return time.Since(start), err
}

var tenantRe = regexp.MustCompile(`^[A-Z]{2}$`)

// Tenant runs fn in a transaction bound to tenant under RLS (role mg_app).
func (d *DB) Tenant(ctx context.Context, tenant string, fn func(tx pgx.Tx) error) error {
	if !tenantRe.MatchString(tenant) {
		return fmt.Errorf("store: invalid tenant %q", tenant)
	}
	return d.inTx(ctx, "mg_app", tenant, fn)
}

// System runs fn as mg_jobs (cross-tenant; callers audit what they do).
func (d *DB) System(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return d.inTx(ctx, "mg_jobs", "", fn)
}

func (d *DB) inTx(ctx context.Context, role, tenant string, fn func(tx pgx.Tx) error) error {
	tx, err := d.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("store: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	// Role names are constants; the tenant goes through set_config with a bound parameter.
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE "+role); err != nil {
		return fmt.Errorf("store: set role: %w", err)
	}
	if _, err := tx.Exec(ctx, "SELECT set_config('app.tenant_id', $1, true), set_config('statement_timeout', '5s', true)", tenant); err != nil {
		return fmt.Errorf("store: set tenant: %w", err)
	}
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("store: commit: %w", mapErr(err))
	}
	return nil
}

// mapErr translates Postgres errors into store errors.
func mapErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		return fmt.Errorf("%w: %s", ErrConflict, pg.ConstraintName)
	}
	return err
}

// IsCode reports whether err is a Postgres error with the given SQLSTATE.
func IsCode(err error, code string) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == code
}

// Migrate runs goose migrations: "up", "down" (one step), "reset" or "status".
// It returns a human-readable status listing for "status".
func Migrate(ctx context.Context, dsn, direction string) (string, error) {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return "", fmt.Errorf("store: parse dsn: %w", err)
	}
	db := stdlib.OpenDB(*cfg)
	defer func() { _ = db.Close() }()
	return migrateDB(ctx, db, direction)
}

func migrateDB(ctx context.Context, db *sql.DB, direction string) (string, error) {
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		return "", fmt.Errorf("store: goose: %w", err)
	}
	switch direction {
	case "up":
		_, err = p.Up(ctx)
	case "down":
		_, err = p.Down(ctx)
	case "reset":
		_, err = p.DownTo(ctx, 0)
	case "status":
		res, serr := p.Status(ctx)
		if serr != nil {
			return "", serr
		}
		out := ""
		for _, r := range res {
			applied := "pending"
			if r.State == goose.StateApplied {
				applied = "applied " + r.AppliedAt.UTC().Format(time.RFC3339)
			}
			out += fmt.Sprintf("%05d %-40s %s\n", r.Source.Version, r.Source.Path, applied)
		}
		return out, nil
	default:
		return "", fmt.Errorf("store: unknown migrate direction %q (up|down|reset|status)", direction)
	}
	if err != nil {
		return "", fmt.Errorf("store: migrate %s: %w", direction, err)
	}
	return "", nil
}

type txKey struct{}

// ContextWithTx carries an open transaction in ctx, so a domain package called from inside
// another package's transaction (a games award or study hook) writes in that same transaction.
func ContextWithTx(ctx context.Context, tx pgx.Tx) context.Context {
	if tx == nil {
		return ctx
	}
	return context.WithValue(ctx, txKey{}, tx)
}

// TxFrom returns the transaction carried by ctx, if any.
func TxFrom(ctx context.Context) (pgx.Tx, bool) {
	tx, ok := ctx.Value(txKey{}).(pgx.Tx)
	return tx, ok && tx != nil
}

// InTenant runs fn in the transaction carried by ctx (ContextWithTx) when there is one,
// otherwise in a new Tenant transaction.
func (d *DB) InTenant(ctx context.Context, tenant string, fn func(tx pgx.Tx) error) error {
	if tx, ok := TxFrom(ctx); ok {
		return fn(tx)
	}
	return d.Tenant(ctx, tenant, fn)
}

// InSystem runs fn in the transaction carried by ctx when there is one, otherwise in a new
// System transaction.
func (d *DB) InSystem(ctx context.Context, fn func(tx pgx.Tx) error) error {
	if tx, ok := TxFrom(ctx); ok {
		return fn(tx)
	}
	return d.System(ctx, fn)
}
