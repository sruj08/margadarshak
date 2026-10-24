package httpapi_test

// P2 learning, API-30..33: modules (ETag/304), the review queue, the offline answer sync
// (deduplicated on client_answer_id, per subject) and Test Readiness (advisory gate, book anyway
// always visible). Answers are scored by the real compute service against its server keys
// (services/score-verifier/content/q).

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/compute"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

// learnUseRealCompute is e.useRealCompute (spawn and skip rules) with the request signatures
// stamped from the wall clock: the harness signs with the fixed test clock, which the verifier
// rejects as signature_stale whenever testNow is more than its skew window away from real time.
// The learn service still sends the test clock as `now` in every body.
func (e *p2Env) learnUseRealCompute(t *testing.T) {
	t.Helper()
	e.useRealCompute(t)
	url := sharedVerifier(t, e.cfg.ScoreVerifierSecret)
	c := compute.New(url, e.cfg.ScoreVerifierSecret, 10*time.Second, servertime.System{})
	e.compute.set(func(f *p2Compute) { f.real = c })
}

// learnKey is the verifier's server key for question q, variant v: the correct option.
func learnKey(t *testing.T, q, v string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRootDir(t), "services", "score-verifier", "content", "q", q+"_"+v+".json"))
	require.NoError(t, err)
	var k struct {
		QRef            string `json:"qref"`
		CorrectOptionID string `json:"correctOptionId"`
	}
	require.NoError(t, json.Unmarshal(raw, &k))
	require.Equal(t, q+":"+v, k.QRef)
	return k.CorrectOptionID
}

// learnWrong is an option that is not the correct one.
func learnWrong(correct string) string {
	for _, o := range []string{"a", "b", "c", "d"} {
		if o != correct {
			return o
		}
	}
	return "z"
}

// learnAnswer is one AnswerSubmission for question q (variant v1), correct or not.
func learnAnswer(t *testing.T, id, q string, correct bool, conf string, at time.Time) map[string]any {
	t.Helper()
	opt := learnKey(t, q, "v1")
	if !correct {
		opt = learnWrong(opt)
	}
	a := map[string]any{"client_answer_id": id, "card_id": q, "question_id": q, "variant_id": "v1", "option_id": opt,
		"latency_ms": 5200, "answered_at": at.UTC().Format(time.RFC3339), "mode": "practice"}
	if conf != "" {
		a["confidence"] = conf
	}
	return a
}

// learnSubmit posts a batch (for member when not "") and returns the results by client_answer_id.
func learnSubmit(t *testing.T, c *client, member string, answers []map[string]any) (resp, []map[string]any) {
	t.Helper()
	body := map[string]any{"answers": answers}
	if member != "" {
		body["family_member_id"] = member
	}
	r := c.do("POST", "/v1/learn/answers", body, idem())
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/learn/answers", r)
	var out struct {
		Results []map[string]any `json:"results"`
	}
	require.NoError(t, json.Unmarshal(r.Body, &out))
	require.Len(t, out.Results, len(answers))
	return r, out.Results
}

// learnAddMember adds a 17-year-old family member, with the parent's consent when consent is true.
func learnAddMember(t *testing.T, c *client, label string, consent bool) string {
	t.Helper()
	r := c.do("POST", "/v1/me/family-members", map[string]any{"relation": "child", "label": label, "dob": "2009-03-14", "dob_precision": "day"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	ref := r.json(t)["member_id"].(string)
	if consent {
		r = c.do("POST", "/v1/me/family-members/"+ref+"/parental-consent", map[string]any{"action": "grant", "notice_version": "notice-2026.10.23-hi", "language": "hi"}, nil)
		require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	}
	return ref
}

// learnRows counts a learn table's rows for the account holder (member "") or a family member.
func (e *p2Env) learnRows(t *testing.T, table, member string) int {
	t.Helper()
	q := "SELECT count(*) FROM " + table + " WHERE family_member_id IS NULL"
	var args []any
	if member != "" {
		mid, err := ids.Decode(ids.FamilyMember, member)
		require.NoError(t, err)
		q, args = "SELECT count(*) FROM "+table+" WHERE family_member_id = $1", []any{mid}
	}
	var n int
	require.NoError(t, e.app.DB.Tenant(context.Background(), "JK", func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), q, args...).Scan(&n)
	}))
	return n
}

