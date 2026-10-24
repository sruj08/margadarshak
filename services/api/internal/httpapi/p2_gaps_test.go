package httpapi_test

// P2 gap closures: the sample clip seed serves a Nazar mock, the difficulty staircase adapts after
// verified practice, and the study export never hands nazar_stats.mjs a header-only raters.csv.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/games"
	"github.com/sruj08/margadarshak/services/api/internal/seed"
	"github.com/sruj08/margadarshak/services/api/internal/study"
)

// A fresh API with the dev/demo seed serves a Nazar mock (201) from the labelled sample clips,
// their placeholder media downloads with the advertised sha256, and the mock completes (200,
// checked) against the seeded scoring documents.
func TestSeededSampleClipsServeANazarMock(t *testing.T) {
	e := newP2Env(t)
	ctx := context.Background()
	// Before the seed there is nothing to play.
	assertProblem(t, e.deviceClient().do("POST", "/v1/games/nazar/sessions", map[string]any{"mode": "mock"}, nil), http.StatusConflict, "NO_UNSEEN_CLIPS")
	rep, err := seed.SampleClips(ctx, seed.ClipDeps{DB: e.app.DB, Objects: e.media, Now: e.clock.Now()})
	require.NoError(t, err)
	require.Equal(t, 11, rep.Created)

	c := e.deviceClient()
	start := gamesStart(t, c, "nazar", map[string]any{"mode": "mock"})
	refs := gamesItemRefs(t, start)
	require.Len(t, refs, 10)
	require.NotContains(t, refs, "clip:KL-0011@1", "the quiet sample clip is never mock-eligible")
	sampleRefs := map[string]bool{}
	for _, id := range seed.SampleClipIDs() {
		sampleRefs["clip:"+id+"@1"] = true
	}
	for _, it := range start["items"].([]any) {
		item := it.(map[string]any)
		require.Truef(t, sampleRefs[item["item_ref"].(string)], "%v is a sample clip", item["item_ref"])
		require.Equal(t, "ai_generated", item["origin"])
		require.EqualValues(t, seed.SampleClipPlaceholderBytes, item["bytes"])
	}
	first := start["items"].([]any)[0].(map[string]any)
	// Served by the env's mock object store (the harness swaps it in after the router mounted the
	// original store's /mock/media/ handler, so it is called directly here).
	rec := httptest.NewRecorder()
	e.media.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, first["asset_url"].(string), nil))
	require.Equalf(t, http.StatusOK, rec.Code, "%s", rec.Body.String())
	body := rec.Body.Bytes()
	require.Len(t, body, seed.SampleClipPlaceholderBytes)
	sum := sha256.Sum256(body)
	require.Equal(t, first["sha256"], hex.EncodeToString(sum[:]))

	// A new learner's first practice (staircase level 1) is dealt hazard clips with their windows.
	practice := gamesStart(t, e.deviceClient(), "nazar", map[string]any{"mode": "practice"})
	for _, it := range practice["items"].([]any) {
		reveal := it.(map[string]any)["reveal"].(map[string]any)
		require.NotEmpty(t, reveal["hazards"], "practice item %v", it.(map[string]any)["item_ref"])
	}

	sid := start["session_id"].(string)
	r := gamesComplete(c, sid, clientPreview(72, 100), fakeReplay("5eed"))
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", gamesCompletePath, r)
	out := r.json(t)
	require.Equal(t, true, out["server_checked"])
	var status string
	e.sessionColumn(sid, "status", &status)
	require.Equal(t, "checked", status)
	req := e.compute.lastVerify()
	require.NotNil(t, req.Content)
	require.Len(t, req.Content.Items, 10, "every clip's scoring document goes to /verify inline")
	var doc struct {
		ClipID  string `json:"clipId"`
		Hazards []any  `json:"hazards"`
	}
	require.NoError(t, json.Unmarshal(req.Content.Items[0], &doc))
	require.True(t, sampleRefs["clip:"+doc.ClipID+"@1"])
	require.NotEmpty(t, doc.Hazards)
	// The cached scoring documents equal what /verify received.
	var cached []byte
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT doc FROM content.clip_scoring WHERE clip_id = $1 AND version = 1`, doc.ClipID).Scan(&cached)
	}))
	require.JSONEq(t, string(req.Content.Items[0]), string(cached))
}

// GAME_SDK §7 through the API: verified Nazar practice moves the staircase (clip marks >= 6 is an
// item pass); a mock never does; the next practice is dealt at the new level.
func TestStaircaseAfterVerifiedPractice(t *testing.T) {
	e := newP2Env(t)
	e.seedPublishedClips(30, 1, 2, 3, 4, 5)
	c := e.deviceClient()
	staircase := func() (level, streak int) {
		require.NoError(t, e.app.DB.System(context.Background(), func(tx pgx.Tx) error {
			err := tx.QueryRow(context.Background(), `SELECT level, streak_pass FROM game.staircase WHERE game_id = 'nazar' AND skill_id = 'nazar'`).
				Scan(&level, &streak)
			if err == pgx.ErrNoRows {
				level, streak = 0, 0
				return nil
			}
			return err
		}))
		return level, streak
	}
	practise := func(marks []float64, digest string) map[string]any {
		e.compute.set(func(f *p2Compute) { f.clipMarks = marks })
		start := gamesStart(t, c, "nazar", map[string]any{"mode": "practice"})
		r := gamesComplete(c, start["session_id"].(string), clientPreview(72, 3), fakeReplay(digest))
		require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
		return start
	}
	// Three clips at 10, 6, 10 marks: pass, pass (level 2), pass (streak 1).
	practise([]float64{10, 6, 10}, "a1")
	l, s := staircase()
	require.Equal(t, [2]int{2, 1}, [2]int{l, s})
	next := practise([]float64{5}, "a2") // dealt at level 2; three fails: 2 → 1, then floored
	require.EqualValues(t, 2, next["ctx"].(map[string]any)["difficulty"])
	l, s = staircase()
	require.Equal(t, [2]int{1, 0}, [2]int{l, s})
	want := 2
	for range 3 {
		want, _ = games.StaircaseStep(want, 0, false)
	}
	require.Equal(t, want, l)

	// A Nazar mock never adapts.
	e.compute.set(func(f *p2Compute) { f.clipMarks = []float64{10} })
	sid := gamesStart(t, c, "nazar", map[string]any{"mode": "mock"})["session_id"].(string)
	require.Equal(t, http.StatusOK, gamesComplete(c, sid, clientPreview(72, 100), fakeReplay("a3")).Status)
	l2, s2 := staircase()
	require.Equal(t, [2]int{l, s}, [2]int{l2, s2})
}

// When no study clip has two agreeing raters, raters.csv has no data row: study.export_csv
// leaves it out (null, listed in `omitted`), the script then runs on sessions.csv alone exactly as
// the nightly_stats task calls it, and stats.field_study_publish accepts the task's payload. A
// header-only raters.csv is what the pre-registered script cannot take (median of nothing).
func TestStudyExportWithoutRaterAgreement(t *testing.T) {
	f := newStudyFixture(t, studyDefaultParts())
	e := f.e
	ctx := context.Background()
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE content.clips SET agreement = NULL`)
		return err
	}))
	// The Workflows task sends {stats_id, as_of}; the tenant defaults to TENANT_DEFAULT.
	r := e.step("study.export_csv", map[string]any{"stats_id": "nightly-1", "as_of": "2026-10-24T03:00:00Z"})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/internal/job-steps/{step}", r)
	res := r.json(t)
	files := res["files"].(map[string]any)
	require.Contains(t, files, "raters.csv")
	require.Nil(t, files["raters.csv"], "a header-only raters.csv is never handed out")
	require.Equal(t, []any{"raters.csv"}, res["omitted"])
	require.EqualValues(t, 0, res["summary"].(map[string]any)["rater_rows"])
	require.NotContains(t, res["sha256"].(map[string]any), "raters.csv")
	require.Equal(t, "JK", res["tenant"])

	if testing.Short() {
		t.Skip("runs node field-kit/nazar_stats.mjs; skipped under -short")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH")
	}
	root := repoRootDir(t)
	script := filepath.Join(root, "field-kit", "nazar_stats.mjs")
	raw, err := os.ReadFile(script)
	require.NoError(t, err)
	scriptSum := sha256.Sum256(raw)
	dir := t.TempDir()
	for name, v := range files {
		if s, ok := v.(string); ok {
			require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(s), 0o600))
		}
	}
	run := func(args ...string) (string, error) {
		cmd := exec.Command(node, append([]string{script}, args...)...)
		cmd.Dir = dir
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil {
			return string(out), fmt.Errorf("%w: %s", err, stderr.String())
		}
		return string(out), nil
	}
	_, err = os.Stat(filepath.Join(dir, "raters.csv"))
	require.True(t, os.IsNotExist(err))
	stdout, err := run("sessions.csv") // nightly-stats.ts: no raters argument without rater rows
	require.NoError(t, err)
	st, err := study.ParseScriptOutput(stdout)
	require.NoError(t, err)
	require.False(t, st.HasH4)
	require.Equal(t, 5, st.N)
	// Why the file is left out: the unchanged script fails on a header-only raters.csv.
	require.NoError(t, os.WriteFile(filepath.Join(dir, "raters_header_only.csv"), []byte(studyHeaderRaters), 0o600))
	_, err = run("sessions.csv", "raters_header_only.csv")
	require.Error(t, err)

	// stats.field_study_publish with the nightly_stats payload shape.
	r = e.step("stats.field_study_publish", map[string]any{"stats_id": "nightly-1", "as_of": "2026-10-24T03:00:00Z",
		"script":        map[string]any{"name": "nazar_stats.mjs", "sha256": hex.EncodeToString(scriptSum[:])},
		"inputs_sha256": res["sha256"], "primary": map[string]any{"argv": []string{"sessions.csv"}, "stdout": stdout}, "sensitivity": nil})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Equal(t, true, r.json(t)["published"])
	pub := e.client().do("GET", "/v1/stats/public", nil, nil)
	require.Equal(t, http.StatusOK, pub.Status)
	nazar := pub.json(t)["nazar"].(map[string]any)
	require.EqualValues(t, 5, nazar["participants"])
	require.NotContains(t, nazar, "h4_median_onset_delta_s")
}

