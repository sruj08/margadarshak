package httpapi_test

// P2 integration harness: a fake compute service (POST /verify answered locally; the learn,
// gamification and clip routes forwarded to the real TypeScript verifier when a test asks for it),
// a mock object store in a temp dir, admin personas and published clips seeded straight into
// content.clips.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/compute"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore/mock"
	"github.com/sruj08/margadarshak/services/api/internal/app"
	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// p2Compute is the fake compute service. Verify behaves like the verifier on a fixed score: the
// server result wins, a differing client preview is flagged INT_REPLAY_MISMATCH, hints become
// flags, and Nazar sessions get a per-clip analysis built from the inline clip documents.
type p2Compute struct {
	mu        sync.Mutex
	real      ports.ComputePoster // nil: the learn/gamify/clip routes are unavailable
	verifyErr error
	pct       float64
	trust     float64
	timing    string
	lateS     float64
	clipMarks []float64 // when set, the Kerala marks of clip i in the nazar_clips analysis (cycled)
	requests  []ports.VerifyRequest
	// withFindings makes the server result carry two debrief findings (API-36 tests).
	withFindings bool
}

func (f *p2Compute) findings() []any {
	if !f.withFindings {
		return []any{}
	}
	return []any{
		map[string]any{"findingId": "NAZ_LATE_RESPONSE", "severity": 0.7, "critical": false, "ruleIds": []any{}, "skillId": "SK-M18",
			"drillIds": []any{"DR-NAZ-OCCL-TRUCK_LEFT_TURN"},
			"facts":    map[string]any{"late_s": 1.4, "speed_kmh": 30, "metres": 12, "hazard_type": "truck_left_turn", "clip_ordinal": 7}},
	}
}

func newP2Compute() *p2Compute { return &p2Compute{pct: 72, trust: 1, timing: "rvfc", lateS: 0.4} }

func (f *p2Compute) set(fn func(*p2Compute)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

func (f *p2Compute) verifyCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

func (f *p2Compute) lastVerify() ports.VerifyRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests[len(f.requests)-1]
}

func (f *p2Compute) PostJSON(ctx context.Context, path string, in, out any) error {
	f.mu.Lock()
	real := f.real
	f.mu.Unlock()
	if real == nil {
		return fmt.Errorf("%w: %s (fake compute: no real verifier)", ports.ErrComputeUnavailable, path)
	}
	return real.PostJSON(ctx, path, in, out)
}

type fakeHazard struct {
	HazardID   string `json:"hazardId"`
	HazardType string `json:"hazardType"`
	Window     struct {
		AMs float64 `json:"aMs"`
	} `json:"window"`
}