func TestAPI30_ModulesContractAndNotModified(t *testing.T) {
	e := newP2Env(t)
	c := e.client() // anonymous: API-30 needs no session

	r := c.do("GET", "/v1/learn/modules", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/learn/modules", r)
	etag := r.Header.Get("ETag")
	require.True(t, strings.HasPrefix(etag, `W/"`), etag)
	body := r.json(t)
	version := body["content_version"].(string)
	require.NotEmpty(t, version)
	byID := map[string]map[string]any{}
	for _, m := range body["modules"].([]any) {
		mm := m.(map[string]any)
		byID[mm["module_id"].(string)] = mm
	}
	require.Contains(t, byID, "LL1")
	require.Equal(t, "ll_syllabus", byID["LL1"]["kind"])
	require.Equal(t, "curriculum.LL1.title", byID["LL1"]["title_key"])
	require.Contains(t, byID, "M1")
	require.Equal(t, "survival_skill", byID["M1"]["kind"])

	// If-None-Match with the ETag (also inside a list, also strong-form): 304, no body.
	for _, inm := range []string{etag, `"other", ` + etag, strings.TrimPrefix(etag, "W/")} {
		nm := c.do("GET", "/v1/learn/modules", nil, map[string]string{"If-None-Match": inm})
		require.Equal(t, http.StatusNotModified, nm.Status, inm)
		require.Empty(t, nm.Body)
		require.Equal(t, etag, nm.Header.Get("ETag"))
	}
	stale := c.do("GET", "/v1/learn/modules", nil, map[string]string{"If-None-Match": `W/"stale"`})
	require.Equal(t, http.StatusOK, stale.Status)
	assertContract(t, "GET", "/v1/learn/modules", stale)

	// Accept-Language does not change the body (titles are message keys).
	hi := c.do("GET", "/v1/learn/modules", nil, map[string]string{"Accept-Language": "hi"})
	require.Equal(t, http.StatusOK, hi.Status)
	require.Equal(t, string(r.Body), string(hi.Body))
	require.Equal(t, etag, hi.Header.Get("ETag"))

	// A class filter changes the ETag but not the content version.
	cls := c.do("GET", "/v1/learn/modules?class_code=MCWG", nil, nil)
	require.Equal(t, http.StatusOK, cls.Status)
	assertContract(t, "GET", "/v1/learn/modules", cls)
	require.NotEqual(t, etag, cls.Header.Get("ETag"))
	require.Equal(t, version, cls.json(t)["content_version"])
	nm := c.do("GET", "/v1/learn/modules?class_code=MCWG", nil, map[string]string{"If-None-Match": etag})
	require.Equal(t, http.StatusOK, nm.Status, "another query's ETag must not match")
}

func TestAPI31_ParentConsentRequired(t *testing.T) {
	e := newP2Env(t)
	c := e.userClient("learn.consent@example.com")
	minor := learnAddMember(t, c, "Riya", false)

	r := c.do("GET", "/v1/learn/review-queue?family_member_id="+minor, nil, nil)
	assertProblem(t, r, http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	assertContract(t, "GET", "/v1/learn/review-queue", r)
	r = c.do("GET", "/v1/readiness?family_member_id="+minor, nil, nil)
	assertProblem(t, r, http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	assertContract(t, "GET", "/v1/readiness", r)
	ans := map[string]any{"client_answer_id": "ans_minor_1", "card_id": "C-LL1-001", "question_id": "C-LL1-001", "variant_id": "v1",
		"option_id": "a", "answered_at": e.clock.Now().Format(time.RFC3339), "mode": "practice"}
	r = c.do("POST", "/v1/learn/answers", map[string]any{"family_member_id": minor, "answers": []any{ans}}, idem())
	assertProblem(t, r, http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	assertContract(t, "POST", "/v1/learn/answers", r)
	require.Zero(t, e.learnRows(t, "learn.answers", minor))
	require.Zero(t, e.learnRows(t, "learn.review_log", minor))

	// A member that is not the caller's is 404.
	assertProblem(t, c.do("GET", "/v1/learn/review-queue?family_member_id=fam_01JB8ZQ0000000", nil, nil), http.StatusNotFound, "NOT_FOUND")

	// The compute service is down and nothing was ever computed: 503, never an invented queue.
	r = c.do("GET", "/v1/learn/review-queue", nil, nil)
	assertProblem(t, r, http.StatusServiceUnavailable, "ADAPTER_UNAVAILABLE")
	r = c.do("GET", "/v1/learn/review-queue?limit=0", nil, nil)
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
}

func TestAPI32_ValidationAndUnknownQuestion(t *testing.T) {
	e := newP2Env(t)
	c := e.deviceClient()
	now := e.clock.Now()
	base := func() map[string]any {
		return map[string]any{"client_answer_id": "ans_v_1", "card_id": "C-LL1-001", "question_id": "C-LL1-001", "variant_id": "v1",
			"option_id": "a", "answered_at": now.Format(time.RFC3339), "mode": "practice"}
	}
	cases := map[string]func(a map[string]any){
		"/answers/0/question_id": func(a map[string]any) { a["question_id"] = "C-LL1:001" },
		"/answers/0/variant_id":  func(a map[string]any) { a["variant_id"] = "" },
		"/answers/0/mode":        func(a map[string]any) { a["mode"] = "duel" },
		"/answers/0/confidence":  func(a map[string]any) { a["confidence"] = "90" },
		"/answers/0/answered_at": func(a map[string]any) { delete(a, "answered_at") },
	}
	for ptr, mut := range cases {
		a := base()
		mut(a)
		r := c.do("POST", "/v1/learn/answers", map[string]any{"answers": []any{a}}, nil)
		assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
		assertContract(t, "POST", "/v1/learn/answers", r)
		require.Contains(t, string(r.Body), ptr)
	}
	r := c.do("POST", "/v1/learn/answers", map[string]any{"answers": []any{}}, nil)
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	big := make([]any, 201)
	for i := range big {
		a := base()
		a["client_answer_id"] = "ans_big_" + strings.Repeat("x", i%3) + string(rune('a'+i%26))
		big[i] = a
	}
	r = c.do("POST", "/v1/learn/answers", map[string]any{"answers": big}, nil)
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	// Unknown fields are rejected (the client cannot send a "correct" flag).
	a := base()
	a["correct"] = true
	assertProblem(t, c.do("POST", "/v1/learn/answers", map[string]any{"answers": []any{a}}, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")

	// The compute service is down: 503, nothing stored.
	r = c.do("POST", "/v1/learn/answers", map[string]any{"answers": []any{base()}}, nil)
	assertProblem(t, r, http.StatusServiceUnavailable, "ADAPTER_UNAVAILABLE")
	require.Zero(t, e.learnRows(t, "learn.answers", ""))

	// A question without a server key: 422, nothing stored.
	e.learnUseRealCompute(t)
	a = base()
	a["question_id"] = "C-LL9-999"
	r = c.do("POST", "/v1/learn/answers", map[string]any{"answers": []any{a}}, nil)
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	require.Contains(t, string(r.Body), "unknown_question")
	require.Zero(t, e.learnRows(t, "learn.answers", ""))
}

func TestAPI32_OfflineReplayNoDoubleCount(t *testing.T) {
	e := newP2Env(t)
	e.learnUseRealCompute(t)
	c := e.userClient("learn.replay@example.com")
	member := learnAddMember(t, c, "Rahul", true)
	at := e.clock.Now().Add(-10 * time.Minute)

	// The same client_answer_ids for the holder and the member: dedupe is per subject.
	for _, subj := range []string{"", member} {
		// The fixed clock would make the member's compute request byte-identical to the holder's
		// (same `now`, same answers), which the verifier rejects as signature_replayed.
		e.clock.Advance(time.Second)
		batch := []map[string]any{
			learnAnswer(t, "ans_r_1", "C-LL1-001", true, "100", at),
			learnAnswer(t, "ans_r_2", "C-LL1-002", false, "100", at.Add(time.Minute)),
			learnAnswer(t, "ans_r_3", "C-LL2-001", true, "50", at.Add(2*time.Minute)),
		}
		_, first := learnSubmit(t, c, subj, batch)
		want := map[string]map[string]any{}
		for _, res := range first {
			require.Equal(t, false, res["duplicate"], "%v", res)
			want[res["client_answer_id"].(string)] = res
		}
		// Scored by the server key, never by the client.
		require.Equal(t, true, want["ans_r_1"]["correct"])
		require.Equal(t, false, want["ans_r_2"]["correct"])
		require.Equal(t, true, want["ans_r_2"]["overconfident"], "wrong at 100%% confidence")
		require.EqualValues(t, 1, want["ans_r_2"]["rating"])
		require.Equal(t, true, want["ans_r_3"]["correct"])
		require.Equal(t, 3, e.learnRows(t, "learn.answers", subj))
		require.Equal(t, 3, e.learnRows(t, "learn.review_log", subj))

		// The offline queue is replayed with one more answer (and a repeat inside the batch).
		again := append(append([]map[string]any{}, batch...),
			learnAnswer(t, "ans_r_4", "C-LL3-001", true, "75", at.Add(3*time.Minute)),
			learnAnswer(t, "ans_r_2", "C-LL1-002", true, "100", at.Add(4*time.Minute)))
		_, second := learnSubmit(t, c, subj, again)
		for i, res := range second {
			id := res["client_answer_id"].(string)
			if id == "ans_r_4" {
				require.Equal(t, false, res["duplicate"])
				require.Equal(t, true, res["correct"])
				continue
			}
			require.Equal(t, true, res["duplicate"], "answer %d %s", i, id)
			// The stored result comes back unchanged (the resent ans_r_2 is not re-scored).
			require.Equal(t, want[id]["correct"], res["correct"], id)
			require.Equal(t, want[id]["rating"], res["rating"], id)
			require.Equal(t, want[id]["next_due_at"], res["next_due_at"], id)
		}
		require.Equal(t, 4, e.learnRows(t, "learn.answers", subj))
		require.Equal(t, 4, e.learnRows(t, "learn.review_log", subj))
	}
	// The member's sync did not touch the holder's rows.
	require.Equal(t, 4, e.learnRows(t, "learn.answers", ""))
	require.Equal(t, 4, e.learnRows(t, "learn.review_log", ""))

	// The identical request with the same Idempotency-Key is replayed by the middleware.
	key := idem()
	body := map[string]any{"answers": []map[string]any{learnAnswer(t, "ans_r_5", "C-LL4-001", true, "", at)}}
	r1 := c.do("POST", "/v1/learn/answers", body, key)
	require.Equalf(t, http.StatusOK, r1.Status, "%s", r1.Body)
	r2 := c.do("POST", "/v1/learn/answers", body, key)
	require.Equal(t, http.StatusOK, r2.Status)
	assertContract(t, "POST", "/v1/learn/answers", r2)
	require.Equal(t, "true", r2.Header.Get("Idempotent-Replayed"))
	require.JSONEq(t, string(r1.Body), string(r2.Body))
	require.Equal(t, 5, e.learnRows(t, "learn.answers", ""))
	require.Equal(t, 5, e.learnRows(t, "learn.review_log", ""))
}

// learnCheckReadiness asserts the API-33 invariants on a 200 response and returns the body.
func learnCheckReadiness(t *testing.T, r resp) map[string]any {
	t.Helper()
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/readiness", r)
	b := r.json(t)
	gate := b["gate"].(map[string]any)
	require.Equal(t, true, gate["advisory"])
	require.Equal(t, true, gate["book_anyway_visible"])
	require.EqualValues(t, 85, gate["threshold"])
	require.Equal(t, "readiness.formula", b["display_key"])
	score, knowledge, penalty := b["score"].(float64), b["knowledge"].(float64), b["calibration_penalty"].(float64)
	require.LessOrEqualf(t, math.Abs(score-(knowledge-penalty)), 1.0, "score %v = knowledge %v - penalty %v (rounding)", score, knowledge, penalty)
	road := b["road_readiness"].(map[string]any)
	require.Contains(t, road, "nazar_score")
	require.IsType(t, map[string]any{}, road["nodes"])
	return b
}

func TestAPI33_BookAnywayConst(t *testing.T) {
	e := newP2Env(t)
	e.learnUseRealCompute(t)
	c := e.deviceClient()

	// A fresh learner.
	fresh := learnCheckReadiness(t, c.do("GET", "/v1/readiness", nil, nil))
	require.Equal(t, false, fresh["gate"].(map[string]any)["met"])

	// After answers (some confidently wrong, so the calibration side has evidence).
	at := e.clock.Now().Add(-30 * time.Minute)
	var batch []map[string]any
	for i, q := range []string{"C-LL1-001", "C-LL1-002", "C-LL1-003", "C-LL2-001", "C-LL3-001", "C-LL4-001"} {
		batch = append(batch, learnAnswer(t, "ans_b_"+q, q, i%3 != 2, "100", at.Add(time.Duration(i)*time.Minute)))
	}
	learnSubmit(t, c, "", batch)
	after := learnCheckReadiness(t, c.do("GET", "/v1/readiness?case_id=case_01JB8ZQ0000000", nil, nil))
	require.GreaterOrEqual(t, after["knowledge"].(float64), fresh["knowledge"].(float64))
	require.NotEmpty(t, after["topics"])

	// The review queue: the wrongly answered cards come due within the hour.
	e.clock.Advance(2 * time.Hour)
	r := c.do("GET", "/v1/learn/review-queue?limit=1", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/learn/review-queue", r)
	q := r.json(t)
	require.Len(t, q["items"], 1)
	item := q["items"].([]any)[0].(map[string]any)
	require.Contains(t, []string{"C-LL1-003", "C-LL4-001"}, item["card_id"])
	require.NotContains(t, q, "stale")
	all := c.do("GET", "/v1/learn/review-queue", nil, nil)
	assertContract(t, "GET", "/v1/learn/review-queue", all)
	require.Len(t, all.json(t)["items"], 2)

	// The compute service goes down: the last snapshot is served, the constants hold.
	e.compute.set(func(f *p2Compute) { f.real = nil })
	e.clock.Advance(2 * time.Hour)
	down := learnCheckReadiness(t, c.do("GET", "/v1/readiness", nil, nil))
	require.Equal(t, after["score"], down["score"])
	r = c.do("GET", "/v1/learn/review-queue", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/learn/review-queue", r)

	// Nothing computed for this learner yet and the compute service down: 503.
	other := e.deviceClient()
	assertProblem(t, other.do("GET", "/v1/readiness", nil, nil), http.StatusServiceUnavailable, "ADAPTER_UNAVAILABLE")
}
