package httpapi_test

// Online Nazar field study (API-70 enrolment and near-miss, the RW-4 CSV export, API-71 nazar).

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/study"
	"github.com/sruj08/margadarshak/services/api/internal/study/studytest"
)

const (
	studyEnrolPath  = "/v1/study/nazar/enrolments"
	studyNearPath   = "/v1/study/nazar/enrolments/{participantCode}/near-miss"
	studyExportPath = "/internal/study/exports/{file}"

	studyHeaderSessions  = "anon_id,ll_score,hpt_score,pre_mean,post_mean,median_late_s,speed_kmh,total_s,max_taps_per_s,age_ok,retake_of\n"
	studyHeaderRaters    = "clip_id,rater_a_onset_s,rater_b_onset_s\n"
	studyHeaderResponses = "anon_id,form,clip_id,block,phase,score_primary,score_alt,first_tap_s,n_taps,timing_mode,trust\n"
)

var studyFiles = []string{"sessions.csv", "sessions_alt.csv", "raters.csv", "clip_responses.csv"}

func studyOKBody() map[string]any {
	return map[string]any{"age_ok": true, "age_band": "21_24", "licence_held": "2w", "years_driving": "1_3"}
}

// studyGrantConsent records the field_study consent through API-60 and returns its consent_id.
func studyGrantConsent(t *testing.T, c *client) string {
	t.Helper()
	r := c.do("POST", "/v1/me/consents", map[string]any{"purpose": "field_study", "action": "grant", "notice_version": "study-s2-2026.10.24",
		"language": "en"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	return r.json(t)["consent_id"].(string)
}

// studyEnrolOK consents and enrols a fresh device session; it returns the client and the enrolment.
func studyEnrolOK(t *testing.T, e *env) (*client, map[string]any) {
	t.Helper()
	c := e.deviceClient()
	studyGrantConsent(t, c)
	r := c.do("POST", studyEnrolPath, studyOKBody(), idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", studyEnrolPath, r)
	return c, r.json(t)
}

// studyExportGet sends a signed GET /internal/study/exports/{file} (bearer + HMAC over method,
// path+query and the empty body). The clock moves one second first so two reads of the same file
// carry different signatures (the replay cache is keyed on the request line and the signature).
func studyExportGet(t *testing.T, e *env, file string, query url.Values) resp {
	t.Helper()
	e.clock.Advance(time.Second)
	u := e.srv.URL + "/internal/study/exports/" + file
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	require.NoError(t, err)
	req.Header.Set("X-Tenant", "JK")
	req.Header.Set("Authorization", "Bearer "+e.cfg.InternalBearerTokens[0])
	req.Header.Set(hmacsig.Header, hmacsig.Sign([]byte(e.cfg.InternalHMACSecret), e.clock.Now(), nil))
	res, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{Status: res.StatusCode, Header: res.Header, Body: b}
}

// studyAssertCSV checks a 200 export against the spec: the status and text/csv are declared for
// the operation and the body is a string (assertContract parses JSON, so CSV is checked here).
func studyAssertCSV(t *testing.T, r resp) {
	t.Helper()
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	doc := loadSpec(t)
	op := doc["paths"].(map[string]any)[studyExportPath].(map[string]any)["get"].(map[string]any)
	content := op["responses"].(map[string]any)["200"].(map[string]any)["content"].(map[string]any)
	ct := strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])
	require.Equal(t, "text/csv", ct)
	sch, ok := content[ct].(map[string]any)["schema"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "string", sch["type"])
	sum := sha256.Sum256(r.Body)
	require.Equal(t, `"sha256:`+hex.EncodeToString(sum[:])+`"`, r.Header.Get("ETag"))
}

func studyReadCSV(t *testing.T, b []byte) [][]string {
	t.Helper()
	recs, err := csv.NewReader(bytes.NewReader(b)).ReadAll()
	require.NoError(t, err)
	return recs
}

// studyTableCounts counts every study.* table and the consent artefacts.
func studyTableCounts(t *testing.T, e *env) map[string]int {
	t.Helper()
	ctx := context.Background()
	out := map[string]int{}
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		for _, tbl := range []string{"study.nazar_arrivals", "study.nazar_participants", "study.form_blocks", "study.public_stats",
			"privacy.consent_artefacts"} {
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

func studyApplicantOf(t *testing.T, e *env, code string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	require.NoError(t, e.app.DB.System(context.Background(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT applicant_id FROM study.nazar_participants WHERE participant_code = $1`, code).Scan(&id)
	}))
	return id
}

// studyAnalysis is the verifier's per-clip analysis for refs (one hazard per clip, onset 12 s).
func studyAnalysis(refs []string, primary, linear, lateS float64, maxTaps int) map[string]study.NazarAnalysis {
	mk := func(rule string, marks float64) study.NazarAnalysis {
		a := study.NazarAnalysis{Rule: rule}
		for i, ref := range refs {
			band, late := 1, lateS
			tap, metres := 12000+late*1000, late*11.1
			a.Clips = append(a.Clips, study.ClipAnalysis{Ordinal: i + 1, Ref: ref, Taps: 2, MaxTapsInWindow: maxTaps, Marks: marks,
				Hazards: []study.HazardAnalysis{{HazardID: "h1", HazardType: "bus_stop_pedestrian", Credit: marks, Band: &band, TapMt: &tap,
					LateS: &late, Metres: &metres}}})
		}
		return a
	}
	return map[string]study.NazarAnalysis{study.KindPrimary: mk("kerala_5band", primary), study.KindLinear: mk("field_kit_linear", linear)}
}

// studySession is one verified field_test game.sessions row (columns and CHECKs per 00006).
type studySession struct {
	Code, Phase        string
	Trust              float64
	DurationMs         int64
	ScoreRaw, ScoreMax float64
	Analysis           map[string]study.NazarAnalysis
	VerifiedAt         time.Time
}

func studyInsertSession(t *testing.T, e *env, applicant uuid.UUID, s studySession) {
	t.Helper()
	ctx := context.Background()
	game := "nazar"
	if s.Phase == study.PhaseLLMock {
		game = "ll_sim"
	}
	submitted := s.VerifiedAt.Add(-10 * time.Second)
	started := submitted.Add(-time.Duration(s.DurationMs) * time.Millisecond)
	result, err := json.Marshal(map[string]any{"score": map[string]any{"raw": s.ScoreRaw, "max": s.ScoreMax, "pct": 0}})
	require.NoError(t, err)
	var analysis []byte
	if s.Analysis != nil {
		analysis, err = json.Marshal(s.Analysis)
		require.NoError(t, err)
	}
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO game.sessions (session_id, tenant_id, applicant_id, game_id, mode, game_version,
			  scoring_version, rule_pack_version, seed, seed_origin, difficulty, status, cohort, study_participant, study_phase,
			  context, started_at, expires_at, submitted_at, verified_at, digest, server_result, analysis, trust, timing_mode)
			VALUES ($1, 'JK', $2, $3, 'mock', '1.0.0', '1.0', '2026.10.0', 42, 'server', 1, 'checked', 'field_test', $4, $5,
			  '{}', $6, $7, $8, $9, $10, $11, $12, $13, 'rvfc')`,
			ids.New(), applicant, game, s.Code, s.Phase, started, started.Add(time.Hour), submitted, s.VerifiedAt,
			"sha256:"+strings.Repeat("0", 64), result, analysis, s.Trust)
		return err
	}))
}

// studySetAgreement stores a two-rater agreement on each clip (raters.csv reads the first pair).
func studySetAgreement(t *testing.T, e *env, refs []string) {
	t.Helper()
	ctx := context.Background()
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		for i, ref := range refs {
			id := strings.TrimSuffix(strings.TrimPrefix(ref, "clip:"), "@1")
			g := clips.AgreementResult{ClipID: id, Version: 1, Raters: []string{"rater-01", "rater-02"}, Accepted: true,
				Pairs: []clips.AgreementPair{{A: clips.RaterMark{HazardType: "bus_stop_pedestrian", AMs: 12000 + 100*i, BMs: 16500},
					B: clips.RaterMark{HazardType: "bus_stop_pedestrian", AMs: 12200 + 110*i, BMs: 16600}, DeltaOnsetMs: float64(200 + 10*i), Accepted: true}}}
			raw, err := json.Marshal(g)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE content.clips SET agreement = $1 WHERE clip_id = $2`, raw, id); err != nil {
				return err
			}
		}
		return nil
	}))
}

// studyFixture is a study tenant with 15 published clips in three blocks, rater agreements, and
// enrolled participants with verified ll_mock, test and fresh sessions.
type studyFixture struct {
	e      *p2Env
	blocks *study.Blocks
	codes  []string
	near   *client // P-001's session
}

// studyPart describes one participant's sessions.
type studyPart struct {
	llCorrect     float64
	testMarks     float64
	freshMarks    float64
	trust         float64 // test and fresh session trust
	lateS         float64
	maxTaps       int
	testDuration  int64
	freshDuration int64
}

func studyDefaultParts() []studyPart {
	return []studyPart{
		{12, 6, 7, 0.9, 0.6, 1, 120000, 60000},
		{9, 4, 5, 0.95, 1.1, 2, 120000, 60000},
		{14, 8, 8, 1, 0.4, 1, 120000, 60000},
		{10, 7, 9, 0.5, 0.8, 1, 120000, 60000}, // P-004: trust 0.5, left out
		{11, 3, 5, 0.6, 1.4, 2, 120000, 60000}, // P-005: trust exactly 0.6, kept
		{8, 5, 4, 0.8, 0.9, 4, 120000, 60000},  // P-006: 4 taps/s, the script drops it
		{13, 9, 9, 0.9, 0.3, 1, 20000, 10000},  // P-007: under 60 s, the script drops it
		{7, 2, 4, 0.85, 1.6, 1, 120000, 60000},
	}
}

func newStudyFixture(t *testing.T, parts []studyPart) *studyFixture {
	t.Helper()
	e := newP2Env(t)
	ctx := context.Background()
	refs := e.seedPublishedClips(15)
	b := &study.Blocks{B1: refs[0:5], B2: refs[5:10], B3: refs[10:15], LLSet: studytest.Blocks().LLSet}
	require.NoError(t, e.app.P2.StudyStore.SaveFormBlocks(ctx, "JK", b, e.clock.Now()))
	studySetAgreement(t, e.env, refs)
	f := &studyFixture{e: e, blocks: b}
	for i, p := range parts {
		c, out := studyEnrolOK(t, e.env)
		code := out["participant_code"].(string)
		require.Equal(t, fmt.Sprintf("P-%03d", i+1), code)
		require.Equal(t, study.FormFor(i+1), out["form"])
		if i == 0 {
			f.near = c
		}
		f.codes = append(f.codes, code)
		app := studyApplicantOf(t, e.env, code)
		test, err := study.ItemsFor(b, out["form"].(string), study.PhaseTest)
		require.NoError(t, err)
		fresh, err := study.ItemsFor(b, out["form"].(string), study.PhaseFresh)
		require.NoError(t, err)
		at := e.clock.Now().Add(-time.Hour)
		llDuration := int64(60000)
		if p.testDuration+p.freshDuration < 60000 {
			llDuration = 10000 // a rushed participant is quick throughout (total under 60 s)
		}
		studyInsertSession(t, e.env, app, studySession{Code: code, Phase: study.PhaseLLMock, Trust: 1, DurationMs: llDuration, ScoreRaw: p.llCorrect,
			ScoreMax: 15, VerifiedAt: at})
		studyInsertSession(t, e.env, app, studySession{Code: code, Phase: study.PhaseTest, Trust: p.trust, DurationMs: p.testDuration,
			ScoreRaw: 10 * p.testMarks, ScoreMax: 100, Analysis: studyAnalysis(test, p.testMarks, p.testMarks*0.9, p.lateS, p.maxTaps),
			VerifiedAt: at.Add(5 * time.Minute)})
		studyInsertSession(t, e.env, app, studySession{Code: code, Phase: study.PhaseFresh, Trust: p.trust, DurationMs: p.freshDuration,
			ScoreRaw: 5 * p.freshMarks, ScoreMax: 50, Analysis: studyAnalysis(fresh, p.freshMarks, p.freshMarks*0.9, p.lateS, p.maxTaps),
			VerifiedAt: at.Add(10 * time.Minute)})
	}
	return f
}

// ---- export --------------------------------------------------------------------------------

func TestExport_ExactColumns(t *testing.T) {
	f := newStudyFixture(t, studyDefaultParts())
	e := f.e
	// The near-miss line lives only in the study table and never reaches a CSV.
	nm := "Bus ke peeche se ek ladka achanak nikla"
	r := f.near.do("POST", "/v1/study/nazar/enrolments/P-001/near-miss", map[string]any{"text": nm, "language": "hi"}, idem())
	require.Equalf(t, http.StatusNoContent, r.Status, "%s", r.Body)
	assertContract(t, "POST", studyNearPath, r)

	want, err := e.app.P2.Study.Export(context.Background(), "JK")
	require.NoError(t, err)
	headers := map[string]string{"sessions.csv": studyHeaderSessions, "sessions_alt.csv": studyHeaderSessions,
		"raters.csv": studyHeaderRaters, "clip_responses.csv": studyHeaderResponses}
	got := map[string][]byte{}
	for _, file := range studyFiles {
		r := studyExportGet(t, e.env, file, nil)
		studyAssertCSV(t, r)
		got[file] = r.Body
		head, _, ok := bytes.Cut(r.Body, []byte("\n"))
		require.True(t, ok)
		require.Equal(t, headers[file], string(head)+"\n", "%s header, byte for byte", file)
		require.Equal(t, string(want.Files[file]), string(r.Body), "%s equals study.Service.Export", file)
		require.NotContains(t, string(r.Body), nm)
		require.NotContains(t, string(r.Body), "\r", "LF line endings")
		recs := studyReadCSV(t, r.Body)
		for _, rec := range recs {
			require.Len(t, rec, len(strings.Split(strings.TrimSuffix(headers[file], "\n"), ",")), "%s: %v", file, rec)
		}
	}
	// 8 enrolled, P-004 left out for trust: 7 rows; P-001 (form A): LL 12, 10 test clips × 6 = 60,
	// pre 6, post 7, late 0.6 s at 40 km/h, 60 + 120 + 60 s, 1 tap/s, age_ok 1, no retake.
	sess := studyReadCSV(t, got["sessions.csv"])
	require.Len(t, sess, 8)
	require.Equal(t, []string{"P-001", "12", "60", "6", "7", "0.6", "40", "240", "1", "1", ""}, sess[1])
	alt := studyReadCSV(t, got["sessions_alt.csv"])
	require.Equal(t, []string{"P-001", "12", "54", "5.4", "6.3", "0.6", "40", "240", "1", "1", ""}, alt[1])
	raters := studyReadCSV(t, got["raters.csv"])
	require.Len(t, raters, 16)
	require.Equal(t, []string{"KL-0001", "12", "12.2"}, raters[1])
	responses := studyReadCSV(t, got["clip_responses.csv"])
	require.Len(t, responses, 1+7*15, "15 clips for each of the 7 exported participants")
	require.Equal(t, []string{"P-001", "A", "KL-0001", "B1", "test", "6", "5.4", "12.6", "2", "rvfc", "0.9"}, responses[1])

	// frozen_at before every session leaves only the headers.
	r = studyExportGet(t, e.env, "sessions.csv", url.Values{"frozen_at": {e.clock.Now().Add(-2 * time.Hour).Format(time.RFC3339)}})
	studyAssertCSV(t, r)
	require.Equal(t, studyHeaderSessions, string(r.Body))

	// Unsigned or wrongly signed: 401; an unknown file name: 404.
	bad, _ := http.NewRequest(http.MethodGet, e.srv.URL+"/internal/study/exports/sessions.csv", nil)
	bad.Header.Set("Authorization", "Bearer "+e.cfg.InternalBearerTokens[0])
	res, err := http.DefaultClient.Do(bad)
	require.NoError(t, err)
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	ur := resp{Status: res.StatusCode, Header: res.Header, Body: body}
	assertProblem(t, ur, http.StatusUnauthorized, "UNAUTHENTICATED")
	assertContract(t, "GET", studyExportPath, ur)
	nf := studyExportGet(t, e.env, "names.csv", nil)
	assertProblem(t, nf, http.StatusNotFound, "")
	assertContract(t, "GET", studyExportPath, nf)
}

func TestExport_RunsNazarStatsUnmodified(t *testing.T) {
	if testing.Short() {
		t.Skip("runs node field-kit/nazar_stats.mjs; skipped under -short")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH")
	}
	f := newStudyFixture(t, studyDefaultParts())
	e := f.e
	root := repoRootDir(t)
	script := filepath.Join("field-kit", "nazar_stats.mjs")
	before, err := os.ReadFile(filepath.Join(root, script))
	require.NoError(t, err)
	sum := sha256.Sum256(before)

	dir := t.TempDir()
	for _, file := range studyFiles {
		r := studyExportGet(t, e.env, file, nil)
		studyAssertCSV(t, r)
		require.NoError(t, os.WriteFile(filepath.Join(dir, file), r.Body, 0o600))
	}
	run := func(files ...string) string {
		args := []string{script}
		for _, f := range files {
			args = append(args, filepath.Join(dir, f))
		}
		cmd := exec.Command(node, args...)
		cmd.Dir = root
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		require.NoErrorf(t, err, "nazar_stats.mjs: %s", stderr.String())
		return string(out)
	}
	out := run("sessions.csv", "raters.csv")
	t.Logf("nazar_stats.mjs:\n%s", out)
	st, err := study.ParseScriptOutput(out)
	require.NoError(t, err)

	ex, err := e.app.P2.Study.Export(context.Background(), "JK")
	require.NoError(t, err)
	// 7 rows written (P-004 dropped for trust); the script drops P-006 (4 taps/s) and P-007 (< 60 s).
	require.Equal(t, 7, ex.Summary.Rows)
	require.Equal(t, ex.Summary.Rows, st.Of)
	require.Equal(t, 5, ex.Summary.KeptByScript)
	require.Equal(t, ex.Summary.KeptByScript, st.N)
	require.True(t, st.HasH4)
	require.Equal(t, ex.Summary.RaterRows, st.H4Clips)
	require.Equal(t, 15, st.H4Clips)
	// Below 60/100 among the kept five: P-002 (40), P-005 (30), P-008 (20).
	require.Equal(t, 3, st.BelowK)

	alt, err := study.ParseScriptOutput(run("sessions_alt.csv"))
	require.NoError(t, err)
	require.Equal(t, st.N, alt.N)
	require.Equal(t, st.Of, alt.Of)

	after, err := os.ReadFile(filepath.Join(root, script))
	require.NoError(t, err)
	require.True(t, bytes.Equal(before, after), "nazar_stats.mjs must not change")

	// stats.field_study_publish accepts this output against the same data, and API-71 serves it.
	_, err = e.app.P2.Study.Steps()["stats.field_study_publish"](context.Background(), map[string]any{"tenant": "JK", "stdout": out,
		"script_sha256": hex.EncodeToString(sum[:]), "prereg_commit": "4f9c2e1"})
	require.NoError(t, err)
	r := e.client().do("GET", "/v1/stats/public", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/stats/public", r)
	nazar := r.json(t)["nazar"].(map[string]any)
	require.EqualValues(t, st.N, nazar["participants"])
	require.Equal(t, "published", nazar["status"])
	require.Equal(t, hex.EncodeToString(sum[:]), nazar["script_sha256"])
	require.InDelta(t, *st.BelowPct/100, nazar["below_kerala_60_pct"], 1e-9)
}

func TestTrustBelow06_Excluded(t *testing.T) {
	f := newStudyFixture(t, studyDefaultParts()[:5])
	for _, file := range []string{"sessions.csv", "sessions_alt.csv", "clip_responses.csv"} {
		r := studyExportGet(t, f.e.env, file, nil)
		studyAssertCSV(t, r)
		ids := map[string]bool{}
		for _, rec := range studyReadCSV(t, r.Body)[1:] {
			ids[rec[0]] = true
		}
		require.False(t, ids["P-004"], "%s holds the trust 0.5 session", file)
		require.True(t, ids["P-005"], "%s lost the trust 0.6 session", file)
		require.True(t, ids["P-001"], file)
	}
	ex, err := f.e.app.P2.Study.Export(context.Background(), "JK")
	require.NoError(t, err)
	require.Equal(t, []string{"P-004"}, ex.Summary.ExcludedLowTrust)
}

// ---- enrolment ------------------------------------------------------------------------------

// studyCountingStore counts every study.Store call (a declined enrolment must make none).
type studyCountingStore struct {
	study.Store
	n *atomic.Int64
}

func (s studyCountingStore) NextSeq(ctx context.Context, tenant string) (int, error) {
	s.n.Add(1)
	return s.Store.NextSeq(ctx, tenant)
}

func (s studyCountingStore) InsertParticipant(ctx context.Context, p *study.Participant) error {
	s.n.Add(1)
	return s.Store.InsertParticipant(ctx, p)
}

func (s studyCountingStore) UpdateParticipant(ctx context.Context, p *study.Participant) error {
	s.n.Add(1)
	return s.Store.UpdateParticipant(ctx, p)
}

func (s studyCountingStore) GetParticipant(ctx context.Context, tenant, code string) (*study.Participant, error) {
	s.n.Add(1)
	return s.Store.GetParticipant(ctx, tenant, code)
}

func (s studyCountingStore) ParticipantsByApplicant(ctx context.Context, tenant string, applicant uuid.UUID) ([]*study.Participant, error) {
	s.n.Add(1)
	return s.Store.ParticipantsByApplicant(ctx, tenant, applicant)
}

func (s studyCountingStore) Participants(ctx context.Context, tenant string) ([]*study.Participant, error) {
	s.n.Add(1)
	return s.Store.Participants(ctx, tenant)
}

func (s studyCountingStore) Sessions(ctx context.Context, tenant string) ([]*study.Session, error) {
	s.n.Add(1)
	return s.Store.Sessions(ctx, tenant)
}

func (s studyCountingStore) FormBlocks(ctx context.Context, tenant string) (*study.Blocks, error) {
	s.n.Add(1)
	return s.Store.FormBlocks(ctx, tenant)
}

func (s studyCountingStore) SavePublicStats(ctx context.Context, tenant string, st *study.PublicStats) error {
	s.n.Add(1)
	return s.Store.SavePublicStats(ctx, tenant, st)
}

type studyCountingConsents struct {
	study.Consents
	n *atomic.Int64
}

func (c studyCountingConsents) ActiveConsent(ctx context.Context, tenant string, applicant uuid.UUID, purpose string) (uuid.UUID, bool, error) {
	c.n.Add(1)
	return c.Consents.ActiveConsent(ctx, tenant, applicant, purpose)
}

func TestDeclinedConsent_NothingStored(t *testing.T) {
	e := newP2Env(t)
	var calls atomic.Int64
	svc := e.app.P2.Study
	svc.Store = studyCountingStore{Store: svc.Store, n: &calls}
	svc.Consents = studyCountingConsents{Consents: svc.Consents, n: &calls}
	zero := map[string]int{"study.nazar_arrivals": 0, "study.nazar_participants": 0, "study.form_blocks": 0, "study.public_stats": 0,
		"privacy.consent_artefacts": 0}

	// "No thanks": the web makes no call; a client that still sends consent_given:false is refused
	// (the field is not part of StudyEnrolmentCreate) before any study read.
	c := e.deviceClient()
	declined := studyOKBody()
	declined["consent_given"] = false
	r := c.do("POST", studyEnrolPath, declined, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertContract(t, "POST", studyEnrolPath, r)
	// Under 18 (age_ok false or missing): 422, nothing read.
	under := studyOKBody()
	under["age_ok"] = false
	r = c.do("POST", studyEnrolPath, under, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertContract(t, "POST", studyEnrolPath, r)
	require.Equal(t, "/age_ok", r.json(t)["errors"].([]any)[0].(map[string]any)["pointer"])
	missing := studyOKBody()
	delete(missing, "age_ok")
	r = c.do("POST", studyEnrolPath, missing, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	require.Zero(t, calls.Load(), "a declined or under-18 enrolment reads nothing")
	require.Equal(t, zero, studyTableCounts(t, e.env))

	// Without the field_study consent artefact: 403 CONSENT_REQUIRED and nothing written.
	r = c.do("POST", studyEnrolPath, studyOKBody(), idem())
	assertProblem(t, r, http.StatusForbidden, "CONSENT_REQUIRED")
	assertContract(t, "POST", studyEnrolPath, r)
	require.Equal(t, zero, studyTableCounts(t, e.env))

	// With a consent recorded, an under-18 answer still stores nothing and leaves the consent as it was.
	c2 := e.deviceClient()
	cid := studyGrantConsent(t, c2)
	counts := studyTableCounts(t, e.env)
	calls.Store(0)
	r = c2.do("POST", studyEnrolPath, under, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	require.Zero(t, calls.Load())
	require.Equal(t, counts, studyTableCounts(t, e.env))
	require.Equal(t, 1, counts["privacy.consent_artefacts"])
	r = c2.do("GET", "/v1/me/consents", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Contains(t, string(r.Body), cid)
	require.Contains(t, string(r.Body), `"active"`)
}

func TestStudyEnrol_FormsRepeatAndConsentID(t *testing.T) {
	e := newP2Env(t)
	c1 := e.deviceClient()
	cid := studyGrantConsent(t, c1)

	// A consent_id that is not this session's active field_study consent: 422, nothing stored.
	body := studyOKBody()
	body["consent_id"] = ids.Encode(ids.Consent, ids.New())
	r := c1.do("POST", studyEnrolPath, body, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertContract(t, "POST", studyEnrolPath, r)

	body["consent_id"] = cid
	r = c1.do("POST", studyEnrolPath, body, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", studyEnrolPath, r)
	first := r.json(t)
	require.Equal(t, "P-001", first["participant_code"])
	require.Equal(t, "A", first["form"])
	require.Equal(t, "field_test", first["cohort"])
	require.Equal(t, false, first["ai_debrief"])
	phases := first["phases"].([]any)
	require.Len(t, phases, 4)
	require.Equal(t, map[string]any{"phase": "test", "game_id": "nazar", "item_count": float64(10)}, phases[1])

	// The same session enrolling again: 200 with the same participant.
	r = c1.do("POST", studyEnrolPath, studyOKBody(), idem())
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", studyEnrolPath, r)
	require.Equal(t, "P-001", r.json(t)["participant_code"])

	// Arrival order rotates the forms A → B → C.
	_, second := studyEnrolOK(t, e.env)
	_, third := studyEnrolOK(t, e.env)
	require.Equal(t, []any{"P-002", "B"}, []any{second["participant_code"], second["form"]})
	require.Equal(t, []any{"P-003", "C"}, []any{third["participant_code"], third["form"]})

	// A retake is a new participant with retake_of; an unknown or someone else's code is 422.
	retake := studyOKBody()
	retake["retake_of"] = "P-001"
	r = c1.do("POST", studyEnrolPath, retake, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", studyEnrolPath, r)
	require.Equal(t, "P-004", r.json(t)["participant_code"])
	retake["retake_of"] = "P-002"
	r = c1.do("POST", studyEnrolPath, retake, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertContract(t, "POST", studyEnrolPath, r)

	// An invalid band: 422.
	bad := studyOKBody()
	bad["age_band"] = "16_17"
	r = c1.do("POST", studyEnrolPath, bad, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")

	// No session at all: 401.
	r = e.client().do("POST", studyEnrolPath, studyOKBody(), nil)
	assertProblem(t, r, http.StatusUnauthorized, "UNAUTHENTICATED")
}

// ---- near-miss ------------------------------------------------------------------------------

func studyNearMissText(t *testing.T, e *env, code string) *string {
	t.Helper()
	var s *string
	require.NoError(t, e.app.DB.System(context.Background(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT near_miss_text FROM study.nazar_participants WHERE participant_code = $1`, code).Scan(&s)
	}))
	return s
}

