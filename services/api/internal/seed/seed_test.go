package seed_test

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/seed"
	"github.com/sruj08/margadarshak/services/api/internal/testdb"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

// MD-054: no seed value matches an Aadhaar-like or phone-like pattern (lint).
func TestSeedValuesAreSynthetic(t *testing.T) {
	for _, day := range []int{12, 31} {
		b, err := json.Marshal(seed.Personas(day))
		require.NoError(t, err)
		for _, f := range privacy.Detect(string(b)) {
			require.NotContainsf(t, []privacy.Kind{privacy.KindAadhaar, privacy.KindVID, privacy.KindOTP, privacy.KindPhone, privacy.KindPAN}, f.Kind,
				"seed carries a %s-like value", f.Kind)
		}
		require.False(t, privacy.HasTwelveDigitRun(string(b)))
		for _, p := range seed.Personas(day) {
			for _, c := range p.Cases {
				if c.KeyDates != nil {
					kd, _ := json.Marshal(c.KeyDates(time.Now()))
					require.Empty(t, privacy.Detect(string(kd)))
				}
			}
		}
	}
}

func TestSeedIdempotentPersonas(t *testing.T) {
	db := testdb.Open(t)
	v, err := privacy.NewVault(bytes.Repeat([]byte{3}, 32), bytes.Repeat([]byte{4}, 32))
	require.NoError(t, err)
	ctx := context.Background()
	deps := seed.Deps{DB: db, Vault: v, Now: time.Date(2026, 10, 24, 4, 0, 0, 0, time.UTC),
		FeeTotal: func(string, []string) (int64, error) { return 90000, nil }}
	rep, err := seed.Run(ctx, deps, "JK", 12)
	require.NoError(t, err)
	require.Equal(t, 9, rep.Created)
	rep, err = seed.Run(ctx, deps, "JK", 12)
	require.NoError(t, err)
	require.Equal(t, 0, rep.Created)
	require.Equal(t, 9, rep.Existing)

	require.NoError(t, db.System(ctx, func(tx pgx.Tx) error {
		count := func(q string) int {
			var n int
			require.NoError(t, tx.QueryRow(ctx, q).Scan(&n))
			return n
		}
		require.Equal(t, 9, count(`SELECT count(*) FROM core.applicants WHERE kind = 'account'`))
		require.Equal(t, 7, count(`SELECT count(*) FROM core.cases`))
		// Rahul (17) lives in the parent's account with a recorded parental consent.
		require.Equal(t, 1, count(`SELECT count(*) FROM core.family_members WHERE is_minor AND parental_consent_status = 'granted'`))
		require.Equal(t, 1, count(`SELECT count(*) FROM privacy.consent_artefacts WHERE purpose = 'parental_consent'`))
		require.Equal(t, 1, count(`SELECT count(*) FROM core.cases WHERE 'for_minor_family_member' = ANY(flags)`))
		require.Equal(t, 3, count(`SELECT count(*) FROM core.payment_intents WHERE adapter = 'mock' AND amount_paise = 90000`))
		return nil
	}))
}

type memObjects map[string][]byte

func (m memObjects) Put(_ context.Context, key string, body []byte, _ string) error {
	m[key] = append([]byte(nil), body...)
	return nil
}

// The sample clip bank: eleven labelled ai_generated samples, published (ten mock-eligible), each with
// a passing synthetic review, two agreeing seed ratings, a scoring document and placeholder media.
// Idempotent, and the P1 persona counts do not change.
func TestSeedSampleClips(t *testing.T) {
	db := testdb.Open(t)
	v, err := privacy.NewVault(bytes.Repeat([]byte{3}, 32), bytes.Repeat([]byte{4}, 32))
	require.NoError(t, err)
	ctx := context.Background()
	now := time.Date(2026, 10, 24, 4, 0, 0, 0, time.UTC)
	_, err = seed.Run(ctx, seed.Deps{DB: db, Vault: v, Now: now, FeeTotal: func(string, []string) (int64, error) { return 90000, nil }}, "JK", 12)
	require.NoError(t, err)
	objects := memObjects{}
	rep, err := seed.SampleClips(ctx, seed.ClipDeps{DB: db, Objects: objects, Now: now})
	require.NoError(t, err)
	require.Equal(t, 11, rep.Created)
	require.Len(t, rep.Refs, 11)
	rep, err = seed.SampleClips(ctx, seed.ClipDeps{DB: db, Objects: objects, Now: now.Add(time.Hour)})
	require.NoError(t, err)
	require.Equal(t, 0, rep.Created)
	require.Equal(t, 11, rep.Existing)
	require.Len(t, objects, 22, "360p and 480p per clip")
	for _, b := range objects {
		require.Len(t, b, seed.SampleClipPlaceholderBytes)
	}

	require.NoError(t, db.System(ctx, func(tx pgx.Tx) error {
		count := func(q string) int {
			var n int
			require.NoError(t, tx.QueryRow(ctx, q).Scan(&n))
			return n
		}
		require.Equal(t, 11, count(`SELECT count(*) FROM content.clips WHERE status = 'published' AND origin = 'ai_generated' AND flash_passed
			AND (synthetic_review ->> 'passed')::boolean AND doc -> 'generation' ->> 'model' = 'sample-fixture-not-generated'
			AND doc ->> 'city' = 'Sample fixture' AND generation_key LIKE 'SCN-000:0:sample-%'`))
		require.Equal(t, 10, count(`SELECT count(*) FROM content.clips WHERE mock_eligible AND jsonb_array_length(doc -> 'hazards') > 0
			AND (doc -> 'difficulty' ->> 'curator')::int BETWEEN 2 AND 4`), "ten hazard clips for the Kerala mock")
		require.Equal(t, 1, count(`SELECT count(*) FROM content.clips WHERE clip_id = 'KL-0011' AND NOT mock_eligible
			AND mock_reasons = ARRAY['quiet clip (no hazard to score)']`), "a quiet clip is never mock-eligible (clip-pipeline)")
		require.Equal(t, 11, count(`SELECT count(*) FROM content.clip_scoring`))
		require.Equal(t, 22, count(`SELECT count(*) FROM content.clip_ratings WHERE rater IN ('seed-rater1', 'seed-rater2')`))
		require.Equal(t, 11, count(`SELECT last FROM content.clip_id_counters WHERE prefix = 'KL'`))
		require.Equal(t, 2, count(`SELECT jsonb_array_length(doc -> 'hazards') FROM content.clip_scoring WHERE clip_id = 'KL-0004'`))
		// P1 seed counts are unchanged by the clip seed.
		require.Equal(t, 9, count(`SELECT count(*) FROM core.applicants WHERE kind = 'account'`))
		require.Equal(t, 7, count(`SELECT count(*) FROM core.cases`))
		return nil
	}))
}
