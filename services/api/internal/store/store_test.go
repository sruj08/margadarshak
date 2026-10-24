package store_test

import (
	"bytes"
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/audit"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/testdb"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

func addTenantKL(t *testing.T, db *store.DB) {
	t.Helper()
	require.NoError(t, db.System(context.Background(), func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(), `INSERT INTO core.tenants (tenant_id, display_name, display_name_key, languages, rule_pack_id, rule_pack_version)
			VALUES ('KL', '{"en":"Kerala"}', 'tenant.kl', ARRAY['en','ml'], 'KL', '2026.10.0')`)
		return err
	}))
}

// MD-056: every query filters by tenant, enforced by Postgres RLS under the app role.
func TestRLSTenantIsolation(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	addTenantKL(t, db)
	jk := &store.Applicant{ID: ids.New(), TenantID: "JK", Kind: "device"}
	kl := &store.Applicant{ID: ids.New(), TenantID: "KL", Kind: "device"}
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error { return store.InsertApplicant(ctx, tx, jk) }))
	require.NoError(t, db.Tenant(ctx, "KL", func(tx pgx.Tx) error { return store.InsertApplicant(ctx, tx, kl) }))

	// A repository call with no tenant filter in SQL still sees only its own tenant.
	err := db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM core.applicants`).Scan(&n); err != nil {
			return err
		}
		require.Equal(t, 1, n)
		_, err := store.GetApplicant(ctx, tx, kl.ID)
		require.ErrorIs(t, err, store.ErrNotFound)
		tag, err := tx.Exec(ctx, `UPDATE core.applicants SET language = 'hi' WHERE applicant_id = $1`, kl.ID)
		require.NoError(t, err)
		require.EqualValues(t, 0, tag.RowsAffected())
		return nil
	})
	require.NoError(t, err)

	// Writing a row for another tenant is refused (WITH CHECK).
	err = db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return store.InsertApplicant(ctx, tx, &store.Applicant{ID: ids.New(), TenantID: "KL", Kind: "device"})
	})
	require.Error(t, err)

	// The cross-tenant job role sees both.
	require.NoError(t, db.System(ctx, func(tx pgx.Tx) error {
		var n int
		require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM core.applicants`).Scan(&n))
		require.Equal(t, 2, n)
		return nil
	}))
}

// Every tenant-owned table has RLS enabled and forced (CI check from DATA_MODEL §6).
func TestRLSEnabledOnEveryTenantTable(t *testing.T) {
	db := testdb.Open(t)
	rows, err := db.Pool.Query(context.Background(), `
		SELECT n.nspname || '.' || c.relname, c.relrowsecurity, c.relforcerowsecurity
		FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE a.attname = 'tenant_id' AND a.attnotnull AND c.relkind = 'r'
		  AND n.nspname IN ('core', 'privacy', 'msg', 'audit', 'ops', 'study', 'game', 'learn', 'records')
		  AND (n.nspname || '.' || c.relname) NOT IN ('core.tenants', 'core.tenant_adapter_config')`)
	require.NoError(t, err)
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var name string
		var rls, force bool
		require.NoError(t, rows.Scan(&name, &rls, &force))
		require.Truef(t, rls && force, "%s must have ENABLE + FORCE ROW LEVEL SECURITY", name)
		seen++
	}
	// 12 P0/P1 tables plus the 20 tenant tables of the P2 migrations (study, game, learn, records).
	require.GreaterOrEqual(t, seen, 32)
}

