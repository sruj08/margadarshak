package store_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/learn"
	"github.com/sruj08/margadarshak/services/api/internal/learn/learntest"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/testdb"
)

// learnApplicant inserts an applicant in tenant and returns its subject.
func learnApplicant(t *testing.T, db *store.DB, tenant string) learn.Subject {
	t.Helper()
	ctx := context.Background()
	a := &store.Applicant{ID: ids.New(), TenantID: tenant, Kind: "account", UserBand: "adult"}
	require.NoError(t, db.Tenant(ctx, tenant, func(tx pgx.Tx) error { return store.InsertApplicant(ctx, tx, a) }))
	return learn.Subject{Tenant: tenant, ApplicantID: a.ID, UserBand: "adult", Account: true}
}

// learnMember inserts an adult family member of holder and returns its subject.
func learnMember(t *testing.T, db *store.DB, holder learn.Subject) learn.Subject {
	t.Helper()
	ctx := context.Background()
	m := &store.FamilyMember{ID: ids.New(), TenantID: holder.Tenant, ApplicantID: holder.ApplicantID, Relation: "spouse",
		DOBEnc: []byte{1, 2, 3}, DOBPrecision: "year_only", AgeBand: "26_40", ParentalConsentStatus: "not_required"}
	require.NoError(t, db.Tenant(ctx, holder.Tenant, func(tx pgx.Tx) error { return store.InsertFamilyMember(ctx, tx, m) }))
	s := holder
	s.MemberID = &m.ID
	return s
}

func learnFixture(t *testing.T) (*store.DB, learntest.Fixture) {
	t.Helper()
	db := testdb.Open(t)
	holder := learnApplicant(t, db, "JK")
	return db, learntest.Fixture{Store: store.NewLearnStore(db), Holder: holder, Member: learnMember(t, db, holder),
		Other: learnApplicant(t, db, "JK")}
}

// The store contract (internal/learn/learntest), also run on learn.MemStore: includes
// learn.Service.SubmitAnswers replayed with the same batch for a holder and a family member.
func TestLearnStoreContract(t *testing.T) {
	learntest.RunStoreContract(t, func(t *testing.T) learntest.Fixture {
		_, f := learnFixture(t)
		return f
	})
}

func learnCount(t *testing.T, db *store.DB, tenant, q string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, db.Tenant(context.Background(), tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), q, args...).Scan(&n)
	}))
	return n
}

// The caches: card states are replaced (from /learn/answers and from /learn/state), topic
// mastery and the readiness summary columns follow the snapshot, rounded and clamped.
func TestLearnStoreCaches(t *testing.T) {
	db, f := learnFixture(t)
	ctx := context.Background()
	st := f.Store
	t0 := learntest.T0
	a1 := learntest.Answer("a1", "C-LL1-001", true, "75", t0.Add(-time.Hour))
	cards := []json.RawMessage{learntest.Card("C-LL1-001", t0.Add(24*time.Hour)), learntest.Card("C-LL1-002", t0),
		json.RawMessage(`{"phase":"new"}`), learntest.Card("C-LL1-001", t0.Add(48*time.Hour))}
	_, err := st.SaveAnswers(ctx, f.Member, []*learn.StoredAnswer{a1}, map[string]learn.LogRow{"a1": learntest.LogFor(a1)}, cards)
	require.NoError(t, err)
	var due time.Time
	var cardID string
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT card_id, due_at FROM learn.card_state WHERE family_member_id = $1 AND state->>'cardId' = 'C-LL1-001'`,
			f.Member.MemberID).Scan(&cardID, &due)
	}))
	require.True(t, due.Equal(t0.Add(48*time.Hour)), "the last repeated card wins: %v", due)
	require.Equal(t, 2, learnCount(t, db, "JK", `SELECT count(*) FROM learn.card_state WHERE family_member_id = $1`, f.Member.MemberID))
	require.Zero(t, learnCount(t, db, "JK", `SELECT count(*) FROM learn.card_state WHERE family_member_id IS NULL`))
	// A sync whose compute output carries no cards replaces them with none.
	_, err = st.SaveAnswers(ctx, f.Member, nil, nil, nil)
	require.NoError(t, err)
	require.Zero(t, learnCount(t, db, "JK", `SELECT count(*) FROM learn.card_state`))

	state := learntest.StateFixture(84.5, 92.4, 7.6, true)
	state.MasteryByTopic["LL3"] = learn.TopicMastery{Mastery: 1.2, Coverage: -0.5}
	state.MasteryByTopic["bad topic"] = learn.TopicMastery{Mastery: 0.5}
	nz := 64.333
	require.NoError(t, st.SaveSnapshot(ctx, f.Member, &learn.Snapshot{ComputedAt: t0, LogCount: 1, State: state, NazarScore: &nz, NazarSessions: 3}))
	var readiness, knowledge, pen int
	var met bool
	var nazar float64
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT readiness, knowledge, cal_penalty, gate_met, nazar_score::float8 FROM learn.readiness_snapshots`).
			Scan(&readiness, &knowledge, &pen, &met, &nazar)
	}))
	require.Equal(t, []int{85, 92, 8}, []int{readiness, knowledge, pen})
	require.True(t, met)
	require.InDelta(t, 64.33, nazar, 1e-9)
	got, err := st.LatestSnapshot(ctx, f.Member)
	require.NoError(t, err)
	require.InDelta(t, 64.33, *got.NazarScore, 1e-9, "nazar_score keeps two decimals")

	type tm struct {
		Topic, Node       string
		Mastery, Coverage float64
	}
	var rows []tm
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		r, err := tx.Query(ctx, `SELECT topic, node_state, mastery::float8, coverage::float8 FROM learn.topic_mastery ORDER BY topic`)
		if err != nil {
			return err
		}
		defer r.Close()
		for r.Next() {
			var x tm
			if err := r.Scan(&x.Topic, &x.Node, &x.Mastery, &x.Coverage); err != nil {
				return err
			}
			rows = append(rows, x)
		}
		return r.Err()
	}))
	require.Equal(t, []tm{{"LL1", "mastered", 0.91, 0.95}, {"LL2", "learning", 0.4, 0.5}, {"LL3", "locked", 1, 0}}, rows)
	require.Equal(t, 2, learnCount(t, db, "JK", `SELECT count(*) FROM learn.card_state`), "the state's cards are cached")

	// The next snapshot replaces the topic rows.
	next := learntest.StateFixture(50, 50, 0, false)
	delete(next.MasteryByTopic, "LL2")
	require.NoError(t, st.SaveSnapshot(ctx, f.Member, &learn.Snapshot{ComputedAt: t0.Add(time.Hour), LogCount: 1, State: next}))
	require.Equal(t, 1, learnCount(t, db, "JK", `SELECT count(*) FROM learn.topic_mastery`))
	require.Equal(t, 2, learnCount(t, db, "JK", `SELECT count(*) FROM learn.readiness_snapshots`))
}

