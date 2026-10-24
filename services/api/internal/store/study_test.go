package store_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/study"
	"github.com/sruj08/margadarshak/services/api/internal/study/studytest"
	"github.com/sruj08/margadarshak/services/api/internal/testdb"
)

// studyApplicant inserts an applicant and, when consent is true, an active field_study consent.
func studyApplicant(t *testing.T, db *store.DB, tenant string, consent bool) (uuid.UUID, uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	app, cid := ids.New(), ids.New()
	require.NoError(t, db.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		if err := store.InsertApplicant(ctx, tx, &store.Applicant{ID: app, TenantID: tenant, Kind: "device"}); err != nil {
			return err
		}
		if !consent {
			return nil
		}
		return store.InsertConsent(ctx, tx, &store.Consent{ID: cid, TenantID: tenant, ApplicantID: app, Purpose: "field_study",
			DataCategories: []string{"study_bands", "game_sessions"}, NoticeVersion: "field_study.v1", GrantedAt: studytest.T0})
	}))
	return app, cid
}

// studyGameRow is a game.sessions row with the study columns.
type studyGameRow struct {
	Applicant uuid.UUID
	GameID    string
	Status    string
	Cohort    bool
	Session   *study.Session
}

// studyInsertGameSession inserts a game.sessions row directly, with the columns its CHECKs need.
func studyInsertGameSession(t *testing.T, db *store.DB, tenant string, r studyGameRow) {
	t.Helper()
	ctx := context.Background()
	s := r.Session
	if r.GameID == "" {
		r.GameID = "nazar"
		if s.Phase == study.PhaseLLMock {
			r.GameID = "ll_sim"
		}
	}
	if r.Status == "" {
		r.Status = "checked"
	}
	submitted := s.VerifiedAt.Add(-10 * time.Second)
	started := submitted.Add(-time.Duration(s.DurationMs) * time.Millisecond)
	var verifiedAt *time.Time
	var serverResult []byte
	if r.Status == "checked" {
		v := s.VerifiedAt
		verifiedAt = &v
		var err error
		serverResult, err = json.Marshal(map[string]any{"score": map[string]any{"raw": s.ScoreRaw, "max": s.ScoreMax, "pct": 0}})
		require.NoError(t, err)
	}
	var analysis []byte
	if s.Analysis != nil {
		var err error
		analysis, err = json.Marshal(s.Analysis)
		require.NoError(t, err)
	}
	var cohort, participant, phase *string
	if r.Cohort {
		c, p, ph := "field_test", s.ParticipantCode, s.Phase
		cohort, participant, phase = &c, &p, &ph
	}
	require.NoError(t, db.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO game.sessions (session_id, tenant_id, applicant_id, game_id, mode, game_version,
			  scoring_version, rule_pack_version, seed, seed_origin, difficulty, status, cohort, study_participant, study_phase,
			  context, started_at, expires_at, submitted_at, verified_at, digest, server_result, analysis, trust)
			VALUES ($1, $2, $3, $4, 'mock', '1.0.0', '1.0', '2026.10.0', 42, 'server', 1, $5, $6, $7, $8,
			  '{}', $9, $10, $11, $12, $13, $14, $15, $16)`,
			s.SessionID, tenant, r.Applicant, r.GameID, r.Status, cohort, participant, phase,
			started, started.Add(time.Hour), submitted, verifiedAt, "sha256:"+strings.Repeat("0", 64), serverResult, analysis, s.Trust)
		return err
	}))
}

func studyFixture(t *testing.T) studytest.Fixture {
	db := testdb.Open(t)
	addTenantKL(t, db)
	st := store.NewStudyStore(db)
	return studytest.Fixture{
		Store: st, Tenant: "JK", Other: "KL",
		Applicant: func(t *testing.T, tenant string) (uuid.UUID, uuid.UUID) { return studyApplicant(t, db, tenant, true) },
		AddSession: func(t *testing.T, tenant string, applicant uuid.UUID, s *study.Session) {
			studyInsertGameSession(t, db, tenant, studyGameRow{Applicant: applicant, Cohort: true, Session: s})
		},
		SetBlocks: func(t *testing.T, tenant string, b *study.Blocks) {
			require.NoError(t, st.SaveFormBlocks(context.Background(), tenant, b, studytest.T0))
		},
		LatestStats: func(t *testing.T, tenant string) *study.PublicStats {
			ps, err := st.LatestPublicStats(context.Background(), tenant)
			require.NoError(t, err)
			return ps
		},
	}
}

func TestStudyStoreContract(t *testing.T) {
	studytest.RunStoreContract(t, studyFixture)
}

// studyConsents is study.Consents over privacy.consent_artefacts.
type studyConsents struct{ db *store.DB }

func (c studyConsents) ActiveConsent(ctx context.Context, tenant string, applicant uuid.UUID, purpose string) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := c.db.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		a, err := store.ActiveConsent(ctx, tx, applicant, purpose, nil, nil)
		if err != nil {
			return err
		}
		id = a.ID
		return nil
	})
	if errors.Is(err, store.ErrNotFound) {
		return uuid.Nil, false, nil
	}
	return id, err == nil, err
}

type studySpeeds map[string]float64

func (s studySpeeds) ClipSpeeds(context.Context, []string) (map[string]float64, error) { return s, nil }

func studyService(db *store.DB) (*study.Service, *store.StudyStore) {
	st := store.NewStudyStore(db)
	return &study.Service{Store: st, Consents: studyConsents{db}, Clock: servertime.NewFixed(studytest.T0)}, st
}

var studyOKEnrol = study.EnrolInput{ConsentGiven: true, AgeOK: true, AgeBand: "21_24", LicenceHeld: "2w", YearsDriving: "1_3"}

func studyCounts(t *testing.T, db *store.DB) map[string]int {
	t.Helper()
	ctx := context.Background()
	out := map[string]int{}
	require.NoError(t, db.System(ctx, func(tx pgx.Tx) error {
		for _, tbl := range []string{"study.nazar_arrivals", "study.nazar_participants", "study.form_blocks", "study.public_stats"} {
			var n int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM `+tbl).Scan(&n); err != nil {
				return err
			}
			out[tbl] = n
		}
		return nil
	}))
	return out
}

