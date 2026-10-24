package httpapi_test

// P2 clip admin (API-55) and the W08 internal endpoints: a clip registered over HTTP, moved past
// the TypeScript media steps (raw → transcoded → blurred) through the store, then driven through
// its statuses by the job steps W08 / clip_finalize call (POST /internal/job-steps/{step}).

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/compute"
	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

const (
	clipsSHA360 = "0a41551a747a818a9b09d2b969b7fcc5836d2a872f504d49b84d5fcea15e36b4"
	clipsSHA480 = "ee9452ab28e35f7353e840067320359376e518eb21c43d91a0a860356db7125b"
	clipsRawKey = "raw/2026-10-24/kochi_0042.mp4"
	clipsMezKey = "intermediate/kochi_0042/mezzanine.mp4"
)

// clipsUseRealCompute is e.useRealCompute with request signatures stamped from the wall clock
// (the verifier rejects signatures from the fixed test clock as stale); bodies keep the test clock.
func (e *p2Env) clipsUseRealCompute(t *testing.T) {
	t.Helper()
	e.useRealCompute(t)
	url := sharedVerifier(t, e.cfg.ScoreVerifierSecret)
	c := compute.New(url, e.cfg.ScoreVerifierSecret, 10*time.Second, servertime.System{})
	e.compute.set(func(f *p2Compute) { f.real = c })
}

// clipsInternal is e.internal one second later: the HMAC replay cache refuses a repeated
// signature, and a signature covers only the timestamp and the body.
func (e *p2Env) clipsInternal(path string, body any) resp {
	e.clock.Advance(time.Second)
	return e.internal(path, body, nil)
}

// clipsStep runs one job step as a Render Workflows task would.
func (e *p2Env) clipsStep(t *testing.T, step string, args map[string]any) map[string]any {
	t.Helper()
	r := e.clipsInternal("/internal/job-steps/"+step, map[string]any{"run_id": "trn-clips-test", "args": args})
	require.Equalf(t, http.StatusOK, r.Status, "%s: %s", step, r.Body)
	assertContract(t, "POST", "/internal/job-steps/{step}", r)
	return r.json(t)
}

// clipsRegisterOpen registers a 30 s clip over HTTP, completes the media steps in the store
// (renditions, raw and mezzanine objects) and opens it for review (status proposed).
func (e *p2Env) clipsRegisterOpen(t *testing.T) (*client, string) {
	t.Helper()
	ctx := context.Background()
	curator := e.adminClient("curator_01")
	consent := ids.Encode(ids.Consent, uuid.MustParse(e.clipConsentID()))
	r := curator.do("POST", "/v1/admin/clips", map[string]any{
		"raw_object_key": clipsRawKey, "state": "JK", "filmed_by": "passenger", "city": "Kochi", "road_type": "urban_arterial",
		"time_of_day": "day", "weather": "clear", "pov": "2W", "captured_month": "2026-10", "speed_kmh_est": 40,
		"speed_source": "rider_log", "licence": "CC-BY-4.0", "contributor_consent_id": consent, "duration_ms": 30000,
	}, idem())
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/admin/clips", r)
	body := r.json(t)
	require.Equal(t, "raw", body["status"])
	id := body["clip_id"].(string)
	require.Equal(t, "JK-0001", id)

	// The TypeScript media steps: transcode, blur (two renditions), leaving the raw and a mezzanine.
	require.NoError(t, e.media.Put(ctx, clipsRawKey, []byte("raw footage"), "video/mp4"))
	require.NoError(t, e.media.Put(ctx, clipsMezKey, []byte("mezzanine"), "video/mp4"))
	st := store.NewClipsStore(e.app.DB)
	c, err := st.GetClip(ctx, id, 1)
	require.NoError(t, err)
	require.True(t, clips.IsAllowedTransition(c.Status, clips.StatusTranscoded))
	c.Status, c.Doc.Status = clips.StatusTranscoded, clips.StatusTranscoded
	require.NoError(t, st.UpdateClip(ctx, c))
	c.Doc.Media = []clips.MediaEntry{{Res: "360p", Bytes: 1_840_000, SHA256: clipsSHA360}, {Res: "480p", Bytes: 2_900_000, SHA256: clipsSHA480}}
	c.IntermediateKeys = []string{clipsMezKey}
	c.Status, c.Doc.Status = clips.StatusBlurred, clips.StatusBlurred
	require.NoError(t, st.UpdateClip(ctx, c))

	out := e.clipsStep(t, "clip.open_review", map[string]any{"clip_id": id, "version": 1, "flash_passed": true})
	require.Equal(t, "proposed", out["status"])
	return curator, id
}