// MD-050: UPDATE/DELETE on audit rows fails for the app role, the trigger blocks even the owner,
// and the hash chain detects tampering.
func TestAuditLogAppendOnly(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	now := time.Date(2026, 10, 24, 5, 0, 0, 0, time.UTC)
	aad := "23456789012"
	aad += string(privacy.VerhoeffCheckDigit(aad))
	note := "aadhaar " + aad[:4] + " " + aad[4:8] + " " + aad[8:]
	for i := 0; i < 3; i++ {
		require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
			_, err := audit.Append(ctx, tx, now.Add(time.Duration(i)*time.Second), audit.Entry{Tenant: "JK", Actor: "usr_test", ActorScope: "user",
				Action: "consent.grant", Target: "cns_test", Meta: map[string]any{"i": i, "note": note}})
			return err
		}))
	}
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		n, err := audit.VerifyChain(ctx, tx, "JK")
		require.NoError(t, err)
		require.Equal(t, 3, n)
		return nil
	}))
	for _, q := range []string{`UPDATE audit.audit_log SET action = 'x'`, `DELETE FROM audit.audit_log`} {
		err := db.Tenant(ctx, "JK", func(tx pgx.Tx) error { _, err := tx.Exec(ctx, q); return err })
		require.Errorf(t, err, "%s must fail for mg_app", q)
		// Even the owner (no SET ROLE) is stopped by the trigger.
		_, err = db.Pool.Exec(ctx, q)
		require.Errorf(t, err, "%s must fail for the owner", q)
	}
	// Tamper with the trigger disabled (a superuser attack) and the chain breaks.
	_, err := db.Pool.Exec(ctx, `ALTER TABLE audit.audit_log DISABLE TRIGGER audit_log_no_update_delete`)
	require.NoError(t, err)
	_, err = db.Pool.Exec(ctx, `UPDATE audit.audit_log SET target = 'tampered' WHERE at = (SELECT min(at) FROM audit.audit_log)`)
	require.NoError(t, err)
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		_, err := audit.VerifyChain(ctx, tx, "JK")
		require.Error(t, err)
		return nil
	}))
	// Meta is PII-redacted before it is written.
	var meta string
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT meta::text FROM audit.audit_log LIMIT 1`).Scan(&meta))
	require.NotContains(t, meta, aad[:4]+" "+aad[4:8])
}

// DATA_MODEL §4.1: the database refuses Aadhaar-like strings and personal-vault keys in answers.
func TestCaseAnswersDefenceInDepth(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	app := &store.Applicant{ID: ids.New(), TenantID: "JK", Kind: "device"}
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error { return store.InsertApplicant(ctx, tx, app) }))
	try := func(answers map[string]any) error {
		return db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
			return store.InsertCase(ctx, tx, &store.Case{ID: ids.New(), TenantID: "JK", ApplicantID: app.ID, RulePackVersion: "2026.10.0", Answers: answers})
		})
	}
	require.NoError(t, try(map[string]any{"district": "Jammu", "id_address_district": "Kathua"}))
	require.Error(t, try(map[string]any{"note": "234567890123"}))
	require.Error(t, try(map[string]any{"name": "x"}))
	require.Error(t, try(map[string]any{"nested": map[string]any{"address_line": "x"}}))
	require.Error(t, try(map[string]any{"aadhaar_number": "n/a"}))
}

// MD-047: contact fields are encrypted at the application layer.
func TestContactsAreEncrypted(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	v, err := privacy.NewVault(bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 32))
	require.NoError(t, err)
	app := &store.Applicant{ID: ids.New(), TenantID: "JK", Kind: "device"}
	enc, err := v.EncryptString("JK", "contacts.value", "learner@example.com")
	require.NoError(t, err)
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		if err := store.InsertApplicant(ctx, tx, app); err != nil {
			return err
		}
		return store.UpsertContact(ctx, tx, &store.Contact{ID: ids.New(), TenantID: "JK", ApplicantID: app.ID, Kind: "email", ValueEnc: enc,
			BlindIndex: v.BlindIndex("JK", "email", "learner@example.com")})
	}))
	var raw []byte
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT value_enc FROM privacy.contacts`).Scan(&raw))
	require.False(t, bytes.Contains(raw, []byte("learner")), "plaintext stored")
	got, err := v.DecryptString("JK", "contacts.value", raw)
	require.NoError(t, err)
	require.Equal(t, "learner@example.com", got)
}

// D-13 revised: an account holder can never be a minor (database constraint).
func TestFamilyModeAccountHolderIsAdult(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	err := db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return store.InsertApplicant(ctx, tx, &store.Applicant{ID: ids.New(), TenantID: "JK", Kind: "account", UserBand: "u18"})
	})
	require.Error(t, err)
}