var studyNoRows = map[string]int{"study.nazar_arrivals": 0, "study.nazar_participants": 0, "study.form_blocks": 0, "study.public_stats": 0}

// study.Service.Enrol on embedded PG: three arrivals get forms A, B, C; enrolling again returns
// the same participant; near-miss and withdrawal satisfy the row CHECKs.
func TestStudyEnrolOnPG(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	svc, st := studyService(db)
	var subjects []study.Subject
	for i, want := range []string{"A", "B", "C"} {
		app, cid := studyApplicant(t, db, "JK", true)
		subj := study.Subject{Tenant: "JK", ApplicantID: app}
		subjects = append(subjects, subj)
		p, err := svc.Enrol(ctx, subj, studyOKEnrol)
		require.NoError(t, err)
		require.Equal(t, want, p.Form)
		require.Equal(t, i+1, p.Seq)
		require.Equal(t, cid, p.ConsentID)
	}
	again, err := svc.Enrol(ctx, subjects[0], studyOKEnrol)
	require.NoError(t, err)
	require.Equal(t, "P-001", again.Code, "enrolling twice returns the existing participant")
	all, err := st.Participants(ctx, "JK")
	require.NoError(t, err)
	require.Len(t, all, 3)
	var last int
	require.NoError(t, db.System(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT last_seq FROM study.nazar_arrivals WHERE tenant_id = 'JK'`).Scan(&last)
	}))
	require.Equal(t, 3, last)

	retake, err := svc.Enrol(ctx, subjects[0], study.EnrolInput{ConsentGiven: true, AgeOK: true, AgeBand: "21_24",
		LicenceHeld: "2w", YearsDriving: "1_3", RetakeOf: "P-001"})
	require.NoError(t, err)
	require.Equal(t, "P-004", retake.Code)
	require.Equal(t, "A", retake.Form)

	require.NoError(t, svc.NearMiss(ctx, subjects[1], "P-002", "A truck reversed out of a lane"))
	require.NoError(t, svc.Withdraw(ctx, subjects[1], "P-002"))
	p2, err := st.GetParticipant(ctx, "JK", "P-002")
	require.NoError(t, err)
	require.NotNil(t, p2.WithdrawnAt)
	require.Empty(t, p2.NearMissText)

	require.NoError(t, st.SaveFormBlocks(ctx, "JK", studytest.Blocks(), studytest.T0))
	items, err := svc.FormItems(ctx, "JK", "P-003", study.PhaseFresh)
	require.NoError(t, err)
	require.Equal(t, studytest.Blocks().B2, items, "form C: fresh is B2")
}

// A declined consent, an under-18 answer and a missing field_study artefact store nothing.
func TestStudyEnrolDeclinedStoresNothing(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	svc, _ := studyService(db)
	app, _ := studyApplicant(t, db, "JK", true)
	subj := study.Subject{Tenant: "JK", ApplicantID: app}
	declined := studyOKEnrol
	declined.ConsentGiven = false
	_, err := svc.Enrol(ctx, subj, declined)
	require.ErrorIs(t, err, study.ErrDeclined)
	under := studyOKEnrol
	under.AgeOK = false
	_, err = svc.Enrol(ctx, subj, under)
	require.ErrorIs(t, err, study.ErrUnder18)
	noConsent, _ := studyApplicant(t, db, "JK", false)
	_, err = svc.Enrol(ctx, study.Subject{Tenant: "JK", ApplicantID: noConsent}, studyOKEnrol)
	require.ErrorIs(t, err, study.ErrConsentRequired)
	require.Equal(t, studyNoRows, studyCounts(t, db))
}

// Sessions reads only verified field_test sessions of the tenant, with duration, score and analysis.
func TestStudySessionsFilter(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	svc, st := studyService(db)
	app, _ := studyApplicant(t, db, "JK", true)
	p, err := svc.Enrol(ctx, study.Subject{Tenant: "JK", ApplicantID: app}, studyOKEnrol)
	require.NoError(t, err)
	mk := func(phase string, at time.Duration) *study.Session {
		return &study.Session{ParticipantCode: p.Code, Phase: phase, SessionID: ids.New(), Trust: 0.9, DurationMs: 61500,
			ScoreRaw: 11, ScoreMax: 15, VerifiedAt: studytest.T0.Add(at)}
	}
	keep := mk(study.PhaseLLMock, time.Minute)
	studyInsertGameSession(t, db, "JK", studyGameRow{Applicant: app, Cohort: true, Session: keep})
	for _, status := range []string{"started", "submitted", "voided", "expired"} {
		studyInsertGameSession(t, db, "JK", studyGameRow{Applicant: app, Cohort: true, Status: status, Session: mk(study.PhaseTest, 0)})
	}
	studyInsertGameSession(t, db, "JK", studyGameRow{Applicant: app, Cohort: false, Session: mk(study.PhaseTest, 0)})
	got, err := st.Sessions(ctx, "JK")
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Equal(t, keep.SessionID, got[0].SessionID)
	require.EqualValues(t, 61500, got[0].DurationMs)
	require.InDelta(t, 0.9, got[0].Trust, 1e-9)
	require.Equal(t, 11.0, got[0].ScoreRaw)
	require.Equal(t, 15.0, got[0].ScoreMax)
	require.Nil(t, got[0].Analysis)
	require.True(t, keep.VerifiedAt.Equal(got[0].VerifiedAt))
}

// study.Service.Export over verified field_test sessions inserted into game.sessions.
func TestStudyExportOnPG(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	svc, _ := studyService(db)
	svc.Speeds = studySpeeds{"clip:JMU-0001@1": 30}
	app, _ := studyApplicant(t, db, "JK", true)
	p, err := svc.Enrol(ctx, study.Subject{Tenant: "JK", ApplicantID: app}, studyOKEnrol)
	require.NoError(t, err)

	analysis := func(marks float64) map[string]study.NazarAnalysis {
		late, tap := 0.75, 1200.0
		c := func(rule string) study.NazarAnalysis {
			return study.NazarAnalysis{Rule: rule, Clips: []study.ClipAnalysis{{Ordinal: 1, Ref: "clip:JMU-0001@1", Taps: 1,
				MaxTapsInWindow: 1, Marks: marks, Hazards: []study.HazardAnalysis{{HazardID: "h1", HazardType: "pedestrian",
					Credit: 1, TapMt: &tap, LateS: &late}}}}}
		}
		return map[string]study.NazarAnalysis{study.KindPrimary: c("kerala_5band"), study.KindLinear: c("field_kit_linear")}
	}
	rows := []*study.Session{
		{ParticipantCode: p.Code, Phase: study.PhaseLLMock, SessionID: ids.New(), Trust: 1, DurationMs: 90000, ScoreRaw: 12, ScoreMax: 15,
			VerifiedAt: studytest.T0.Add(time.Minute)},
		{ParticipantCode: p.Code, Phase: study.PhaseTest, SessionID: ids.New(), Trust: 0.729, DurationMs: 120000, ScoreRaw: 75, ScoreMax: 100,
			Analysis: analysis(7.5), VerifiedAt: studytest.T0.Add(5 * time.Minute)},
		{ParticipantCode: p.Code, Phase: study.PhaseFresh, SessionID: ids.New(), Trust: 0.9, DurationMs: 60000, ScoreRaw: 80, ScoreMax: 100,
			Analysis: analysis(8), VerifiedAt: studytest.T0.Add(9 * time.Minute)},
	}
	for _, s := range rows {
		studyInsertGameSession(t, db, "JK", studyGameRow{Applicant: app, Cohort: true, Session: s})
	}
	// A later unverified test session does not replace the verified one.
	studyInsertGameSession(t, db, "JK", studyGameRow{Applicant: app, Cohort: true, Status: "submitted", Session: &study.Session{
		ParticipantCode: p.Code, Phase: study.PhaseTest, SessionID: ids.New(), Trust: 0.1, DurationMs: 1000, VerifiedAt: studytest.T0.Add(time.Hour)}})

	ex, err := svc.Export(ctx, "JK")
	require.NoError(t, err)
	require.Equal(t, 1, ex.Summary.Rows)
	require.Empty(t, ex.Summary.Incomplete)
	require.Empty(t, ex.Summary.ExcludedLowTrust)
	r := ex.Rows[0]
	require.Equal(t, p.Code, r.AnonID)
	require.Equal(t, 12, r.LLScore)
	require.Equal(t, 7.5, r.HPTScore)
	require.Equal(t, 8.0, r.PostMean)
	require.Equal(t, 0.75, r.MedianLateS)
	require.Equal(t, 30.0, r.SpeedKmh)
	require.Equal(t, 270.0, r.TotalS)
	require.InDelta(t, 0.729, r.MinClipTrust, 1e-9)
	require.Contains(t, string(ex.Files[study.FileSessions]), "P-001,12,7.5,7.5,8,0.75,30,270,1,1,\n")
}

// RLS: another tenant sees none of the study rows, and mg_app may not write blocks or stats.
func TestStudyRLSTenantIsolation(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	addTenantKL(t, db)
	svc, st := studyService(db)
	app, _ := studyApplicant(t, db, "JK", true)
	p, err := svc.Enrol(ctx, study.Subject{Tenant: "JK", ApplicantID: app}, studyOKEnrol)
	require.NoError(t, err)
	require.NoError(t, st.SaveFormBlocks(ctx, "JK", studytest.Blocks(), studytest.T0))
	require.NoError(t, st.SavePublicStats(ctx, "JK", &study.PublicStats{AsOf: studytest.T0, Payload: map[string]any{"participants": 1},
		ScriptSHA256: strings.Repeat("a", 64)}))
	studyInsertGameSession(t, db, "JK", studyGameRow{Applicant: app, Cohort: true, Session: &study.Session{ParticipantCode: p.Code,
		Phase: study.PhaseLLMock, SessionID: ids.New(), Trust: 1, DurationMs: 1000, VerifiedAt: studytest.T0}})

	// Raw SQL with no tenant filter under KL sees nothing.
	require.NoError(t, db.Tenant(ctx, "KL", func(tx pgx.Tx) error {
		for _, tbl := range []string{"study.nazar_arrivals", "study.nazar_participants", "study.form_blocks", "study.public_stats"} {
			var n int
			require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM `+tbl).Scan(&n))
			require.Zerof(t, n, "%s visible to KL", tbl)
		}
		return nil
	}))
	_, err = st.GetParticipant(ctx, "KL", p.Code)
	require.ErrorIs(t, err, study.ErrNotFound)
	ps, err := st.Participants(ctx, "KL")
	require.NoError(t, err)
	require.Empty(t, ps)
	ss, err := st.Sessions(ctx, "KL")
	require.NoError(t, err)
	require.Empty(t, ss)
	_, err = st.FormBlocks(ctx, "KL")
	require.ErrorIs(t, err, study.ErrNotFound)
	stats, err := st.LatestPublicStats(ctx, "KL")
	require.NoError(t, err)
	require.Nil(t, stats)
	seq, err := st.NextSeq(ctx, "KL")
	require.NoError(t, err)
	require.Equal(t, 1, seq, "KL counts its own arrivals")

	// Writing a participant row for another tenant is refused (WITH CHECK).
	err = db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE study.nazar_participants SET tenant_id = 'KL' WHERE participant_code = $1`, p.Code)
		return err
	})
	require.Error(t, err)
	// mg_app (request traffic) cannot write blocks or public stats.
	for _, q := range []string{
		`INSERT INTO study.public_stats (tenant_id, as_of, payload, script_sha256) VALUES ('JK', now(), '{}', repeat('a', 64))`,
		`UPDATE study.form_blocks SET frozen_at = now()`,
	} {
		err := db.Tenant(ctx, "JK", func(tx pgx.Tx) error { _, err := tx.Exec(ctx, q); return err })
		require.True(t, store.IsCode(err, "42501"), "%s: %v", q, err)
	}
}

// A transaction carried in ctx is reused: rolling it back undoes NextSeq and InsertParticipant.
func TestStudyCarriedTransaction(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	st := store.NewStudyStore(db)
	app, cid := studyApplicant(t, db, "JK", true)
	errRollback := errors.New("rollback")
	err := db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		tctx := store.ContextWithTx(ctx, tx)
		seq, err := st.NextSeq(tctx, "JK")
		require.NoError(t, err)
		require.Equal(t, 1, seq)
		p := &study.Participant{Code: "P-001", Tenant: "JK", ApplicantID: app, ConsentID: cid, AgeBand: "18_20", LicenceHeld: "ll",
			YearsDriving: "0_1", AgeOK: true, Form: "A", Seq: 1, CreatedAt: studytest.T0}
		require.NoError(t, st.InsertParticipant(tctx, p))
		_, err = st.GetParticipant(tctx, "JK", "P-001")
		require.NoError(t, err)
		return errRollback
	})
	require.ErrorIs(t, err, errRollback)
	_, err = st.GetParticipant(ctx, "JK", "P-001")
	require.ErrorIs(t, err, study.ErrNotFound)
	seq, err := st.NextSeq(ctx, "JK")
	require.NoError(t, err)
	require.Equal(t, 1, seq)

	// The seq/form CHECK refuses a mismatched form.
	bad := &study.Participant{Code: "P-002", Tenant: "JK", ApplicantID: app, ConsentID: cid, AgeBand: "18_20", LicenceHeld: "ll",
		YearsDriving: "0_1", AgeOK: true, Form: "A", Seq: 2, CreatedAt: studytest.T0}
	require.Error(t, st.InsertParticipant(ctx, bad))
}
