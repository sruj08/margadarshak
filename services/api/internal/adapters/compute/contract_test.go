package compute

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

// repoRoot is five levels up from this package (services/api/internal/adapters/compute).
func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "packages", "game-core", "fixtures", "golden.json")); err != nil {
		t.Fatalf("repo root not found from %s: %v", root, err)
	}
	return root
}

// startVerifier spawns the real verifier from source with the built-in golden fixture content
// (no VERIFIER_CONTENT_DIR) on an OS-assigned port (PORT=0; the port is read from the
// "listening" log line, so there is no window in which another process can take it). The child
// is killed on every path through t.Cleanup.
func startVerifier(t *testing.T, secret string) string {
	t.Helper()
	if testing.Short() {
		t.Skip("spawns the Node verifier; skipped under -short")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH")
	}
	root := repoRoot(t)
	dir := filepath.Join(root, "services", "score-verifier")
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, node, "--conditions=margdarshak-source", "--experimental-strip-types",
		filepath.Join(dir, "src", "server.ts"))
	cmd.Dir = dir
	env := []string{}
	for _, kv := range os.Environ() {
		k, _, _ := strings.Cut(kv, "=")
		switch strings.ToUpper(k) {
		case "VERIFIER_CONTENT_DIR", "VERIFIER_SHARED_SECRET", "SCORE_VERIFIER_HMAC_SECRET", "PORT", "SCORE_VERIFIER_PORT", "HOST":
			continue
		}
		env = append(env, kv)
	}
	cmd.Env = append(env, "VERIFIER_SHARED_SECRET="+secret, "PORT=0", "HOST=127.0.0.1")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		cancel()
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	t.Cleanup(func() {
		cancel()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		wg.Wait()
	})

	ports := make(chan int, 1)
	wg.Add(1)
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 64<<10), 1<<20)
		for sc.Scan() {
			var line struct {
				Msg  string `json:"msg"`
				Port int    `json:"port"`
			}
			if json.Unmarshal(sc.Bytes(), &line) == nil && line.Msg == "listening" && line.Port > 0 {
				select {
				case ports <- line.Port:
				default:
				}
			}
		}
		_, _ = io.Copy(io.Discard, stdout) // keep draining so the child never blocks on a full pipe
	}()
	select {
	case p := <-ports:
		return fmt.Sprintf("http://127.0.0.1:%d", p)
	case <-time.After(60 * time.Second):
		t.Fatalf("verifier did not start; stderr:\n%s", stderr.String())
	}
	return ""
}

type goldenFile struct {
	Schema  string `json:"schema"`
	Count   int    `json:"count"`
	Vectors []struct {
		Name     string          `json:"name"`
		GameID   string          `json:"gameId"`
		Request  json.RawMessage `json:"request"`
		Expected struct {
			Result       json.RawMessage `json:"result"`
			Digest       string          `json:"digest"`
			EventsDigest string          `json:"eventsDigest"`
		} `json:"expected"`
	} `json:"vectors"`
}