func (f *p2Compute) Verify(_ context.Context, req ports.VerifyRequest) (*ports.VerifyResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, req)
	if f.verifyErr != nil {
		return nil, f.verifyErr
	}
	flags := []string{}
	trust := f.trust
	var cmp *ports.Comparison
	if len(req.ClientResult) > 0 {
		var c struct {
			Score struct {
				Pct float64 `json:"pct"`
			} `json:"score"`
		}
		_ = json.Unmarshal(req.ClientResult, &c)
		cmp = &ports.Comparison{Match: c.Score.Pct == f.pct, ClientPct: c.Score.Pct, ServerPct: f.pct, DeltaPct: c.Score.Pct - f.pct, FindingIDsMatch: true}
		if !cmp.Match {
			flags = append(flags, "INT_REPLAY_MISMATCH")
			trust *= 0.7
		}
	}
	if req.Hints != nil && req.Hints.SeenClip != nil && *req.Hints.SeenClip {
		flags = append(flags, "INT_SEEN_CLIP")
	}
	if req.Hints != nil && req.Hints.SessionExpired != nil && *req.Hints.SessionExpired {
		flags = append(flags, "INT_SESSION_EXPIRED")
		trust *= 0.8
	}
	max := float64(len(req.Items))
	if max == 0 {
		max = 1
	}
	result, _ := json.Marshal(map[string]any{
		"sid": req.SID, "gameId": req.GameID, "gameVersion": req.GameVersion, "scoringVersion": req.ScoringVersion,
		"seed": req.Seed, "seedOrigin": req.SeedOrigin, "difficulty": req.Difficulty, "mode": req.Mode,
		"score": map[string]any{"raw": f.pct * max / 100, "max": max, "pct": f.pct, "passed": f.pct >= 60, "passRule": nil,
			"components": []any{}, "capApplied": nil},
		"findings": f.findings(), "evidence": []any{}, "calibration": nil,
		"integrity": map[string]any{"flags": flags, "trust": trust, "timingMode": f.timing, "provisional": false},
		"replay":    map[string]any{"seed": req.Seed, "inputs": req.Inputs},
	})
	resp := &ports.VerifyResponse{Result: result, Digest: "sha256:result", EventsDigest: req.Digest, Comparison: cmp, ServerChecked: true}
	if len(req.Analysis) > 0 {
		docs := map[string][]fakeHazard{}
		if req.Content != nil {
			for _, d := range req.Content.Items {
				var doc struct {
					ClipID  string       `json:"clipId"`
					Version int          `json:"version"`
					Hazards []fakeHazard `json:"hazards"`
				}
				if json.Unmarshal(d, &doc) == nil {
					docs[fmt.Sprintf("clip:%s@%d", doc.ClipID, doc.Version)] = doc.Hazards
				}
			}
		}
		resp.Analysis = map[string]ports.NazarAnalysis{}
		for _, kind := range req.Analysis {
			rule := "kerala_5band"
			if kind == ports.AnalysisNazarClipsLinear {
				rule = "field_kit_linear"
			}
			na := ports.NazarAnalysis{Rule: rule, Clips: []ports.ClipAnalysis{}}
			for i, it := range req.Items {
				ca := ports.ClipAnalysis{Ordinal: i + 1, Ref: it.Ref, Taps: 1, MaxTapsInWindow: 1, Hazards: []ports.HazardAnalysis{}}
				for _, h := range docs[it.Ref] {
					band, late := 1, f.lateS
					tap, metres, credit := h.Window.AMs+late*1000, late*11.1, 5.0
					if rule == "field_kit_linear" {
						credit = 1
					}
					ca.Hazards = append(ca.Hazards, ports.HazardAnalysis{HazardID: h.HazardID, HazardType: h.HazardType, Credit: credit,
						Band: &band, TapMt: &tap, LateS: &late, Metres: &metres})
					ca.Marks += credit
				}
				if len(f.clipMarks) > 0 && rule == "kerala_5band" && len(ca.Hazards) > 0 {
					ca.Marks = f.clipMarks[i%len(f.clipMarks)]
				}
				na.Clips = append(na.Clips, ca)
			}
			resp.Analysis[kind] = na
		}
	}
	sum, err := ports.ParseResult(result)
	if err != nil {
		return nil, err
	}
	resp.Summary = sum
	return resp, nil
}

// p2Env is an env with the fake compute and a temp mock object store.
type p2Env struct {
	*env
	compute *p2Compute
	media   *mock.Store
}

func newP2Env(t *testing.T) *p2Env { return newP2EnvCfg(t, nil) }

// newP2EnvCfg is newP2Env with a config mutation (applied before the app is built).
func newP2EnvCfg(t *testing.T, mutate func(*config.Config), extra ...func(*app.Options)) *p2Env {
	t.Helper()
	fc := newP2Compute()
	var media *mock.Store
	var e *env
	opts := append([]func(*app.Options){func(o *app.Options) { o.Compute = fc }}, extra...)
	if mutate == nil {
		e = newEnv(t, opts...)
	} else {
		e = newEnvCfg(t, mutate, opts...)
	}
	// The object store needs the server URL, which exists only after newEnv; rebuild it on the
	// live clip service (it reads Objects on every call).
	var err error
	media, err = mock.New(t.TempDir(), e.srv.URL, []byte("test-media-secret-0123456789abcdef"), e.clock)
	require.NoError(t, err)
	e.app.P2.ObjectStore = media
	e.app.P2.Clips.Objects = media
	return &p2Env{env: e, compute: fc, media: media}
}

// useRealCompute forwards the learn, gamification and clip routes to the real verifier (spawned
// once per test binary). Skipped without node or under -short.
func (e *p2Env) useRealCompute(t *testing.T) {
	t.Helper()
	url := sharedVerifier(t, e.cfg.ScoreVerifierSecret)
	// Signed with the wall clock: the verifier rejects signatures outside its 5-minute window, and
	// the test clock is fixed in the past. Request bodies still carry the test clock (now).
	c := compute.New(url, e.cfg.ScoreVerifierSecret, 10*time.Second, servertime.System{})
	e.compute.set(func(f *p2Compute) { f.real = c })
}

