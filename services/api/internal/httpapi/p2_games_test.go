package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// ---- helpers ----------------------------------------------------------------------------------

const (
	gamesStartPath    = "/v1/games/{gameId}/sessions"
	gamesCompletePath = "/v1/games/sessions/{sessionId}/complete"
	gamesReplayPath   = "/v1/games/sessions/{sessionId}/replay"
	gamesClipsPath    = "/v1/nazar/clips"
)

// gamesStart starts a session and checks the 201 against the spec.
func gamesStart(t *testing.T, c *client, game string, body map[string]any) map[string]any {
	t.Helper()
	r := c.do("POST", "/v1/games/"+game+"/sessions", body, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", gamesStartPath, r)
	return r.json(t)
}

func gamesComplete(c *client, sid string, client, replay map[string]any) resp {
	return c.do("POST", "/v1/games/sessions/"+sid+"/complete", map[string]any{"client_result": client, "replay": replay}, idem())
}

// gamesItemRefs returns the item refs of a GameSessionStart body.
func gamesItemRefs(t *testing.T, start map[string]any) []string {
	t.Helper()
	var out []string
	for _, it := range start["items"].([]any) {
		out = append(out, it.(map[string]any)["item_ref"].(string))
	}
	return out
}

// gamesClipIndex is i for clip:KL-000(i+1)@1 (seedPublishedClips numbering).
func gamesClipIndex(t *testing.T, ref string) int {
	t.Helper()
	n, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(ref, "clip:KL-"), "@1"))
	require.NoError(t, err, ref)
	return n - 1
}

func gamesFlags(m map[string]any) []string {
	var out []string
	for _, f := range m["integrity"].(map[string]any)["flags"].([]any) {
		out = append(out, f.(string))
	}
	return out
}

// gamesCompleted starts a Nazar mock and completes it with the given preview; it returns the
// session ID and the checked 200 body.
func gamesCompleted(t *testing.T, c *client, preview map[string]any, digest string) (string, map[string]any) {
	t.Helper()
	sid := gamesStart(t, c, "nazar", map[string]any{"mode": "mock"})["session_id"].(string)
	r := gamesComplete(c, sid, preview, fakeReplay(digest))
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", gamesCompletePath, r)
	return sid, r.json(t)
}

// ---- API-34 -----------------------------------------------------------------------------------