// canonical decodes JSON with exact number text, for a structural comparison.
func canonical(t *testing.T, raw []byte) any {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

// TestVerifierContract replays every golden vector through this client against the real
// verifier and requires the identical result and digest (services/score-verifier README,
// "Golden vectors"). Each request is decoded strictly into VerifyRequest first, so a field the Go
// struct does not mirror fails the test, and the verifier's strict schema rejects any field the
// struct gets wrong. It then checks the learning, gamification and clip routes the same way, with
// strict decoding of every response.
func TestVerifierContract(t *testing.T) {
	const secret = "contract-secret"
	base := startVerifier(t, secret)
	c := New(base, secret, 30*time.Second, servertime.System{})
	c.strict = true

	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "packages", "game-core", "fixtures", "golden.json"))
	if err != nil {
		t.Fatal(err)
	}
	var g goldenFile
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	if g.Schema != "margdarshak.game-core.golden/1" || len(g.Vectors) == 0 || len(g.Vectors) != g.Count {
		t.Fatalf("golden.json: schema %q, %d vectors, count %d", g.Schema, len(g.Vectors), g.Count)
	}
	ctx := context.Background()
	var nazar *VerifyRequest
	for _, v := range g.Vectors {
		t.Run(v.Name, func(t *testing.T) {
			var req VerifyRequest
			dec := json.NewDecoder(bytes.NewReader(v.Request))
			dec.DisallowUnknownFields()
			if err := dec.Decode(&req); err != nil {
				t.Fatalf("request does not fit VerifyRequest: %v", err)
			}
			res, err := c.Verify(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			// replay.inputs is stored as "" in the file; it always equals request.inputs.
			var exp map[string]any
			if err := json.Unmarshal(v.Expected.Result, &exp); err != nil {
				t.Fatal(err)
			}
			exp["replay"].(map[string]any)["inputs"] = req.Inputs
			expRaw, _ := json.Marshal(exp)
			if got, want := canonical(t, res.Result), canonical(t, expRaw); !reflect.DeepEqual(got, want) {
				t.Fatalf("result differs\n got: %s\nwant: %s", res.Result, expRaw)
			}
			if res.Digest != v.Expected.Digest {
				t.Fatalf("digest %s, want %s", res.Digest, v.Expected.Digest)
			}
			if res.EventsDigest != v.Expected.EventsDigest || !res.ServerChecked {
				t.Fatalf("eventsDigest %s (want %s), serverChecked %v", res.EventsDigest, v.Expected.EventsDigest, res.ServerChecked)
			}
			if res.Summary.GameID != v.GameID || res.Summary.Integrity.Provisional {
				t.Fatalf("summary %+v", res.Summary)
			}
			if v.GameID == "nazar" && req.Mode == "mock" && nazar == nil {
				r := req
				nazar = &r
			}
		})
	}

	t.Run("nazar analysis", func(t *testing.T) {
		if nazar == nil {
			t.Skip("no Nazar mock vector")
		}
		req := *nazar
		req.Analysis = []string{AnalysisNazarClips, AnalysisNazarClipsLinear}
		yes, no := true, false
		req.Hints = &VerifyHints{SeenClip: &no, SessionExpired: &yes}
		res, err := c.Verify(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		for kind, rule := range map[string]string{AnalysisNazarClips: "kerala_5band", AnalysisNazarClipsLinear: "field_kit_linear"} {
			a, ok := res.Analysis[kind]
			if !ok || a.Rule != rule || len(a.Clips) != len(req.Items) {
				t.Fatalf("%s: %+v", kind, a)
			}
			if a.Clips[0].Ref != req.Items[0].Ref || a.Clips[0].Ordinal < 0 {
				t.Fatalf("%s clip 0: %+v", kind, a.Clips[0])
			}
		}
		if !res.Summary.Integrity.HasFlag("INT_SESSION_EXPIRED") {
			t.Fatalf("hint not applied: %+v", res.Summary.Integrity)
		}
	})

	t.Run("nazar tampered client score", func(t *testing.T) {
		if nazar == nil {
			t.Skip("no Nazar mock vector")
		}
		req := *nazar
		req.ClientResult = json.RawMessage(`{"score":{"pct":100},"findings":[{"findingId":"NAZ_FAKE"}]}`)
		res, err := c.Verify(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		if res.Comparison == nil || res.Comparison.Match || !res.Summary.Integrity.HasFlag("INT_REPLAY_MISMATCH") {
			t.Fatalf("comparison %+v integrity %+v", res.Comparison, res.Summary.Integrity)
		}
	})

	t.Run("problem types", func(t *testing.T) {
		if nazar == nil {
			t.Skip("no Nazar mock vector")
		}
		req := *nazar
		req.Digest = "sha256:" + strings.Repeat("0", 64)
		_, err := c.Verify(ctx, req)
		if ProblemType(err) != "digest-mismatch" || !isInvalid(err) {
			t.Fatalf("err = %v", err)
		}
		bad := New(base, "wrong-secret", 5*time.Second, servertime.System{})
		_, err = bad.Verify(ctx, *nazar)
		if ProblemType(err) != "unauthorized" || !isUnavailable(err) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("versions", func(t *testing.T) {
		v, err := c.Versions(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range []string{"/verify", "/learn/answers", "/learn/state", "/gamification/evaluate", "/clip/agreement", "/clip/manifests"} {
			if !contains(v.Routes, r) {
				t.Fatalf("route %s missing from %v", r, v.Routes)
			}
		}
	})

	t.Run("learn", func(t *testing.T) { learnShapes(t, c) })
	t.Run("clip", func(t *testing.T) { clipShapes(t, c) })
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}

func isInvalid(err error) bool     { return err != nil && errors.Is(err, ErrInvalid) }
func isUnavailable(err error) bool { return err != nil && errors.Is(err, ErrUnavailable) }

// nowMs is a fixed instant (Sat 2026-10-24 10:00 IST).
var contractNow = time.Date(2026, 10, 24, 4, 30, 0, 0, time.UTC)

func learnShapes(t *testing.T, c *Client) {
	ctx := context.Background()
	now := contractNow.UnixMilli()
	opt := func(s string) *string { return &s }
	lat, timer := 5400, 30000
	ans, err := c.LearnAnswers(ctx, LearnAnswersRequest{
		Now: now,
		Answers: []Answer{
			{ClientAnswerID: "a1", QRef: "C-LL1-001:v1", SelectedOptionID: opt("a"), Confidence: "100", LatencyMs: &lat, TimerMs: &timer, AnsweredAt: now - 60_000, SourceSID: "s1"},
			{ClientAnswerID: "a2", QRef: "C-LL1-002:v1", SelectedOptionID: nil, AnsweredAt: now - 30_000},
		},
		ReviewLog: []ReviewLogEntry{{CardID: "C-LL1-001", Rating: 3, ReviewedAt: now - 7*24*3600*1000, Confidence: "75"}},
	})
	if err != nil {
		t.Fatalf("/learn/answers: %v", err)
	}
	if len(ans.Results) != 2 || ans.Results[1].Correct || ans.Results[0].CardID != "C-LL1-001" || len(ans.Cards) == 0 {
		t.Fatalf("/learn/answers: %+v", ans)
	}

	log := []ReviewLogEntry{}
	for _, r := range ans.Results {
		log = append(log, ReviewLogEntry{CardID: r.CardID, Rating: r.Rating, ReviewedAt: int64(r.ReviewedAt)})
	}
	nazar := 72.0
	st, err := c.LearnState(ctx, LearnStateRequest{
		Now: now, ReviewLog: log,
		RatedAnswers:  []RatedAnswer{{Correct: true, Confidence: "75"}, {Correct: false, Confidence: "100"}},
		ConceptCounts: map[string]int{"LL1": 30, "LL2": 23, "M1": 10},
		StateCode:     "JK",
		GateInput:     &GateInput{LlMockPcts: []float64{70, 80}, PassMarkPct: 60},
		NazarScore:    &nazar,
	})
	if err != nil {
		t.Fatalf("/learn/state: %v", err)
	}
	if len(st.NodeStates) == 0 || !st.Readiness.Gate.BookAnywayVisible || len(st.Calibration.Bins) == 0 {
		t.Fatalf("/learn/state: %+v", st)
	}

	y, w := contractNow.In(servertime.IST).ISOWeek()
	sess := &SessionLike{GameID: "nazar", Mode: "mock", Findings: []SessionFinding{{FindingID: "NAZ_LATE_RESPONSE"}},
		Integrity: SessionIntegrity{Trust: 1, Flags: []string{}}}
	sess.Score.Pct = 58
	score := 91.0
	ev, err := c.EvaluateGamification(ctx, EvaluateRequest{
		Now: now, Session: sess, MinutesToday: 30, SessionMinutes: 12, XPTotal: 290,
		NodeStates: map[string]string{"SK-LL1": "learning"}, VerifiedNazarMocks: 1,
		WeekKey: fmt.Sprintf("%04d-W%02d", y, w), SessionsThisWeek: 2,
		BadgeHistory: BadgeHistory{HasAccount: true, Nazar: &BadgeNazar{Score: &score, EligibleMocks: 3}},
	})
	if err != nil {
		t.Fatalf("/gamification/evaluate: %v", err)
	}
	if ev.XP.Session == nil || ev.Streak.Notify || len(ev.Badges.Statuses) != 9 || ev.Rank.Rank == "" {
		t.Fatalf("/gamification/evaluate: %+v", ev)
	}
	_, err = c.EvaluateGamification(ctx, EvaluateRequest{Now: now, WeekKey: "2020-W01", BadgeHistory: BadgeHistory{HasAccount: true}})
	if ProblemType(err) != "week-mismatch" {
		t.Fatalf("week mismatch: %v", err)
	}
}

const publishedClip = `{"clipId":"JMU-0012","version":3,"status":"published","tenantTags":["JK"],"city":"Jammu",
"roadType":"urban_arterial","timeOfDay":"day","weather":"clear","pov":"2W","capturedMonth":"2026-10","speedKmhEst":40,
"speedSource":"rider_log","durationMs":38000,"hazards":[{"hazardId":"h1","hazardType":"bus_stop_pedestrian",
"window":{"aMs":12400,"bMs":16900},"raterCount":2,"deltaOnsetMs":300,"deltaEndMs":600,"adjudicated":false,"occlusion":true,
"cueText":{"en":"Feet visible at the bus's front edge","hi":"bus ke aage pair"}}],"quietSegments":[{"fromMs":0,"toMs":9000}],
"difficulty":{"curator":3,"empirical":null,"irt":null,"nTakers":0},"modules":["M18","M5"],"licence":"CC-BY-4.0",
"attribution":"Margdarshak clip bank, team Chanakya (Nestiq Private Limited), 2026",
"blurAudit":{"auditor":"rater-07","framesChecked":1140,"misses":0,"auditedAt":"2026-10-23T09:12:00Z"},
"media":[{"res":"360p","bytes":1840000,"sha256":"1111111111111111111111111111111111111111111111111111111111111111"},
{"res":"480p","bytes":2900000,"sha256":"2222222222222222222222222222222222222222222222222222222222222222"}]}`

func clipShapes(t *testing.T, c *Client) {
	ctx := context.Background()
	a := RaterSubmission{Rater: "rater-01", ClipID: "JMU-0012", Version: 3, SubmittedAt: "2026-10-23T10:00:00Z",
		Marks: []RaterMark{{HazardType: "bus_stop_pedestrian", AMs: 12000, BMs: 16500}}}
	b := RaterSubmission{Rater: "rater-02", ClipID: "JMU-0012", Version: 3, SubmittedAt: "2026-10-23T10:05:00Z",
		Marks: []RaterMark{{HazardType: "bus_stop_pedestrian", AMs: 12500, BMs: 17000}}}
	ag, err := c.ClipAgreement(ctx, AgreementOp(a, b))
	if err != nil {
		t.Fatalf("agreement: %v", err)
	}
	if ag.Op != OpAgreement || ag.Agreement == nil || !ag.Agreement.Accepted || len(ag.Agreement.FinalHazards) != 1 {
		t.Fatalf("agreement: %+v", ag)
	}

	adj, err := c.ClipAgreement(ctx, AdjudicateOp(a, b, AdjudicationInput{Adjudicator: "rater-03", DecidedAt: "2026-10-23T11:00:00Z",
		ReasonCode: "window_resolved", Decisions: []AdjudicationDecision{}}))
	if err != nil {
		t.Fatalf("adjudicate: %v", err)
	}
	if adj.Adjudication == nil || adj.Agreement == nil {
		t.Fatalf("adjudicate: %+v", adj)
	}

	fw, err := c.ClipAgreement(ctx, FinalWindowOp(WindowMark{AMs: 12000, BMs: 16500}, WindowMark{AMs: 12500, BMs: 17000}))
	if err != nil || fw.Window == nil {
		t.Fatalf("final_window: %+v %v", fw, err)
	}

	sc, err := c.ClipAgreement(ctx, ScoringClipOp(json.RawMessage(publishedClip)))
	if err != nil || len(sc.ScoringClip) == 0 {
		t.Fatalf("scoring_clip: %+v %v", sc, err)
	}

	m, err := c.ClipManifests(ctx, ClipManifestsRequest{
		Clips: []json.RawMessage{json.RawMessage(publishedClip)}, FlashPassed: map[string]bool{"JMU-0012@3": true},
		MediaBaseURL: "https://media.example",
	})
	if err != nil {
		t.Fatalf("manifests: %v", err)
	}
	if m.Client == nil || len(m.Client.Clips) != 1 || !m.MockEligibility["JMU-0012@3"].Eligible || len(m.Bank) == 0 {
		t.Fatalf("manifests: %+v", m)
	}
	if u := m.Client.Clips[0].Media[0].URL; u != "https://media.example/clips/JMU-0012/v3/360p.mp4" {
		t.Fatalf("media url %q", u)
	}
	if strings.Contains(string(mustJSON(t, m.Client)), "12400") {
		t.Fatal("client manifest leaked a hazard window")
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