var (
	verifierOnce sync.Once
	verifierURL  string
	verifierErr  string
	verifierStop func()
)

func stopSharedVerifier() {
	if verifierStop != nil {
		verifierStop()
	}
}

func repoRootDir(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	require.NoError(t, err)
	return root
}

// sharedVerifier spawns services/score-verifier from source with its built content directory
// (server LL keys; `pnpm --filter @margdarshak/score-verifier build:content`).
func sharedVerifier(t *testing.T, secret string) string {
	t.Helper()
	if testing.Short() {
		t.Skip("spawns the Node verifier; skipped under -short")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH")
	}
	root := repoRootDir(t)
	dir := filepath.Join(root, "services", "score-verifier")
	contentDir := filepath.Join(dir, "content")
	if _, err := os.Stat(filepath.Join(contentDir, "q")); err != nil {
		t.Skip("verifier content not built (pnpm --filter @margdarshak/score-verifier build:content)")
	}
	verifierOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		cmd := exec.CommandContext(ctx, node, "--conditions=margdarshak-source", "--experimental-strip-types", filepath.Join(dir, "src", "server.ts"))
		cmd.Dir = dir
		env := []string{}
		for _, kv := range os.Environ() {
			k, _, _ := strings.Cut(kv, "=")
			switch strings.ToUpper(k) {
			case "VERIFIER_CONTENT_DIR", "VERIFIER_SHARED_SECRET", "SCORE_VERIFIER_HMAC_SECRET", "PORT", "SCORE_VERIFIER_PORT", "HOST", "VERIFIER_BODY_LIMIT_BYTES":
				continue
			}
			env = append(env, kv)
		}
		cmd.Env = append(env, "VERIFIER_SHARED_SECRET="+secret, "PORT=0", "HOST=127.0.0.1", "VERIFIER_CONTENT_DIR="+contentDir,
			"VERIFIER_BODY_LIMIT_BYTES=1048576")
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			cancel()
			verifierErr = err.Error()
			return
		}
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Start(); err != nil {
			cancel()
			verifierErr = err.Error()
			return
		}
		verifierStop = func() { cancel(); _ = cmd.Process.Kill(); _ = cmd.Wait() }
		ports := make(chan int, 1)
		go func() {
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
			_, _ = io.Copy(io.Discard, stdout)
		}()
		select {
		case p := <-ports:
			verifierURL = fmt.Sprintf("http://127.0.0.1:%d", p)
		case <-time.After(90 * time.Second):
			verifierErr = "verifier did not start: " + stderr.String()
		}
	})
	if verifierURL == "" {
		t.Fatalf("score verifier: %s", verifierErr)
	}
	return verifierURL
}

// adminClient signs in as a clip-admin persona (curator_01, rater_01, rater_02, rater_03).
func (e *env) adminClient(persona string) *client {
	e.t.Helper()
	c := e.client()
	r := c.do("POST", "/v1/demo/personas/"+persona+"/session", nil, map[string]string{"Prefer": "return=token"})
	require.Equalf(e.t, http.StatusCreated, r.Status, "%s", r.Body)
	c.bearer = r.json(e.t)["session_token"].(string)
	return c
}

// personaClient signs in as a listed persona (rahul = Rahul's parent, with Rahul as a consented minor).
func (e *env) personaClient(persona string) *client {
	e.t.Helper()
	return e.adminClient(persona)
}

// clipConsentID inserts a contributor and an active clip_contribution consent artefact.
func (e *env) clipConsentID() string {
	e.t.Helper()
	ctx := context.Background()
	a := &store.Applicant{ID: ids.New(), TenantID: "JK", Kind: "device"}
	c := &store.Consent{ID: ids.New(), TenantID: "JK", ApplicantID: a.ID, Purpose: "clip_contribution",
		DataCategories: []string{"dashcam_footage"}, NoticeVersion: "2026.10", GrantedAt: e.clock.Now()}
	require.NoError(e.t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		if err := store.InsertApplicant(ctx, tx, a); err != nil {
			return err
		}
		return store.InsertConsent(ctx, tx, c)
	}))
	return c.ID.String()
}

