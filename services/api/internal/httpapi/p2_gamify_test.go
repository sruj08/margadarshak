package httpapi_test

// P2 gamification over HTTP (API-38, 39, 44, 57): no XP for opening, sharing or inviting; ranks
// gated by mastery, not XP; a silent streak; the parent's squads extra; server-side share-card
// numbers.

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/compute"
	"github.com/sruj08/margadarshak/services/api/internal/gamify"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

// gamifyRealCompute is e.useRealCompute with the request signatures stamped by the wall clock:
// the harness signs with the fixed test clock, which the verifier rejects as signature_stale.
func gamifyRealCompute(t *testing.T, e *p2Env) {
	t.Helper()
	e.useRealCompute(t)
	c := compute.New(sharedVerifier(t, e.cfg.ScoreVerifierSecret), e.cfg.ScoreVerifierSecret, 10*time.Second, servertime.System{})
	e.compute.set(func(f *p2Compute) { f.real = c })
}

// gamifySubject is the signed-in holder behind c (from GET /v1/me).
func gamifySubject(t *testing.T, c *client) gamify.Subject {
	t.Helper()
	r := c.do("GET", "/v1/me", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	id, err := ids.Decode(ids.User, r.json(t)["subject"].(string))
	require.NoError(t, err)
	return gamify.Subject{Tenant: "JK", ApplicantID: id, UserBand: "adult", Account: true}
}

// gamifySeedNazar stores one checked, Nazar-Score-eligible mock at pct for subj.
func gamifySeedNazar(t *testing.T, e *p2Env, subj gamify.Subject, pct float64) {
	t.Helper()
	now := e.clock.Now()
	require.NoError(t, e.app.DB.System(context.Background(), func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(), `INSERT INTO game.sessions (session_id, tenant_id, applicant_id, family_member_id, game_id, mode,
			game_version, scoring_version, rule_pack_version, seed, seed_origin, difficulty, status, context, started_at, expires_at,
			submitted_at, verified_at, digest, server_result, server_score_pct, trust, eligibility)
			VALUES ($1, $2, $3, $4, 'nazar', 'mock', '1.0.0', '1.0', 'jk-test', 7, 'server', 3, 'checked', '{}', $5, $6, $7, $7,
			  $8, '{}', $9, 1, '{"nazar_score": true, "xp": true}')`,
			uuid.New(), subj.Tenant, subj.ApplicantID, subj.MemberID, now.Add(-time.Hour), now.Add(time.Hour), now,
			"sha256:"+strings.Repeat("0", 64), pct)
		return err
	}))
}

// gamifyVerify runs the games award hook for one verified session (what POST
// /v1/games/{gameId}/sessions/{sid}/complete calls after the verifier checked it).
func gamifyVerify(t *testing.T, e *p2Env, subj gamify.Subject, pct float64) *gamify.AwardSummary {
	t.Helper()
	res, _ := json.Marshal(map[string]any{"score": map[string]any{"pct": pct, "capApplied": nil}, "findings": []any{},
		"integrity": map[string]any{"trust": 1, "flags": []any{}}})
	sum, err := e.app.P2.Gamify.OnSessionVerified(context.Background(), gamify.VerifiedSession{ID: uuid.New(), Subject: subj, GameID: "nazar",
		Mode: "practice", Result: res, DurationMs: 5 * 60_000, VerifiedAt: e.clock.Now()})
	require.NoError(t, err)
	return sum
}