// A store call inside a transaction carried by ctx writes in that transaction.
func TestLearnStoreUsesCarriedTx(t *testing.T) {
	db, f := learnFixture(t)
	ctx := context.Background()
	rollback := errFixed("rollback")
	err := db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		tctx := store.ContextWithTx(ctx, tx)
		n, err := f.Store.AppendLog(tctx, f.Holder, []learn.LogRow{{CardID: "C-LL1-001", Rating: 3, ReviewedAt: learntest.T0, SourceKind: "session", SourceID: "sid"}})
		require.NoError(t, err)
		require.Equal(t, 1, n)
		c, err := f.Store.LogCount(tctx, f.Holder)
		require.NoError(t, err)
		require.Equal(t, 1, c)
		return rollback
	})
	require.ErrorIs(t, err, rollback)
	c, err := f.Store.LogCount(ctx, f.Holder)
	require.NoError(t, err)
	require.Zero(t, c, "the outer rollback undid the append")
}

type errFixed string

func (e errFixed) Error() string { return string(e) }

// RLS: another tenant sees none of the learn rows; review_log is append-only for mg_app; every
// learn table has RLS enabled and forced.
func TestLearnStoreRLS(t *testing.T) {
	db, f := learnFixture(t)
	ctx := context.Background()
	addTenantKL(t, db)
	a1 := learntest.Answer("a1", "C-LL1-001", true, "75", learntest.T0)
	_, err := f.Store.SaveAnswers(ctx, f.Holder, []*learn.StoredAnswer{a1}, map[string]learn.LogRow{"a1": learntest.LogFor(a1)},
		[]json.RawMessage{learntest.Card("C-LL1-001", learntest.T0)})
	require.NoError(t, err)
	require.NoError(t, f.Store.SaveSnapshot(ctx, f.Holder, &learn.Snapshot{ComputedAt: learntest.T0, LogCount: 1, State: learntest.StateFixture(80, 85, 5, false)}))

	tables := []string{"learn.answers", "learn.review_log", "learn.card_state", "learn.topic_mastery", "learn.readiness_snapshots"}
	for _, tbl := range tables {
		require.Positivef(t, learnCount(t, db, "JK", `SELECT count(*) FROM `+tbl), "%s has JK rows", tbl)
		require.Zerof(t, learnCount(t, db, "KL", `SELECT count(*) FROM `+tbl), "%s leaks to KL", tbl)
	}
	// Through the store: the same applicant under another tenant finds nothing.
	ghost := f.Holder
	ghost.Tenant = "KL"
	n, err := f.Store.LogCount(ctx, ghost)
	require.NoError(t, err)
	require.Zero(t, n)
	got, err := f.Store.AnswersByClientID(ctx, ghost, []string{"a1"})
	require.NoError(t, err)
	require.Empty(t, got)
	_, err = f.Store.LatestSnapshot(ctx, ghost)
	require.ErrorIs(t, err, learn.ErrNotFound)

	for _, q := range []string{`UPDATE learn.review_log SET rating = 4`, `DELETE FROM learn.review_log`} {
		err := db.Tenant(ctx, "JK", func(tx pgx.Tx) error { _, err := tx.Exec(ctx, q); return err })
		require.Errorf(t, err, "%s must fail for mg_app", q)
	}

	rows, err := db.Pool.Query(ctx, `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'learn' AND c.relkind = 'r'`)
	require.NoError(t, err)
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var name string
		var rls, force bool
		require.NoError(t, rows.Scan(&name, &rls, &force))
		require.Truef(t, rls && force, "learn.%s needs ENABLE + FORCE ROW LEVEL SECURITY", name)
		seen++
	}
	require.NoError(t, rows.Err())
	require.Equal(t, len(tables), seen)
}