func TestAPI34_NazarMockTenUnseenClips(t *testing.T) {
	e := newP2Env(t)
	difficulties := []int{2, 3, 4}
	e.seedPublishedClips(22, difficulties...)
	c := e.deviceClient()

	seen := map[string]bool{}
	for round := 0; round < 2; round++ {
		start := gamesStart(t, c, "nazar", map[string]any{"mode": "mock", "a11y_modes": []string{"no_audio"}, "device_class": "low"})
		require.Equal(t, "mock", start["mode"])
		require.Equal(t, "server", start["seed_origin"])
		require.Equal(t, "game.familiarisation_not_certification", start["label_key"])
		ctx := start["ctx"].(map[string]any)
		require.Equal(t, start["session_id"], ctx["sid"])
		require.Equal(t, "low", ctx["deviceClass"])
		refs := gamesItemRefs(t, start)
		require.Len(t, refs, 10)
		perDifficulty := map[int]int{}
		for i, ref := range refs {
			require.Falsef(t, seen[ref], "round %d repeats %s", round, ref)
			seen[ref] = true
			perDifficulty[difficulties[gamesClipIndex(t, ref)%3]]++
			item := start["items"].([]any)[i].(map[string]any)
			require.NotContains(t, item, "reveal", "a mock never carries windows (D-05)")
			require.NotEmpty(t, item["asset_url"])
			require.Equal(t, "clip", item["kind"])
		}
		for d := 2; d <= 4; d++ {
			require.GreaterOrEqualf(t, perDifficulty[d], 3, "spread over curator difficulty 2-4: %v", perDifficulty)
		}
		require.NotContains(t, string(gamesMustJSON(t, start)), "aMs")
	}
	require.Len(t, seen, 20)

	// Two unseen clips are left: a third mock is refused, practice still works.
	r := c.do("POST", "/v1/games/nazar/sessions", map[string]any{"mode": "mock"}, nil)
	assertProblem(t, r, http.StatusConflict, "NO_UNSEEN_CLIPS")
	assertContract(t, "POST", gamesStartPath, r)
	gamesStart(t, c, "nazar", map[string]any{"mode": "practice"})

	// An unknown game is 404; a mode a game does not offer is 422.
	assertProblem(t, c.do("POST", "/v1/games/chess/sessions", map[string]any{"mode": "mock"}, nil), http.StatusNotFound, "NOT_FOUND")
	r = c.do("POST", "/v1/games/stopping_distance/sessions", map[string]any{"mode": "mock"}, nil)
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertContract(t, "POST", gamesStartPath, r)
	// Pair mode is refused by the games package until squads share a seed.
	assertProblem(t, c.do("POST", "/v1/games/nazar/sessions", map[string]any{"mode": "pair"}, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	// Strict body.
	assertProblem(t, c.do("POST", "/v1/games/nazar/sessions", map[string]any{"mode": "mock", "seed": 1}, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
}

func TestAPI34_MinorNoParentConsent_403(t *testing.T) {
	e := newP2Env(t)
	e.seedPublishedClips(6)
	c := e.userClient("parent.games@example.com")
	r := c.do("POST", "/v1/me/family-members", map[string]any{"relation": "child", "label": "Rahul", "dob": "2009-03-14", "dob_precision": "day"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	member := r.json(t)["member_id"].(string)

	r = c.do("POST", "/v1/games/nazar/sessions", map[string]any{"mode": "practice", "family_member_id": member}, nil)
	assertProblem(t, r, http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	assertContract(t, "POST", gamesStartPath, r)
	assertProblem(t, c.do("POST", "/v1/games/nazar/sessions", map[string]any{"mode": "practice", "family_member_id": "fam_01JB8ZQZZZZZZZ"}, nil),
		http.StatusNotFound, "NOT_FOUND")

	r = c.do("POST", "/v1/me/family-members/"+member+"/parental-consent", map[string]any{"action": "grant", "notice_version": "notice-2026.10.23-hi"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)

	// With consent: a learn session for the minor, with the windows revealed (D-05).
	start := gamesStart(t, c, "nazar", map[string]any{"mode": "learn", "family_member_id": member, "locale": "hi"})
	require.Equal(t, "u18", start["ctx"].(map[string]any)["userBand"])
	require.Equal(t, "hi", start["ctx"].(map[string]any)["locale"])
	for _, it := range start["items"].([]any) {
		rev := it.(map[string]any)["reveal"].(map[string]any)
		h := rev["hazards"].([]any)[0].(map[string]any)
		require.Equal(t, "bus_stop_pedestrian", h["hazard_type"])
		a, b := h["a_ms"].(float64), h["b_ms"].(float64)
		require.Equal(t, a+(b-a)/5, h["full_marks_until_ms"])
		require.Equal(t, "Feet at the bus front", h["cue"].(map[string]any)["en"])
		require.EqualValues(t, 40, rev["speed_kmh_est"])
	}
	// Pair mode for a minor needs the parent's pair_mode extra.
	r = c.do("POST", "/v1/games/nazar/sessions", map[string]any{"mode": "pair", "family_member_id": member}, nil)
	assertProblem(t, r, http.StatusForbidden, "PARENT_CONSENT_REQUIRED")

	// The session belongs to the member; the parent completes it from the same account.
	sid := start["session_id"].(string)
	r = gamesComplete(c, sid, clientPreview(72, 2), fakeReplay("7"))
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", gamesCompletePath, r)
	// Another device cannot see it.
	assertProblem(t, gamesComplete(e.deviceClient(), sid, clientPreview(72, 2), fakeReplay("7")), http.StatusNotFound, "NOT_FOUND")
}

// ---- API-35 -----------------------------------------------------------------------------------

func TestAPI35_TamperedClientScoreOverwritten(t *testing.T) {
	e := newP2Env(t)
	e.seedPublishedClips(22) // two mocks
	c := e.deviceClient()
	sid, body := gamesCompleted(t, c, clientPreview(99, 100), "1")

	require.Equal(t, true, body["server_checked"])
	require.Equal(t, false, body["provisional"])
	require.EqualValues(t, 72, body["server_score_pct"])
	require.EqualValues(t, 99, body["client_score_pct"])
	require.EqualValues(t, 72, body["score"].(map[string]any)["pct"])
	require.Equal(t, true, body["mismatch"])
	require.Contains(t, gamesFlags(body), "INT_REPLAY_MISMATCH")
	require.EqualValues(t, 72, body["result"].(map[string]any)["score"].(map[string]any)["pct"])
	require.Nil(t, body["xp_awarded"], "anonymous device: XP stays on the device (D-03)")
	nz := body["nazar"].(map[string]any)
	require.Equal(t, "kerala_5band", nz["rule"])
	require.Len(t, nz["analysis"], 10)
	require.NotContains(t, string(gamesMustJSON(t, nz)), "a_ms")
	// A mismatch is never an accusation: trust 0.7 still counts (threshold 0.6).
	require.Equal(t, true, nz["score_eligible"])

	var server, client float64
	e.sessionColumn(sid, "server_score_pct", &server)
	e.sessionColumn(sid, "client_score_pct", &client)
	require.Equal(t, 72.0, server)
	require.Equal(t, 99.0, client)
	var flags []string
	e.sessionColumn(sid, "integrity_flags", &flags)
	require.Contains(t, flags, "INT_REPLAY_MISMATCH")

	// A mock preview with score.max == 0 is never compared (no INT_REPLAY_MISMATCH).
	_, body = gamesCompleted(t, c, clientPreview(0, 0), "2")
	require.Equal(t, false, body["mismatch"])
	require.NotContains(t, gamesFlags(body), "INT_REPLAY_MISMATCH")
	require.NotContains(t, body, "client_score_pct")
	require.Empty(t, e.compute.lastVerify().ClientResult)
}

func TestAPI35_SameDigestIdempotent_DifferentDigest409(t *testing.T) {
	e := newP2Env(t)
	e.seedPublishedClips(12)
	c := e.deviceClient()
	sid, first := gamesCompleted(t, c, clientPreview(72, 100), "a1")
	require.Equal(t, 1, e.compute.verifyCount())

	r := gamesComplete(c, sid, clientPreview(72, 100), fakeReplay("a1"))
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", gamesCompletePath, r)
	again := r.json(t)
	require.Equal(t, first["server_score_pct"], again["server_score_pct"])
	require.Equal(t, first["score"], again["score"])
	require.Equal(t, first["nazar_score"], again["nazar_score"])
	require.Equal(t, 1, e.compute.verifyCount(), "the same digest is not verified twice")

	r = gamesComplete(c, sid, clientPreview(72, 100), fakeReplay("b2"))
	assertProblem(t, r, http.StatusConflict, "SESSION_ALREADY_COMPLETED")
	assertContract(t, "POST", gamesCompletePath, r)

	// Envelope errors: a malformed digest is 422, an oversized replay 413, a wrong seed 422.
	sid2 := gamesStart(t, c, "nazar", map[string]any{"mode": "practice"})["session_id"].(string)
	bad := fakeReplay("c3")
	bad["digest"] = "md5:x"
	assertProblem(t, gamesComplete(c, sid2, clientPreview(72, 100), bad), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	big := fakeReplay("c3")
	big["inputs"] = strings.Repeat("A", 524_292)
	r = gamesComplete(c, sid2, map[string]any{"score": map[string]any{"pct": 1}}, big)
	assertProblem(t, r, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE")
	assertContract(t, "POST", gamesCompletePath, r)
	seeded := fakeReplay("c3")
	seeded["seed"] = -1
	assertProblem(t, gamesComplete(c, sid2, clientPreview(72, 100), seeded), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertProblem(t, gamesComplete(c, "0192f7a8-6b1c-7d2e-9f30-4a5b6c7d8e9f", clientPreview(72, 100), fakeReplay("c3")), http.StatusNotFound, "NOT_FOUND")

	// A verifier rejection voids the session: 422 REPLAY_REJECTED with the slug.
	e.compute.set(func(f *p2Compute) { f.verifyErr = gamesRejected{} })
	r = gamesComplete(c, sid2, clientPreview(72, 100), fakeReplay("c3"))
	assertProblem(t, r, http.StatusUnprocessableEntity, "REPLAY_REJECTED")
	require.Contains(t, r.json(t)["detail"], "digest-mismatch")
	assertProblem(t, gamesComplete(c, sid2, clientPreview(72, 100), fakeReplay("c3")), http.StatusConflict, "SESSION_VOIDED")
}

// gamesRejected is a verifier 4xx with a client-fault problem type.
type gamesRejected struct{}

func (gamesRejected) Error() string       { return "compute: request rejected: digest-mismatch" }
func (gamesRejected) ProblemType() string { return "digest-mismatch" }
func (gamesRejected) Is(t error) bool     { return t == ports.ErrComputeInvalid }

func gamesVerifierDown(t *testing.T) (*p2Env, *client, string) {
	t.Helper()
	e := newP2Env(t)
	e.seedPublishedClips(12)
	c := e.deviceClient()
	e.compute.set(func(f *p2Compute) { f.verifyErr = fmt.Errorf("%w: connection refused", ports.ErrComputeUnavailable) })
	sid, body := gamesCompleted(t, c, clientPreview(80, 100), "d4")
	require.Equal(t, false, body["server_checked"])
	require.Equal(t, true, body["provisional"])
	require.Nil(t, body["server_score_pct"])
	require.Contains(t, body, "server_score_pct")
	require.EqualValues(t, 80, body["client_score_pct"])
	require.EqualValues(t, 80, body["score"].(map[string]any)["pct"])
	require.Equal(t, true, body["integrity"].(map[string]any)["provisional"])
	require.Nil(t, body["xp_awarded"])
	require.NotContains(t, body, "result")
	require.NotContains(t, body, "nazar_score")
	nz := body["nazar"].(map[string]any)
	require.Equal(t, false, nz["score_eligible"])
	require.Contains(t, nz["ineligible_reasons"], "provisional")
	var status string
	e.sessionColumn(sid, "status", &status)
	require.Equal(t, "pending_verification", status)
	return e, c, sid
}

func TestAPI35_VerifierDown_PendingVerification(t *testing.T) {
	e, c, sid := gamesVerifierDown(t)
	// The same digest answers the stored provisional outcome; nothing counted.
	r := gamesComplete(c, sid, clientPreview(80, 100), fakeReplay("d4"))
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", gamesCompletePath, r)
	require.Equal(t, true, r.json(t)["provisional"])
	require.Zero(t, e.count(`SELECT count(*) FROM ops.counters WHERE name = 'game_sessions_counted'`))

	// The replay endpoint shows the windows without analysis while pending.
	r = c.do("GET", "/v1/games/sessions/"+sid+"/replay", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", gamesReplayPath, r)
	rep := r.json(t)
	require.Equal(t, "pending_verification", rep["status"])
	for _, cl := range rep["clips"].([]any) {
		require.NotContains(t, cl.(map[string]any), "analysis")
	}
}

func TestReplayPending_Overwrites(t *testing.T) {
	e, c, sid := gamesVerifierDown(t)
	before := e.compute.verifyCount()
	e.compute.set(func(f *p2Compute) { f.verifyErr = nil })

	r := e.step("sessions.replay_pending", map[string]any{})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.EqualValues(t, 1, r.json(t)["verified"])
	require.Equal(t, before+1, e.compute.verifyCount())

	var status string
	var server float64
	e.sessionColumn(sid, "status", &status)
	e.sessionColumn(sid, "server_score_pct", &server)
	require.Equal(t, "checked", status)
	require.Equal(t, 72.0, server)
	require.Equal(t, 1, e.count(`SELECT value::int FROM ops.counters WHERE name = 'game_sessions_counted'`))

	// A second run finds nothing; the session is counted once.
	r = e.step("sessions.replay_pending", map[string]any{})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.EqualValues(t, 0, r.json(t)["verified"])
	require.Equal(t, before+1, e.compute.verifyCount())
	require.Equal(t, 1, e.count(`SELECT value::int FROM ops.counters WHERE name = 'game_sessions_counted'`))

	// The client's retry with the same digest now gets the server result.
	r = gamesComplete(c, sid, clientPreview(80, 100), fakeReplay("d4"))
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", gamesCompletePath, r)
	body := r.json(t)
	require.Equal(t, true, body["server_checked"])
	require.EqualValues(t, 72, body["server_score_pct"])
	require.Equal(t, true, body["mismatch"])
}

// EC-18: a clip the subject had seen before the mock started (an exposure recorded elsewhere,
// e.g. another device) is sent to the verifier as hints.seenClip and the mock never counts for
// the Nazar Score.
func TestEC18_SeenClipHintFlag(t *testing.T) {
	e := newP2Env(t)
	e.seedPublishedClips(22)
	c := e.deviceClient()

	// Control: a clean mock counts.
	_, body := gamesCompleted(t, c, clientPreview(72, 100), "e5")
	require.Equal(t, false, *e.compute.lastVerify().Hints.SeenClip)
	require.Equal(t, true, body["nazar"].(map[string]any)["score_eligible"])
	require.Empty(t, body["nazar"].(map[string]any)["ineligible_reasons"])
	require.Equal(t, map[string]any{"score": 72.0, "mocks_counted": 1.0}, body["nazar_score"])

	start := gamesStart(t, c, "nazar", map[string]any{"mode": "mock"})
	sid := start["session_id"].(string)
	clip := strings.TrimSuffix(strings.TrimPrefix(gamesItemRefs(t, start)[3], "clip:"), "@1")
	require.NoError(t, e.app.DB.System(context.Background(), func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(), `UPDATE game.clip_exposures SET first_seen_at = first_seen_at - interval '1 hour', via = 'practice'
			WHERE clip_id = $1`, clip)
		return err
	}))
	r := gamesComplete(c, sid, clientPreview(72, 100), fakeReplay("f6"))
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", gamesCompletePath, r)
	body = r.json(t)
	hints := e.compute.lastVerify().Hints
	require.NotNil(t, hints.SeenClip)
	require.True(t, *hints.SeenClip)
	require.Contains(t, gamesFlags(body), "INT_SEEN_CLIP")
	nz := body["nazar"].(map[string]any)
	require.Equal(t, false, nz["score_eligible"])
	require.Contains(t, nz["ineligible_reasons"], "seen_clip")
	require.Equal(t, map[string]any{"score": 72.0, "mocks_counted": 1.0}, body["nazar_score"], "the seen-clip mock is not counted")
	var elig map[string]bool
	e.sessionColumn(sid, "eligibility", &elig)
	require.False(t, elig["nazar_score"])
	require.True(t, elig["xp"])
}

// ---- Replay endpoint ----------------------------------------------------------------------------

func TestGamesReplayEndpoint(t *testing.T) {
	e := newP2Env(t)
	e.seedPublishedClips(12)
	c := e.deviceClient()
	start := gamesStart(t, c, "nazar", map[string]any{"mode": "mock"})
	sid := start["session_id"].(string)

	r := c.do("GET", "/v1/games/sessions/"+sid+"/replay", nil, nil)
	assertProblem(t, r, http.StatusConflict, "SESSION_NOT_COMPLETED")
	assertContract(t, "GET", gamesReplayPath, r)

	r = gamesComplete(c, sid, clientPreview(72, 100), fakeReplay("9"))
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)

	r = c.do("GET", "/v1/games/sessions/"+sid+"/replay", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", gamesReplayPath, r)
	rep := r.json(t)
	require.Equal(t, "verified", rep["status"])
	clipsOut := rep["clips"].([]any)
	require.Len(t, clipsOut, 10)
	refs := gamesItemRefs(t, start)
	for i, cl := range clipsOut {
		m := cl.(map[string]any)
		require.Equal(t, refs[i], m["item_ref"])
		require.EqualValues(t, i+1, m["ordinal"])
		require.EqualValues(t, 30000, m["duration_ms"])
		require.NotEmpty(t, m["asset_url"])
		w := m["windows"].([]any)[0].(map[string]any)
		require.EqualValues(t, 12000+100*gamesClipIndex(t, refs[i]), w["a_ms"])
		an := m["analysis"].(map[string]any)
		require.Equal(t, refs[i], an["item_ref"])
		require.EqualValues(t, 5, an["marks"])
	}
	require.Equal(t, 10, e.count(`SELECT count(*) FROM game.clip_exposures`), "replay exposures add no row for clips already seen")

	// Another device: 404. Another game: 404.
	assertProblem(t, e.deviceClient().do("GET", "/v1/games/sessions/"+sid+"/replay", nil, nil), http.StatusNotFound, "NOT_FOUND")
	sd := gamesStart(t, c, "stopping_distance", map[string]any{"mode": "practice"})
	require.Empty(t, sd["items"].([]any)[0].(map[string]any)["reveal"])
	assertProblem(t, c.do("GET", "/v1/games/sessions/"+sd["session_id"].(string)+"/replay", nil, nil), http.StatusNotFound, "NOT_FOUND")
}

// ---- API-37 -----------------------------------------------------------------------------------

func TestAPI37_NoHazardWindows(t *testing.T) {
	e := newP2Env(t)
	e.seedPublishedClips(5)

	r := e.client().do("GET", "/v1/nazar/clips?state=JK", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", gamesClipsPath, r)
	require.Contains(t, r.Header.Get("Cache-Control"), "public")
	require.NotEmpty(t, r.Header.Get("ETag"))
	page := r.json(t)
	require.Len(t, page["items"], 5)
	gamesNoWindowKeys(t, "$", page)
	for _, word := range []string{"hazard", "window", "aMs", "a_ms", "quiet", "cue", "speed", "captured", "bus_stop"} {
		require.NotContains(t, strings.ToLower(string(r.Body)), strings.ToLower(word))
	}
	first := page["items"].([]any)[0].(map[string]any)
	require.Equal(t, "clip:KL-0001@1", first["item_ref"])
	require.EqualValues(t, 1_840_000, first["total_bytes"])
	require.Equal(t, "360p", first["media"].([]any)[0].(map[string]any)["res"])

	// exclude_seen with a session leaves out the clips a learn session revealed.
	c := e.deviceClient()
	learn := gamesStart(t, c, "nazar", map[string]any{"mode": "learn"})
	revealed := gamesItemRefs(t, learn)
	require.Len(t, revealed, 2)
	r = c.do("GET", "/v1/nazar/clips?exclude_seen=true", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", gamesClipsPath, r)
	require.Contains(t, r.Header.Get("Cache-Control"), "private")
	var left []string
	for _, it := range r.json(t)["items"].([]any) {
		left = append(left, it.(map[string]any)["item_ref"].(string))
	}
	require.Len(t, left, 3)
	for _, ref := range revealed {
		require.NotContains(t, left, ref)
	}
	// Without a session exclude_seen is ignored; paging works.
	r = e.client().do("GET", "/v1/nazar/clips?exclude_seen=true&limit=2&resolution=480p", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", gamesClipsPath, r)
	p := r.json(t)
	require.Len(t, p["items"], 2)
	require.Equal(t, "KL-0002", p["next_cursor"])
	require.Equal(t, "480p", p["items"].([]any)[0].(map[string]any)["media"].([]any)[0].(map[string]any)["res"])
}

// gamesNoWindowKeys fails on any key that names a window or a hazard.
func gamesNoWindowKeys(t *testing.T, path string, v any) {
	t.Helper()
	switch x := v.(type) {
	case map[string]any:
		for k, sub := range x {
			lk := strings.ToLower(k)
			for _, bad := range []string{"window", "hazard", "a_ms", "b_ms", "quiet", "cue", "speed", "onset"} {
				require.NotContainsf(t, lk, bad, "%s.%s leaks hazard data", path, k)
			}
			gamesNoWindowKeys(t, path+"."+k, sub)
		}
	case []any:
		for i, sub := range x {
			gamesNoWindowKeys(t, fmt.Sprintf("%s[%d]", path, i), sub)
		}
	}
}

func gamesMustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return b
}

// ---- Drift test: the spec's game-core schemas equal packages/game-core/schema ------------------

// TestOpenAPISessionResultMatchesGameCore compares the spec's game-core wire schemas, $refs
// resolved, with packages/game-core/schema/*.json after the conversions of decision D-01:
// anyOf [X, {type: null}] -> type [X, "null"]; the uuid and UTC patterns next to format uuid /
// date-time dropped; annotations dropped; enums and required lists sorted; const -> enum;
// anyOf [number, string(maxLength n), boolean] -> type [...] + maxLength n.
func TestOpenAPISessionResultMatchesGameCore(t *testing.T) {
	root := repoRootDir(t)
	raw, err := os.ReadFile(filepath.Join(root, "api", "openapi.yaml"))
	require.NoError(t, err)
	var y any
	require.NoError(t, yaml.Unmarshal(raw, &y))
	spec := gamesJSONRoundTrip(t, y).(map[string]any)
	schemas := spec["components"].(map[string]any)["schemas"].(map[string]any)

	for _, name := range []string{"SessionResult", "SessionContext", "ReplayPackage", "Finding", "Evidence", "IntegrityReport",
		"HazardType", "A11yMode", "GameId", "IntegrityFlag"} {
		t.Run(name, func(t *testing.T) {
			s, ok := schemas[name]
			require.Truef(t, ok, "%s not in the spec", name)
			fromSpec := gamesDriftNorm(gamesDriftResolve(t, schemas, s, 0), false)
			coreRaw, err := os.ReadFile(filepath.Join(root, "packages", "game-core", "schema", name+".json"))
			require.NoError(t, err)
			var core any
			require.NoError(t, json.Unmarshal(coreRaw, &core))
			fromCore := gamesDriftNorm(core, false)
			var diffs []string
			gamesDriftDiff(fromSpec, fromCore, "$", &diffs)
			require.Emptyf(t, diffs, "%s drifts from game-core:\n%s", name, strings.Join(diffs, "\n"))
			// The comparison is not vacuous: every schema keeps a type, and a dropped required
			// property or enum value is reported.
			m := fromCore.(map[string]any)
			require.Contains(t, m, "type")
			for _, key := range []string{"required", "enum"} {
				if list, ok := m[key].([]any); ok {
					mutated := make(map[string]any, len(m))
					for k, v := range m {
						mutated[k] = v
					}
					mutated[key] = list[1:]
					var d []string
					gamesDriftDiff(fromSpec, mutated, "$", &d)
					require.NotEmpty(t, d)
				}
			}
		})
	}
}

func gamesJSONRoundTrip(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	var out any
	require.NoError(t, json.Unmarshal(b, &out))
	return out
}

func gamesDriftResolve(t *testing.T, schemas map[string]any, v any, depth int) any {
	t.Helper()
	require.Less(t, depth, 64, "recursive $ref")
	switch x := v.(type) {
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = gamesDriftResolve(t, schemas, e, depth+1)
		}
		return out
	case map[string]any:
		if ref, ok := x["$ref"].(string); ok {
			name := ref[strings.LastIndex(ref, "/")+1:]
			target, ok := schemas[name]
			require.Truef(t, ok, "unresolved $ref %s", ref)
			return gamesDriftResolve(t, schemas, target, depth+1)
		}
		out := make(map[string]any, len(x))
		for k, e := range x {
			out[k] = gamesDriftResolve(t, schemas, e, depth+1)
		}
		return out
	}
	return v
}

func gamesDriftString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	case nil:
		return "null"
	}
	return fmt.Sprint(v)
}

// gamesDriftNorm ports tools/drift.mjs norm(): inProps marks a properties map, whose keys are
// property names (never annotations), each value normalised as a schema.
func gamesDriftNorm(v any, inProps bool) any {
	switch x := v.(type) {
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = gamesDriftNorm(e, false)
		}
		return out
	case map[string]any:
		o := make(map[string]any, len(x))
		for k, e := range x {
			o[k] = e
		}
		if inProps {
			out := make(map[string]any, len(o))
			for k, e := range o {
				out[k] = gamesDriftNorm(e, false)
			}
			return out
		}
		for _, k := range []string{"$schema", "$id", "title", "description", "examples", "example"} {
			delete(o, k)
		}
		if any2, ok := o["anyOf"].([]any); ok && len(any2) == 2 {
			var other map[string]any
			hasNull := false
			for _, a := range any2 {
				m, _ := a.(map[string]any)
				if m != nil && m["type"] == "null" {
					hasNull = true
				} else if m != nil {
					other = m
				}
			}
			if hasNull && other != nil {
				delete(o, "anyOf")
				for k, e := range other {
					o[k] = e
				}
				o["type"] = []any{other["type"], "null"}
			}
		}
		if o["format"] == "uuid" || o["format"] == "date-time" {
			delete(o, "pattern")
		}
		if any2, ok := o["anyOf"].([]any); ok {
			simple := true
			for _, a := range any2 {
				m, _ := a.(map[string]any)
				if _, isStr := m["type"].(string); m == nil || !isStr {
					simple = false
					break
				}
				for k := range m {
					if k != "type" && k != "maxLength" {
						simple = false
					}
				}
			}
			if simple {
				types := make([]any, len(any2))
				var ml any
				for i, a := range any2 {
					m := a.(map[string]any)
					types[i] = m["type"]
					if v, ok := m["maxLength"]; ok && ml == nil {
						ml = v
					}
				}
				o["type"] = types
				if ml != nil {
					o["maxLength"] = ml
				}
				delete(o, "anyOf")
			}
		}
		if enum, ok := o["enum"].([]any); ok {
			o["enum"] = gamesDriftSorted(enum)
		}
		if req, ok := o["required"].([]any); ok {
			o["required"] = gamesDriftSorted(req)
		}
		if c, ok := o["const"]; ok {
			o["enum"] = []any{gamesDriftString(c)}
			delete(o, "const")
		}
		out := make(map[string]any, len(o))
		for k, e := range o {
			out[k] = gamesDriftNorm(e, k == "properties")
		}
		return out
	}
	return v
}

func gamesDriftSorted(xs []any) []any {
	ss := make([]string, len(xs))
	for i, x := range xs {
		ss[i] = gamesDriftString(x)
	}
	sort.Strings(ss)
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

func gamesDriftDiff(a, b any, path string, out *[]string) {
	if reflect.DeepEqual(a, b) {
		return
	}
	am, aok := a.(map[string]any)
	bm, bok := b.(map[string]any)
	if aok && bok {
		keys := map[string]bool{}
		for k := range am {
			keys[k] = true
		}
		for k := range bm {
			keys[k] = true
		}
		sorted := make([]string, 0, len(keys))
		for k := range keys {
			sorted = append(sorted, k)
		}
		slices.Sort(sorted)
		for _, k := range sorted {
			gamesDriftDiff(am[k], bm[k], path+"."+k, out)
		}
		return
	}
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	*out = append(*out, fmt.Sprintf("%s: spec=%s game-core=%s", path, ja, jb))
}