func TestStudyNearMiss_ScannedAndOwned(t *testing.T) {
	e := newP2Env(t)
	c, out := studyEnrolOK(t, e.env)
	code := out["participant_code"].(string)
	path := "/v1/study/nazar/enrolments/" + code + "/near-miss"

	r := c.do("POST", path, map[string]any{"text": "A truck reversed out of a lane without looking", "language": "en"}, idem())
	require.Equalf(t, http.StatusNoContent, r.Status, "%s", r.Body)
	assertContract(t, "POST", studyNearPath, r)
	require.Equal(t, "A truck reversed out of a lane without looking", *studyNearMissText(t, e.env, code))

	// Each identifier is refused with 422 PROHIBITED_FIELD and the stored line stays as it was.
	for _, text := range []string{
		"Call me on 9876543210, a bus cut me off",
		"JK02AB1234 came from the wrong side",
		"Mr. Sharma ki gaadi ne takkar maari",
		"My name is Kabir and a dog ran out",
		"Near house no 42 a child ran out",
		"Licence JK02 20190001234 was taken",
	} {
		r = c.do("POST", path, map[string]any{"text": text}, idem())
		assertProblem(t, r, http.StatusUnprocessableEntity, "PROHIBITED_FIELD")
		assertContract(t, "POST", studyNearPath, r)
		require.Equal(t, "A truck reversed out of a lane without looking", *studyNearMissText(t, e.env, code), text)
	}
	// What the web masks passes; ordinary numbers are not mistaken for plates.
	r = c.do("POST", path, map[string]any{"text": "[vehicle number] cut in from the left in 2 min 300 m before the light"}, idem())
	require.Equalf(t, http.StatusNoContent, r.Status, "%s", r.Body)
	// Longer than 140 characters: 422.
	r = c.do("POST", path, map[string]any{"text": strings.Repeat("a", 141)}, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertContract(t, "POST", studyNearPath, r)

	// Another session, an unknown code or a malformed code: 404.
	other, _ := studyEnrolOK(t, e.env)
	r = other.do("POST", path, map[string]any{"text": "A cow walked onto the road"}, idem())
	assertProblem(t, r, http.StatusNotFound, "NOT_FOUND")
	assertContract(t, "POST", studyNearPath, r)
	r = c.do("POST", "/v1/study/nazar/enrolments/P-999/near-miss", map[string]any{"text": "A cow walked onto the road"}, idem())
	assertProblem(t, r, http.StatusNotFound, "NOT_FOUND")
	r = c.do("POST", "/v1/study/nazar/enrolments/Q-1/near-miss", map[string]any{"text": "A cow walked onto the road"}, idem())
	assertProblem(t, r, http.StatusNotFound, "NOT_FOUND")
}

// ---- API-71 ---------------------------------------------------------------------------------

func TestStudyPublicStats_MergesPublishedRow(t *testing.T) {
	e := newP2Env(t)
	studyEnrolOK(t, e.env)
	sha := strings.Repeat("4e", 32)
	require.NoError(t, e.app.P2.StudyStore.SavePublicStats(context.Background(), "JK", &study.PublicStats{AsOf: e.clock.Now(),
		Payload: map[string]any{"participants": 7, "sample": "convenience", "status": "published", "below_kerala_60_pct": 0.43,
			"ci95": []any{0.21, 0.68}, "r_ll_quiz_vs_nazar": 0.12, "r_ci95": []any{-0.6, 0.73}, "median_late_s": 1.2},
		ScriptSHA256: sha, PreregCommit: "9f3c2e1"}))
	r := e.client().do("GET", "/v1/stats/public", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/stats/public", r)
	body := r.json(t)
	nazar := body["nazar"].(map[string]any)
	require.EqualValues(t, 7, nazar["participants"])
	require.Equal(t, "published", nazar["status"])
	require.Equal(t, sha, nazar["script_sha256"])
	require.Equal(t, "9f3c2e1", nazar["prereg_hash"])
	require.InDelta(t, 0.43, nazar["below_kerala_60_pct"], 1e-9)
	counters := body["counters"].(map[string]any)
	require.EqualValues(t, 1, counters["nazar_participants"], "live enrolment count")
	require.Contains(t, counters, "game_sessions_counted")
}