func clipsMark(hazard string, a, b int, cue string) map[string]any {
	m := map[string]any{"hazard_type": hazard, "a_ms": a, "b_ms": b}
	if cue != "" {
		m["cue"] = cue
	}
	return m
}

func clipsRate(c *client, id string, marks ...map[string]any) resp {
	if marks == nil {
		marks = []map[string]any{}
	}
	return c.do("POST", "/v1/admin/clips/"+id+"/ratings", map[string]any{"version": 1, "decision": "windows_set", "marks": marks}, idem())
}

func clipsGet(t *testing.T, c *client, id string) map[string]any {
	t.Helper()
	r := c.do("GET", "/v1/admin/clips/"+id, nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/admin/clips/{clipId}", r)
	return r.json(t)
}

func clipsAudit(t *testing.T, c *client, id string, checked int) map[string]any {
	t.Helper()
	r := c.do("POST", "/v1/admin/clips/"+id+"/blur-audit", map[string]any{"version": 1, "rendition_sha256": clipsSHA480,
		"frames_total": 900, "frames_checked": checked, "misses": 0, "miss_frames": []any{}}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/admin/clips/{clipId}/blur-audit", r)
	return r.json(t)
}

func TestPublish_RequiresTwoRatingsAnd100PctBlurAudit(t *testing.T) {
	e := newP2Env(t)
	e.clipsUseRealCompute(t)
	curator, id := e.clipsRegisterOpen(t)
	args := map[string]any{"clip_id": id, "version": 1, "round": 1}

	r1 := e.adminClient("rater_01")
	r := clipsRate(r1, id, clipsMark("bus_stop_pedestrian", 12000, 16500, "feet at the bus front"))
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/admin/clips/{clipId}/ratings", r)

	// One rating: the clip is still proposed, so publishing is refused and agreement waits.
	r = curator.do("POST", "/v1/admin/clips/"+id+"/publish", nil, idem())
	assertProblem(t, r, http.StatusConflict, "CLIP_INVALID_TRANSITION")
	require.Contains(t, r.json(t)["detail"], "two_ratings")
	require.Equal(t, "await_ratings", e.clipsStep(t, "clip.agreement", args)["next"])

	r2 := e.adminClient("rater_02")
	r = clipsRate(r2, id, clipsMark("bus_stop_pedestrian", 12300, 16700, ""))
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/admin/clips/{clipId}/ratings", r)

	// Two agreeing ratings: the real /clip/agreement accepts them and the clip is rated.
	out := e.clipsStep(t, "clip.agreement", args)
	require.Equal(t, true, out["accepted"], "%v", out)
	require.Equal(t, "rated", out["status"])
	v := clipsGet(t, curator, id)
	require.Equal(t, "rated", v["status"])
	require.Len(t, v["hazards"], 1)
	require.Equal(t, true, v["agreement"].(map[string]any)["accepted"])

	// Cue texts and the curator difficulty, so only the blur audit stands between rated and published.
	r = curator.do("PUT", "/v1/admin/clips/"+id+"/cue-texts", map[string]any{"version": 1,
		"cues": map[string]any{"h1": map[string]any{"en": "Feet at the bus front", "hi": "बस के आगे पैर"}}, "difficulty_curator": 3}, idem())
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "PUT", "/v1/admin/clips/{clipId}/cue-texts", r)

	// A 99 % audit (891 of 900 frames) is stored but does not pass: publish is refused.
	a := clipsAudit(t, curator, id, 891)
	require.Equal(t, false, a["blur_audit"].(map[string]any)["passed"])
	r = curator.do("POST", "/v1/admin/clips/"+id+"/publish", nil, idem())
	assertProblem(t, r, http.StatusConflict, "CLIP_INVALID_TRANSITION")
	require.Equal(t, "blur_audit", r.json(t)["detail"], "the detail lists the failing check IDs for the curator UI")
	require.Equal(t, false, e.clipsStep(t, "clip.blur_audit_check", args)["passed"])

	// 100 % of frames, 0 misses: the audit passes and the curator can publish.
	a = clipsAudit(t, curator, id, 900)
	require.Equal(t, true, a["blur_audit"].(map[string]any)["passed"])
	require.Equal(t, true, e.clipsStep(t, "clip.blur_audit_check", args)["passed"])
	r = curator.do("POST", "/v1/admin/clips/"+id+"/publish", nil, idem())
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/admin/clips/{clipId}/publish", r)
	require.Equal(t, "published", r.json(t)["status"])

	// Publishing again is idempotent; the board counts it.
	r = curator.do("POST", "/v1/admin/clips/"+id+"/publish", nil, idem())
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	r = curator.do("GET", "/v1/admin/clips?status=published", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/admin/clips", r)
	require.Len(t, r.json(t)["items"], 1)
}

func TestRater_BlindUntilSaved(t *testing.T) {
	e := newP2Env(t)
	curator, id := e.clipsRegisterOpen(t)
	r1, r2 := e.adminClient("rater_01"), e.adminClient("rater_02")

	r := clipsRate(r1, id, clipsMark("truck_left_turn", 17800, 22400, "lorry indicator on at the junction mouth"))
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/admin/clips/{clipId}/ratings", r)
	require.Equal(t, "rater-01", r.json(t)["rater"])

	// rater_01 sees only their own rating.
	v := clipsGet(t, r1, id)
	require.Equal(t, false, v["ratings_visible"])
	require.Equal(t, false, v["proposals_visible"])
	require.EqualValues(t, 1, v["rating_count"])
	require.NotContains(t, v, "ratings")
	require.NotContains(t, v, "agreement")
	require.Equal(t, "rater-01", v["my_rating"].(map[string]any)["rater"])

	// rater_02 knows a rating exists, but not whose it is or its marks.
	raw := r2.do("GET", "/v1/admin/clips/"+id, nil, nil)
	require.Equalf(t, http.StatusOK, raw.Status, "%s", raw.Body)
	assertContract(t, "GET", "/v1/admin/clips/{clipId}", raw)
	v = raw.json(t)
	require.EqualValues(t, 1, v["rating_count"])
	require.Equal(t, false, v["ratings_visible"])
	require.NotContains(t, v, "my_rating")
	require.NotContains(t, v, "ratings")
	for _, leak := range []string{"rater-01", "17800", "lorry indicator"} {
		require.NotContains(t, string(raw.Body), leak)
	}
	// So does the curator: nobody sees marks before both are saved.
	require.NotContains(t, clipsGet(t, curator, id), "ratings")

	// A rater rates once.
	assertProblem(t, clipsRate(r1, id, clipsMark("truck_left_turn", 17000, 22000, "")), http.StatusConflict, "RATING_ALREADY_SUBMITTED")

	r = clipsRate(r2, id, clipsMark("truck_left_turn", 18200, 22600, ""))
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)

	// Both saved: rater_01 now sees rater_02's marks.
	v = clipsGet(t, r1, id)
	require.Equal(t, true, v["ratings_visible"])
	require.EqualValues(t, 2, v["rating_count"])
	ratings := v["ratings"].([]any)
	require.Len(t, ratings, 2)
	var other map[string]any
	for _, x := range ratings {
		if m := x.(map[string]any); m["rater"] == "rater-02" {
			other = m
		}
	}
	require.NotNil(t, other)
	require.EqualValues(t, 18200, other["marks"].([]any)[0].(map[string]any)["a_ms"])

	// A third rater is refused: disagreements go to adjudication.
	assertProblem(t, clipsRate(e.adminClient("rater_03"), id), http.StatusConflict, "RATING_ALREADY_SUBMITTED")
}

func TestRawDeletion_Logged(t *testing.T) {
	e := newP2Env(t)
	curator, id := e.clipsRegisterOpen(t)
	ctx := context.Background()
	args := map[string]any{"clip_id": id, "version": 1}

	// No passing audit and inside the 7-day limit: nothing is deleted.
	out := e.clipsStep(t, "clip.delete_raw", args)
	require.Equal(t, false, out["deleted"])
	_, err := e.media.Head(ctx, clipsRawKey)
	require.NoError(t, err)

	// A synthetic review is only for AI clips; a filmed clip needs the blur audit.
	r := curator.do("POST", "/v1/admin/clips/"+id+"/synthetic-review", map[string]any{"version": 1, "checks": map[string]any{
		"no_real_likeness": true, "no_readable_plates": true, "no_real_brands": true, "no_collision_or_injury": true, "hazard_visible": true}}, idem())
	assertProblem(t, r, http.StatusConflict, "CLIP_INVALID_TRANSITION")

	clipsAudit(t, curator, id, 900)
	out = e.clipsStep(t, "clip.delete_raw", args)
	require.Equal(t, true, out["deleted"], "%v", out)
	require.Equal(t, "audit_passed", out["reason"])
	require.Equal(t, true, out["on_time"])
	for _, k := range []string{clipsRawKey, clipsMezKey} {
		_, err := e.media.Head(ctx, k)
		require.Errorf(t, err, "%s should be gone", k)
	}

	// The deletion log holds object keys only, never URLs.
	var keys []string
	var reason string
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT object_keys, reason FROM content.clip_raw_deletions WHERE clip_id = $1 AND version = 1`, id).
			Scan(&keys, &reason)
	}))
	require.Equal(t, "audit_passed", reason)
	require.ElementsMatch(t, []string{clipsRawKey, clipsMezKey}, keys)
	for _, k := range keys {
		require.NotContains(t, k, "://")
		require.NotContains(t, k, "?")
	}

	// Replays return the logged record; the admin view shows when it happened.
	require.Equal(t, true, e.clipsStep(t, "clip.delete_raw", args)["replayed"])
	require.NotNil(t, clipsGet(t, curator, id)["raw_deleted_at"])
}

// W08: review tasks (idempotent per stage, resume URL sealed), claimed by the rater who saves,
// and the two outcomes: review_timeout leaves the clip proposed, rejected retires it.
func TestClipsReviewTasks_W08(t *testing.T) {
	e := newP2Env(t)
	curator, id := e.clipsRegisterOpen(t)
	ctx := context.Background()

	body := map[string]any{"stage": "rater_1", "resume_url": "https://n8n.margdarshak.example/webhook-waiting/8812",
		"n8n_execution_id": "8812", "due_in_hours": 48}
	r := e.clipsInternal("/internal/clips/"+id+"/review-tasks", body)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/internal/clips/{clipId}/review-tasks", r)
	task := r.json(t)
	require.Equal(t, "open", task["status"])
	r = e.clipsInternal("/internal/clips/"+id+"/review-tasks", body)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	require.Equal(t, task["review_task_id"], r.json(t)["review_task_id"])

	// The resume URL is never stored in clear.
	var sealed []byte
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT resume_url_enc FROM content.clip_review_tasks WHERE clip_id = $1 AND stage = 'rater_1'`, id).Scan(&sealed)
	}))
	require.NotEmpty(t, sealed)
	require.NotContains(t, string(sealed), "n8n.margdarshak.example")

	// rater_01 answers the task; the task is claimed and submitted.
	r1 := e.adminClient("rater_01")
	r = r1.do("POST", "/v1/admin/clips/"+id+"/ratings", map[string]any{"version": 1, "decision": "windows_set",
		"review_task_id": task["review_task_id"], "marks": []any{clipsMark("cyclist", 5000, 9000, "")}}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	tasks := clipsGet(t, r1, id)["review_tasks"].([]any)
	require.Len(t, tasks, 1)
	require.Equal(t, "submitted", tasks[0].(map[string]any)["status"])
	require.Equal(t, "rater-01", tasks[0].(map[string]any)["assignee"])

	// rater_2 task excludes rater_01; it times out and the clip stays proposed.
	body = map[string]any{"stage": "rater_2", "resume_url": "https://n8n.margdarshak.example/webhook-waiting/8812",
		"n8n_execution_id": "8812", "exclude_rater_id": "rater-01", "blind_to_rater_1": true}
	r = e.clipsInternal("/internal/clips/"+id+"/review-tasks", body)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	r = e.clipsInternal("/internal/clips/"+id+"/status", map[string]any{"status": "review_timeout", "stage": "rater_2", "n8n_execution_id": "8812"})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/internal/clips/{clipId}/status", r)
	require.Equal(t, "proposed", r.json(t)["status"])
	require.EqualValues(t, 0, r.json(t)["open_tasks"])

	// A rejection retires the version; later admin writes are refused.
	r = e.clipsInternal("/internal/clips/"+id+"/status", map[string]any{"status": "rejected", "stage": "rater_2", "n8n_execution_id": "8812"})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Equal(t, "retired", r.json(t)["status"])
	assertProblem(t, clipsRate(e.adminClient("rater_02"), id), http.StatusConflict, "CLIP_INVALID_TRANSITION")
	r = curator.do("POST", "/v1/admin/clips/"+id+"/publish", nil, idem())
	assertProblem(t, r, http.StatusConflict, "CLIP_INVALID_TRANSITION")

	// Unknown clips are 404; a stale version is 409.
	assertProblem(t, e.internal("/internal/clips/KL-9999/review-tasks", map[string]any{"stage": "rater_1",
		"resume_url": "https://n8n.margdarshak.example/w/1", "n8n_execution_id": "1"}, nil), http.StatusNotFound, "NOT_FOUND")
	r = curator.do("POST", "/v1/admin/clips/"+id+"/blur-audit", map[string]any{"version": 2, "rendition_sha256": clipsSHA480,
		"frames_total": 900, "frames_checked": 900, "misses": 0, "miss_frames": []any{}}, idem())
	assertProblem(t, r, http.StatusConflict, "CLIP_INVALID_TRANSITION")
	require.True(t, strings.Contains(string(r.Body), "/version"))
}