// seedPublishedClips publishes n mock-eligible JK clips (KL-0001 …) with one hazard each, at the
// given curator difficulties (cycled), straight into content.clips.
func (e *env) seedPublishedClips(n int, difficulties ...int) []string {
	e.t.Helper()
	if len(difficulties) == 0 {
		difficulties = []int{2, 3, 4}
	}
	consent := e.clipConsentID()
	st := store.NewClipsStore(e.app.DB)
	now := e.clock.Now()
	var refs []string
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("KL-%04d", i+1)
		d := difficulties[i%len(difficulties)]
		speed := 40.0
		c := &clips.Clip{ClipID: id, Version: 1, Status: clips.StatusPublished, Tenant: "JK", RawObjectKey: "raw/" + id + ".mp4",
			FilmedBy: "passenger", ContributorConsentID: consent, RegisteredBy: "curator-01", RegisteredAt: now,
			CueTexts: map[string]clips.CueText{"h1": {En: "Feet at the bus front", Hi: "बस के आगे पैर"}}, UpdatedAt: now,
			AuditPassedAt: &now, PublishedAt: &now, RawDeletedAt: &now, MockEligible: true, MockReasons: []string{}}
		c.Doc = clips.Doc{ClipID: id, Version: 1, Status: clips.StatusPublished, TenantTags: []string{"JK", "KL"}, City: "Jammu",
			RoadType: "urban_arterial", TimeOfDay: "day", Weather: "clear", POV: "2W", CapturedMonth: "2026-10",
			SpeedKmhEst: &speed, SpeedSource: "rider_log", DurationMs: 30000,
			Hazards: []clips.DocHazard{{HazardID: "h1", HazardType: "bus_stop_pedestrian", Window: clips.Window{AMs: 12000 + 100*i, BMs: 16500 + 100*i},
				RaterCount: 2, DeltaOnsetMs: 300, DeltaEndMs: 300, CueText: clips.CueText{En: "Feet at the bus front", Hi: "बस के आगे पैर"}}},
			QuietSegments: []clips.QuietSegment{{FromMs: 0, ToMs: 9000}},
			Difficulty:    clips.Difficulty{Curator: &d}, Modules: []string{"M18"}, Licence: clips.Licence, Attribution: clips.Attribution,
			Media:     []clips.MediaEntry{{Res: "360p", Bytes: 1_840_000, SHA256: strings.Repeat("a", 64)}, {Res: "480p", Bytes: 2_900_000, SHA256: strings.Repeat("b", 64)}},
			BlurAudit: &clips.DocBlurAudit{Auditor: "auditor-01", FramesChecked: 900, Misses: 0, AuditedAt: now.UTC().Format("2006-01-02T15:04:05.000Z")}}
		require.NoError(e.t, st.InsertClip(context.Background(), c))
		refs = append(refs, "clip:"+id+"@1")
	}
	return refs
}

// fakeReplay is a well-formed replay package (the fake compute does not decode it).
func fakeReplay(seed string) map[string]any {
	sum := strings.Repeat("0", 64-len(seed)) + seed
	return map[string]any{"telemetryVersion": 1, "encoding": "mdr1", "inputs": "AAEC", "digest": "sha256:" + sum, "eventCount": 3}
}

// clientPreview is a client SessionResult preview with the given score.
func clientPreview(pct float64, max float64) map[string]any {
	return map[string]any{"score": map[string]any{"raw": pct * max / 100, "max": max, "pct": pct}, "findings": []any{},
		"integrity": map[string]any{"flags": []any{}, "trust": 1, "timingMode": "rvfc", "provisional": true}}
}

// sessionGet reads one game.sessions column for assertions.
func (e *env) sessionColumn(sid, col string, dst any) {
	e.t.Helper()
	require.True(e.t, slices.Contains([]string{"status", "server_score_pct", "client_score_pct", "trust", "integrity_flags", "eligibility", "hints"}, col))
	require.NoError(e.t, e.app.DB.System(context.Background(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), "SELECT "+col+" FROM game.sessions WHERE session_id = $1", sid).Scan(dst)
	}))
}