func gamifyAchievements(t *testing.T, c *client, query string) map[string]any {
	t.Helper()
	r := c.do("GET", "/v1/me/achievements"+query, nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/me/achievements", r)
	return r.json(t)
}

func gamifyCreateSquad(t *testing.T, c *client, name, display string) map[string]any {
	t.Helper()
	r := c.do("POST", "/v1/squads", map[string]any{"name": name, "display_name": display}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/squads", r)
	return r.json(t)
}

func TestXP_NoXPForOpenShareInvite(t *testing.T) {
	e := newP2Env(t)
	gamifyRealCompute(t, e)
	owner, friend := e.userClient("gamify.owner@example.com"), e.userClient("gamify.friend@example.com")
	subj := gamifySubject(t, owner)
	ledger := func() int { return e.count(`SELECT count(*) FROM game.xp_ledger`) }

	// Opening the app (and the achievements screen) earns nothing.
	a := gamifyAchievements(t, owner, "")
	require.EqualValues(t, 0, a["xp_total"])
	require.Equal(t, "gali", a["rank"])

	// Creating a squad, inviting and joining earn nothing.
	sq := gamifyCreateSquad(t, owner, "GCET Riders", "Kabir")
	require.Regexp(t, `^sqd_[0-9A-Z]{26}$`, sq["squad_id"])
	code := sq["invite_code"].(string)
	r := friend.do("POST", "/v1/squads/"+sq["squad_id"].(string)+"/join", map[string]any{"invite_code": code, "display_name": "Tanvi"}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/squads/{squadId}/join", r)
	joined := r.json(t)
	require.Len(t, joined["members"], 2)
	require.EqualValues(t, 6, joined["weekly_progress"].(map[string]any)["goal"], "3 x members")
	require.NotContains(t, joined, "invite_code", "the code is shown only when the squad is created")

	r = owner.do("GET", "/v1/squads/mine", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/squads/mine", r)
	items := r.json(t)["items"].([]any)
	require.Len(t, items, 1)
	me := 0
	for _, m := range items[0].(map[string]any)["members"].([]any) {
		mm := m.(map[string]any)
		require.NotContains(t, mm, "nazar_score")
		if mm["is_me"] == true {
			me++
			require.Equal(t, "owner", mm["role"])
		}
	}
	require.Equal(t, 1, me)

	// Creating (and opening) a share card earns nothing.
	gamifySeedNazar(t, e, subj, 64)
	r = owner.do("POST", "/v1/share-cards", map[string]any{"kind": "nazar", "name_display": "display_name", "display_name": "Kabir"}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/share-cards", r)
	r = e.client().do("GET", "/v1/share-cards/"+r.json(t)["share_card_id"].(string), nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/share-cards/{shareCardId}", r)
	require.Zero(t, ledger(), "opening, inviting, joining and sharing never write XP")

	// A verified session does.
	sum := gamifyVerify(t, e, subj, 80)
	require.Positive(t, sum.XPAwarded)
	require.Equal(t, 1, ledger())
	require.Equal(t, 1, e.count(`SELECT count(*) FROM game.xp_ledger WHERE reason = 'session'`))
	a = gamifyAchievements(t, owner, "")
	require.EqualValues(t, sum.XPAwarded, a["xp_total"])
	require.EqualValues(t, sum.XPAwarded, a["xp_today"])

	// Leaving is one step and idempotent; neither earns anything.
	for range 2 {
		r = friend.do("POST", "/v1/squads/"+sq["squad_id"].(string)+"/leave", nil, idem())
		require.Equalf(t, http.StatusNoContent, r.Status, "%s", r.Body)
		assertContract(t, "POST", "/v1/squads/{squadId}/leave", r)
	}
	require.Equal(t, 1, ledger())

	// There is no reason for sharing: the package refuses it, and so does the database CHECK.
	_, err := gamify.NewXPEntry("share", "card", 10, e.clock.Now())
	require.ErrorIs(t, err, gamify.ErrXPReasonNotAllowed)
	now := e.clock.Now()
	_, err = e.app.P2.Gamify.Store.AppendXP(context.Background(), subj, &gamify.XPEntry{ID: uuid.New(), Reason: "share", SourceID: "card-1",
		XP: 10, ISTDay: servertime.DateIST(now), WeekKey: gamify.WeekKey(now), At: now})
	require.ErrorIs(t, err, gamify.ErrXPReasonNotAllowed)
	_, err = e.app.DB.Pool.Exec(context.Background(), `INSERT INTO game.xp_ledger (entry_id, tenant_id, applicant_id, reason, source_id, xp,
		ist_day, week_key, created_at) VALUES ($1, 'JK', $2, 'share', 'card-2', 10, $3::date, $4, $5)`,
		uuid.New(), subj.ApplicantID, servertime.DateIST(now), gamify.WeekKey(now), now)
	require.ErrorContains(t, err, "xp_ledger_reason_check")
	require.Equal(t, 1, ledger())
}

func TestRank_XPAloneCannotUnlock(t *testing.T) {
	e := newP2Env(t)
	gamifyRealCompute(t, e)
	c := e.userClient("gamify.grinder@example.com")
	subj := gamifySubject(t, c)
	// Far more XP than any rank asks for, but no mastered nodes and no verified Nazar mocks.
	require.NoError(t, e.app.P2.Gamify.Store.SaveProgress(context.Background(), subj,
		&gamify.Progress{XPTotal: 250_000, Rank: "R1", StreakGoal: 4, Badges: map[string]gamify.BadgeRecord{}, UpdatedAt: e.clock.Now()}))

	for i := 0; i < 3; i++ {
		sum := gamifyVerify(t, e, subj, 95)
		require.Equal(t, "R1", sum.Rank)
		require.False(t, sum.Promoted)
	}
	a := gamifyAchievements(t, c, "")
	require.Equal(t, "gali", a["rank"])
	require.Greater(t, a["xp_total"].(float64), 250_000.0)
	req := a["rank_requirements"].(map[string]any)
	require.Equal(t, "mohalla", req["next"])
	require.EqualValues(t, 0, req["xp_missing"], "XP is not what is missing")
	require.NotEmpty(t, req["missing_nodes"], "the next rank waits for skill-tree nodes")
}

func TestStreak_BreakIsSilent_NoNotificationRows(t *testing.T) {
	e := newP2Env(t)
	gamifyRealCompute(t, e)
	c := e.userClient("gamify.streak@example.com")
	subj := gamifySubject(t, c)
	notes := e.count(`SELECT count(*) FROM msg.notifications`)

	// Week 1: the weekly goal (4) is met.
	for i := 0; i < 4; i++ {
		gamifyVerify(t, e, subj, 75)
		e.clock.Advance(time.Hour)
	}
	// Week 2: one session closes week 1.
	e.clock.Advance(7 * 24 * time.Hour)
	gamifyVerify(t, e, subj, 75)
	a := gamifyAchievements(t, c, "")
	streak := a["streak"].(map[string]any)
	require.EqualValues(t, 1, streak["weeks"], "%v", streak)
	require.Equal(t, "active", streak["status"])

	// Five quiet weeks: the freeze token goes, the streak becomes repairable, then resets.
	e.clock.Advance(5 * 7 * 24 * time.Hour)
	gamifyVerify(t, e, subj, 75)
	a = gamifyAchievements(t, c, "")
	streak = a["streak"].(map[string]any)
	require.EqualValues(t, 0, streak["weeks"], "%v", streak)
	require.EqualValues(t, 0, streak["freeze_tokens"], "%v", streak)

	require.Equal(t, notes, e.count(`SELECT count(*) FROM msg.notifications`), "a streak never notifies")
	require.Zero(t, e.count(`SELECT count(*) FROM msg.notifications WHERE template_id ILIKE '%streak%'`))
}

func TestSquadJoin_MinorWithoutSquadConsent_403(t *testing.T) {
	e := newP2Env(t)
	owner := e.userClient("gamify.squadowner@example.com")
	sq := gamifyCreateSquad(t, owner, "Gandhi Nagar Crew", "Aman")
	join := "/v1/squads/" + sq["squad_id"].(string) + "/join"
	body := map[string]any{"invite_code": sq["invite_code"], "display_name": "Rahul"}

	parent := e.personaClient("rahul")
	r := parent.do("GET", "/v1/me/family-members", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	members := r.json(t)["items"].([]any)
	require.Len(t, members, 1)
	rahul := members[0].(map[string]any)["member_id"].(string)
	q := "?family_member_id=" + rahul

	// Rahul has the parent's recorded consent but not the squads extra.
	r = parent.do("POST", join+q, body, idem())
	assertProblem(t, r, http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	r = parent.do("POST", "/v1/squads"+q, map[string]any{"name": "Rahul's Squad", "display_name": "Rahul"}, idem())
	assertProblem(t, r, http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	r = parent.do("GET", "/v1/squads/mine"+q, nil, nil)
	assertProblem(t, r, http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	// Achievements need only the recorded consent.
	gamifyAchievements(t, parent, q)

	// The parent grants the squads extra.
	r = parent.do("POST", "/v1/me/family-members/"+rahul+"/parental-consent",
		map[string]any{"action": "grant", "notice_version": "notice-2026.10.23-hi", "extras": []string{"squads"}}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/me/family-members/{memberId}/parental-consent", r)
	r = parent.do("GET", "/v1/me/family-members", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/me/family-members", r)
	require.Equal(t, []any{"squads"}, r.json(t)["items"].([]any)[0].(map[string]any)["parental_extras"])

	r = parent.do("POST", join+q, body, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/squads/{squadId}/join", r)
	var mine, others int
	for _, m := range r.json(t)["members"].([]any) {
		if m.(map[string]any)["is_me"] == true {
			mine++
			require.Equal(t, "Rahul", m.(map[string]any)["display_name"])
		} else {
			others++
		}
	}
	require.Equal(t, 1, mine)
	require.Equal(t, 1, others)

	// The holder is not the member: the parent's own squad list stays empty.
	r = parent.do("GET", "/v1/squads/mine", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/squads/mine", r)
	require.Empty(t, r.json(t)["items"])
	r = parent.do("GET", "/v1/squads/mine"+q, nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Len(t, r.json(t)["items"], 1)

	// Still no share cards for Rahul: that is a separate extra.
	r = parent.do("POST", "/v1/share-cards", map[string]any{"kind": "nazar", "family_member_id": rahul, "name_display": "initials",
		"display_name": "Rahul"}, idem())
	assertProblem(t, r, http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
}

func TestShareCard_ClientCannotChangeScore(t *testing.T) {
	e := newP2Env(t)
	c := e.userClient("gamify.sharer@example.com")
	subj := gamifySubject(t, c)

	// No counted Nazar mock yet: nothing to share.
	r := c.do("POST", "/v1/share-cards", map[string]any{"kind": "nazar", "name_display": "initials", "display_name": "Kabir Sharma"}, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "SHARE_CARD_NOT_ALLOWED")

	gamifySeedNazar(t, e, subj, 58.4)
	gamifySeedNazar(t, e, subj, 64.6) // mean 61.5 → 62

	// A client-supplied score is refused outright.
	for _, field := range []string{"nazar_score", "score", "counted_sessions"} {
		r = c.do("POST", "/v1/share-cards", map[string]any{"kind": "nazar", "name_display": "initials", "display_name": "Kabir Sharma",
			field: 99}, idem())
		assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
		require.Contains(t, string(r.Body), "/"+field)
	}
	// A badge the subject has not earned cannot go on a badge card.
	r = c.do("POST", "/v1/share-cards", map[string]any{"kind": "badge", "badge_id": "calibrated", "name_display": "initials",
		"display_name": "Kabir Sharma"}, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "SHARE_CARD_NOT_ALLOWED")

	r = c.do("POST", "/v1/share-cards", map[string]any{"kind": "nazar", "name_display": "initials", "display_name": "Kabir Sharma",
		"kerala_line": true, "locale": "hi"}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/share-cards", r)
	card := r.json(t)
	id := card["share_card_id"].(string)
	require.Regexp(t, `^shc_[0-9A-Z]{10}$`, id)
	content := card["content"].(map[string]any)
	require.EqualValues(t, 62, content["nazar_score"])
	require.EqualValues(t, 2, content["counted_sessions"])
	require.Equal(t, "KS", content["display_name"], "only the initials are stored")
	require.Equal(t, "http://web.test/hi/c/"+id, card["url"])
	require.NotContains(t, string(r.Body), "Sharma")

	// The public data is anonymous and recomputed from server data on every read.
	anon := e.client()
	r = anon.do("GET", "/v1/share-cards/"+id, nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/share-cards/{shareCardId}", r)
	pub := r.json(t)
	require.EqualValues(t, 62, pub["content"].(map[string]any)["nazar_score"])
	require.Equal(t, true, pub["content"].(map[string]any)["kerala_line"])
	require.NotEmpty(t, pub["kerala_line_key"])
	require.NotEmpty(t, pub["footer_key"])

	gamifySeedNazar(t, e, subj, 90) // mean of 58.4, 64.6, 90 = 71
	r = anon.do("GET", "/v1/share-cards/"+id, nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.EqualValues(t, 71, r.json(t)["content"].(map[string]any)["nazar_score"])
	require.EqualValues(t, 3, r.json(t)["content"].(map[string]any)["counted_sessions"])

	// API-57 image: 302 to the web's Open Graph image; the kind must match.
	r = anon.do("GET", "/v1/share-cards/nazar/"+id+".png?locale=hi", nil, nil)
	require.Equalf(t, http.StatusFound, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/share-cards/{kind}/{id}.png", r)
	require.Equal(t, "http://web.test/hi/c/"+id+"/opengraph-image", r.Header.Get("Location"))
	r = anon.do("GET", "/v1/share-cards/badge/"+id+".png", nil, nil)
	assertProblem(t, r, http.StatusNotFound, "NOT_FOUND")
	r = anon.do("GET", "/v1/share-cards/shc_ZZZZZZZZZZ", nil, nil)
	assertProblem(t, r, http.StatusNotFound, "NOT_FOUND")

	// Only the owner withdraws; withdrawing is idempotent; then the links answer 410.
	other := e.userClient("gamify.other@example.com")
	r = other.do("DELETE", "/v1/share-cards/"+id, nil, nil)
	assertProblem(t, r, http.StatusNotFound, "NOT_FOUND")
	for range 2 {
		r = c.do("DELETE", "/v1/share-cards/"+id, nil, nil)
		require.Equalf(t, http.StatusNoContent, r.Status, "%s", r.Body)
		assertContract(t, "DELETE", "/v1/share-cards/{shareCardId}", r)
	}
	r = anon.do("GET", "/v1/share-cards/"+id, nil, nil)
	assertProblem(t, r, http.StatusGone, "GONE")
	r = anon.do("GET", "/v1/share-cards/nazar/"+id+".png", nil, nil)
	assertProblem(t, r, http.StatusGone, "GONE")
}

func TestGamify_KhudLicenceDeclaration(t *testing.T) {
	e := newP2Env(t)
	gamifyRealCompute(t, e)
	c := e.userClient("gamify.khud@example.com")
	day := servertime.DateIST(e.clock.Now().Add(-48 * time.Hour))
	r := c.do("POST", "/v1/me/declarations/khud-licence", map[string]any{"dl_issued_on": day, "no_agent_used": false}, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	r = c.do("POST", "/v1/me/declarations/khud-licence", map[string]any{"dl_issued_on": "2099-01-01", "no_agent_used": true}, idem())
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")

	r = c.do("POST", "/v1/me/declarations/khud-licence", map[string]any{"dl_issued_on": day, "no_agent_used": true, "first_attempt_pass": true}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/me/declarations/khud-licence", r)
	badges := map[string]map[string]any{}
	for _, b := range r.json(t)["badges"].([]any) {
		badges[b.(map[string]any)["badge_id"].(string)] = b.(map[string]any)
	}
	require.Contains(t, badges, "khud_licence", "%s", r.Body)
	require.Equal(t, true, badges["khud_licence"]["self_declared"])
	require.Equal(t, "your_word", badges["khud_licence"]["label"])
	require.Zero(t, e.count(`SELECT count(*) FROM game.xp_ledger`), "a declaration earns no XP")
	a := gamifyAchievements(t, c, "")
	require.Len(t, a["badges"], len(badges))
}