// Inline nightly_stats (JOB_RUNNER=inline) runs the export and never publishes: the
// pre-registered script runs only in the Render Workflows task.
func TestInlineNightlyStatsExportsOnly(t *testing.T) {
	e := newEnv(t)
	r := e.internal("/internal/jobs/nightly_stats", map[string]any{"args": map[string]any{"stats_id": "inline-1"}}, nil)
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	var result []byte
	require.Eventually(t, func() bool {
		var st string
		_ = e.app.DB.Pool.QueryRow(context.Background(), `SELECT status, coalesce(result::text, '') FROM ops.job_runs WHERE job = 'nightly_stats'`).
			Scan(&st, &result)
		return st == "succeeded"
	}, 5*time.Second, 20*time.Millisecond)
	var out map[string]any
	require.NoError(t, json.Unmarshal(result, &out))
	require.Equal(t, "exported", out["status"])
	require.Equal(t, false, out["published"])
	require.True(t, strings.Contains(out["reason"].(string), "Render Workflows"))
	require.True(t, slices.Contains(toStrings(out["omitted"]), "raters.csv"))
	require.Equal(t, 0, e.count(`SELECT count(*) FROM study.public_stats`))
}

func toStrings(v any) []string {
	var out []string
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

// The real verifier's /clip/manifests (clip-pipeline mockEligibility and invariants) agrees with
// the seed: after a manifest rebuild the ten sample hazard clips stay mock-eligible and the quiet
// one stays out, so a curator publishing a clip never knocks the demo bank out of the mock.
func TestSampleClipsSurviveAManifestRebuild(t *testing.T) {
	e := newP2Env(t)
	e.useRealCompute(t)
	ctx := context.Background()
	_, err := seed.SampleClips(ctx, seed.ClipDeps{DB: e.app.DB, Objects: e.media, Now: e.clock.Now()})
	require.NoError(t, err)
	before := e.count(`SELECT count(*) FROM content.clips WHERE mock_eligible`)
	require.Equal(t, 10, before)
	_, err = e.app.P2.Clips.RebuildManifest(ctx)
	require.NoError(t, err)
	require.Equal(t, 10, e.count(`SELECT count(*) FROM content.clips WHERE mock_eligible AND clip_id <> 'KL-0011'`))
	require.Equal(t, 0, e.count(`SELECT count(*) FROM content.clips WHERE mock_eligible AND clip_id = 'KL-0011'`))
}
