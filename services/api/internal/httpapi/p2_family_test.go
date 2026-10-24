package httpapi_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// D-13 revised (persona P-07): Rahul (17) uses Margdarshak inside his parent's account. With the
// recorded parental consent he reaches learning (API-30..33) and games (API-34/35) like anyone
// else; his rows are keyed by the family member, and his SessionContext says u18. Squads and share
// cards still need the parent's separate extras.
func TestFamilyMode_RahulReachesLearningAndGames(t *testing.T) {
	e := newP2Env(t)
	e.useRealCompute(t)
	c := e.personaClient("rahul")
	r := c.do("GET", "/v1/me/family-members", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	items := r.json(t)["items"].([]any)
	require.Len(t, items, 1)
	rahul := items[0].(map[string]any)
	require.Equal(t, true, rahul["is_minor"])
	require.Equal(t, "granted", rahul["parental_consent"].(map[string]any)["status"])
	member := rahul["member_id"].(string)
	q := "?family_member_id=" + member

	// Learning.
	r = c.do("GET", "/v1/learn/modules", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	r = c.do("GET", "/v1/learn/review-queue"+q, nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/learn/review-queue", r)
	r = c.do("GET", "/v1/readiness"+q, nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/readiness", r)
	require.Equal(t, true, r.json(t)["gate"].(map[string]any)["book_anyway_visible"])

	// Games: a practice session for Rahul; the context carries the u18 band, never a DOB.
	r = c.do("POST", "/v1/games/stopping_distance/sessions", map[string]any{"mode": "practice", "family_member_id": member}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/games/{gameId}/sessions", r)
	start := r.json(t)
	require.Equal(t, "u18", start["ctx"].(map[string]any)["userBand"])
	sid := start["session_id"].(string)
	r = c.do("POST", "/v1/games/sessions/"+sid+"/complete", map[string]any{"client_result": clientPreview(72, 8), "replay": fakeReplay("a1")}, idem())
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/games/sessions/{sessionId}/complete", r)
	require.Equal(t, true, r.json(t)["server_checked"])
	n := e.count(`SELECT count(*) FROM game.sessions WHERE family_member_id IS NOT NULL AND status = 'checked'`)
	require.Equal(t, 1, n)

	// The parent's own session is a different subject: Rahul's session is not visible as theirs.
	r = c.do("GET", "/v1/games/sessions/"+sid+"/replay", nil, nil)
	require.NotEqual(t, http.StatusOK, r.Status)

	// Social features need the parent's extras on top of the base consent.
	assertProblem(t, c.do("POST", "/v1/squads"+q, map[string]any{"name": "Rahul squad", "display_name": "Rahul"}, idem()),
		http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
}