// Registration errors: a non-admin is 403, a missing consent artefact is 422, a rider is refused.
func TestClipsRegister_Errors(t *testing.T) {
	e := newP2Env(t)
	curator := e.adminClient("curator_01")
	base := func() map[string]any {
		return map[string]any{"raw_object_key": clipsRawKey, "state": "JK", "filmed_by": "passenger", "city": "Kochi",
			"road_type": "urban_arterial", "time_of_day": "day", "weather": "clear", "pov": "2W", "captured_month": "2026-10",
			"speed_kmh_est": 40, "speed_source": "rider_log", "licence": "CC-BY-4.0",
			"contributor_consent_id": ids.Encode(ids.Consent, uuid.New()), "duration_ms": 30000}
	}
	assertProblem(t, curator.do("POST", "/v1/admin/clips", base(), idem()), http.StatusUnprocessableEntity, "CONSENT_REQUIRED")
	b := base()
	b["contributor_consent_id"] = e.clipConsentID()
	b["filmed_by"] = "rider"
	assertProblem(t, curator.do("POST", "/v1/admin/clips", b, idem()), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertProblem(t, e.userClient("not.admin@example.com").do("POST", "/v1/admin/clips", base(), idem()), http.StatusForbidden, "")
	assertProblem(t, curator.do("GET", "/v1/admin/clips/KL-0404", nil, nil), http.StatusNotFound, "NOT_FOUND")
}

// ADR-0013: an AI-generated clip. generateClip starts clip_generate; the task's
// clip.register_generated step creates the clip; the TypeScript transcode/render steps are
// simulated in the store; then two raters, the synthetic review (no blur audit) and publish.
func TestClipsAIGenerated_PublishWithSyntheticReview(t *testing.T) {
	e := newP2Env(t)
	e.clipsUseRealCompute(t)
	e.app.P2.Clips.ScenesPath = filepath.Join(repoRootDir(t), "content", "nazar", "scenes.json")
	ctx := context.Background()
	curator := e.adminClient("curator_01")
	gen := map[string]any{"sceneId": "SCN-001", "version": 1, "batchId": "b20261024a"}

	r := curator.do("POST", "/v1/admin/clips/generate", gen, idem())
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/admin/clips/generate", r)
	acc := r.json(t)
	require.Equal(t, "clip_generate", acc["workflow_run"].(map[string]any)["job"])
	require.NotContains(t, acc, "clip", "the task creates the clip")
	bad := map[string]any{"sceneId": "SCN-001", "version": 9, "batchId": "b20261024a"}
	assertProblem(t, curator.do("POST", "/v1/admin/clips/generate", bad, idem()), http.StatusUnprocessableEntity, "VALIDATION_FAILED")

	// clip_generate's register step (TypeScript calls it after generation and precheck).
	reg := map[string]any{"scene_id": "SCN-001", "scene_revision": 1, "batch_id": "b20261024a",
		"raw_key": "generated/SCN-001/v1/b20261024a/normalised.mp4", "raw_sha256": clipsSHA480, "raw_bytes": 9_000_000, "duration_ms": 30000,
		"facts": map[string]any{"city": "Indian metro", "tenantTags": []string{"JK", "KL"}, "roadType": "urban_arterial", "timeOfDay": "day",
			"weather": "clear", "pov": "2W", "speedKmhEst": 30, "speedSource": "scene_spec", "modules": []string{"M18"}, "origin": "ai_generated",
			"capturedMonth": "2026-10", "durationMs": 30000},
		"generation": map[string]any{"model": "gemini-omni-1.1-flash", "sceneId": "SCN-001", "promptVersion": "1.0.0", "seedOrBatchId": "b20261024a",
			"generatedAt": "2026-10", "durationMs": 30000, "extensions": 3, "synthId": true, "disclosure": "ai_generated"},
		"onset_hint": map[string]any{"approxOnsetMs": 16000, "toleranceMs": 3000, "authoritative": false, "basis": "measured"},
		"cue":        map[string]any{"en": "Feet visible under the bus front", "hi": "बस के आगे पैर"}, "hazard_type": "bus_stop_pedestrian",
		"curator_difficulty_suggestion": 2, "occlusion": true, "flash": map[string]any{"passes": true}}
	out := e.clipsStep(t, "clip.register_generated", reg)
	id := out["clip_id"].(string)
	require.Equal(t, "JK-0001", id)
	require.Equal(t, false, out["replayed"])
	require.Equal(t, id, e.clipsStep(t, "clip.register_generated", reg)["clip_id"], "a retry returns the same clip")

	// A repeat of the request now also returns the clip, with its generation facts.
	r = curator.do("POST", "/v1/admin/clips/generate", gen, idem())
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/admin/clips/generate", r)
	cl := r.json(t)["clip"].(map[string]any)
	require.Equal(t, "ai_generated", cl["origin"])
	require.Equal(t, "raw", cl["status"])
	require.Equal(t, "SCN-001", cl["scene_id"])
	require.Equal(t, "b20261024a", cl["batch_id"])
	require.EqualValues(t, 16000, cl["onset_hint"].(map[string]any)["approx_onset_ms"])

	// TypeScript transcode + render: renditions on a transcoded clip; open_review skips the blur.
	st := store.NewClipsStore(e.app.DB)
	c, err := st.GetClip(ctx, id, 1)
	require.NoError(t, err)
	require.Nil(t, c.Doc.BlurAudit)
	c.Status, c.Doc.Status = clips.StatusTranscoded, clips.StatusTranscoded
	c.Doc.Media = []clips.MediaEntry{{Res: "360p", Bytes: 1_840_000, SHA256: clipsSHA360}, {Res: "480p", Bytes: 2_900_000, SHA256: clipsSHA480}}
	require.NoError(t, st.UpdateClip(ctx, c))
	open := e.clipsStep(t, "clip.open_review", map[string]any{"clip_id": id, "version": 1, "origin": "ai_generated"})
	require.Equal(t, "proposed", open["status"])

	// No blur audit for an AI clip, ever.
	r = curator.do("POST", "/v1/admin/clips/"+id+"/blur-audit", map[string]any{"version": 1, "rendition_sha256": clipsSHA480,
		"frames_total": 900, "frames_checked": 900, "misses": 0, "miss_frames": []any{}}, idem())
	assertProblem(t, r, http.StatusConflict, "CLIP_INVALID_TRANSITION")

	// Two agreeing raters are still required.
	require.Equal(t, http.StatusCreated, clipsRate(e.adminClient("rater_01"), id, clipsMark("bus_stop_pedestrian", 16000, 21000, "feet under the bus")).Status)
	require.Equal(t, http.StatusCreated, clipsRate(e.adminClient("rater_02"), id, clipsMark("bus_stop_pedestrian", 16300, 21200, "")).Status)
	agree := e.clipsStep(t, "clip.agreement", map[string]any{"clip_id": id, "version": 1, "round": 1})
	require.Equal(t, true, agree["accepted"], "%v", agree)
	r = curator.do("PUT", "/v1/admin/clips/"+id+"/cue-texts", map[string]any{"version": 1,
		"cues": map[string]any{"h1": map[string]any{"en": "Feet visible under the bus front", "hi": "बस के आगे पैर"}}, "difficulty_curator": 2}, idem())
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)

	// Publishing waits for the synthetic review.
	r = curator.do("POST", "/v1/admin/clips/"+id+"/publish", nil, idem())
	assertProblem(t, r, http.StatusConflict, "CLIP_INVALID_TRANSITION")
	require.Equal(t, "synthetic_review", r.json(t)["detail"])

	// A failing review (a logo slipped through) is stored but does not pass.
	review := func(brands bool) resp {
		return curator.do("POST", "/v1/admin/clips/"+id+"/synthetic-review", map[string]any{"version": 1, "checks": map[string]any{
			"no_real_likeness": true, "no_readable_plates": true, "no_real_brands": brands, "no_collision_or_injury": true, "hazard_visible": true}}, idem())
	}
	r = review(false)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/admin/clips/{clipId}/synthetic-review", r)
	sr := r.json(t)["synthetic_review"].(map[string]any)
	require.Equal(t, false, sr["passed"])
	require.Equal(t, "curator-01", sr["reviewer"])
	require.Equal(t, false, e.clipsStep(t, "clip.blur_audit_check", map[string]any{"clip_id": id, "version": 1})["passed"])
	r = curator.do("POST", "/v1/admin/clips/"+id+"/publish", nil, idem())
	assertProblem(t, r, http.StatusConflict, "CLIP_INVALID_TRANSITION")

	r = review(true)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	require.Equal(t, true, r.json(t)["synthetic_review"].(map[string]any)["passed"])
	check := e.clipsStep(t, "clip.blur_audit_check", map[string]any{"clip_id": id, "version": 1})
	require.Equal(t, true, check["passed"])
	require.Equal(t, "synthetic_review", check["gate"])
	require.Equal(t, true, e.clipsStep(t, "clip.delete_raw", map[string]any{"clip_id": id, "version": 1})["skipped"], "no raw footage to delete")

	r = curator.do("POST", "/v1/admin/clips/"+id+"/publish", nil, idem())
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/admin/clips/{clipId}/publish", r)
	pub := r.json(t)
	require.Equal(t, "published", pub["status"])
	require.Nil(t, pub["blur_audit"])

	// The onset hint stays out of clip.json and the scoring document.
	c, err = st.GetClip(ctx, id, 1)
	require.NoError(t, err)
	doc, err := c.Doc.JSON()
	require.NoError(t, err)
	require.NotContains(t, string(doc), "approxOnsetMs")
	docs, err := e.app.P2.Clips.ScoringDocs(ctx, []string{"clip:" + id + "@1"})
	require.NoError(t, err)
	require.NotContains(t, string(docs[0]), "approxOnsetMs")
	origin, err := e.app.P2.Clips.Origin(ctx, "clip:"+id+"@1")
	require.NoError(t, err)
	require.Equal(t, "ai_generated", origin)
}
