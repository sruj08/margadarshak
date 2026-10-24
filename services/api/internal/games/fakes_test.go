package games

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/compute"
)

// fakeDB runs fn without a real transaction. Errors roll nothing back: tests that need rollback
// semantics check the store explicitly.
type fakeDB struct{}

func (fakeDB) Tenant(_ context.Context, _ string, fn func(pgx.Tx) error) error { return fn(nil) }
func (fakeDB) System(_ context.Context, fn func(pgx.Tx) error) error           { return fn(nil) }

// memStore is the exported MemStore (memstore.go); the tests read its fields directly.
type memStore = MemStore

func newMemStore() *memStore { return NewMemStore() }

// fakeClips is a clip bank: n clips with difficulties, scoring documents with one hazard each.
type fakeClips struct {
	clips []ClipItem
	asset int
}

func newFakeClips(difficulties ...int) *fakeClips {
	f := &fakeClips{}
	for i, d := range difficulties {
		id := fmt.Sprintf("KL-%04d", i+1)
		f.clips = append(f.clips, ClipItem{Ref: "clip:" + id + "@1", ClipID: id, Version: 1, CuratorDifficulty: d})
	}
	return f
}

func (f *fakeClips) ScoringDocs(_ context.Context, refs []string) ([]json.RawMessage, error) {
	out := make([]json.RawMessage, len(refs))
	for i, ref := range refs {
		id, v, ok := clipRef(ref)
		if !ok {
			return nil, fmt.Errorf("bad ref %s", ref)
		}
		out[i] = json.RawMessage(fmt.Sprintf(`{"clipId":%q,"version":%d,"speedKmhEst":40,"durationMs":30000,`+
			`"hazards":[{"hazardId":"h1","hazardType":"bus_stop_pedestrian","window":{"aMs":12000,"bMs":16500}}],"quietSegments":[]}`, id, v))
	}
	return out, nil
}

func (f *fakeClips) MockEligible(_ context.Context, _ string, exclude []string, n int) ([]ClipItem, error) {
	ex := setOf(exclude)
	var out []ClipItem
	for _, c := range f.clips {
		if !ex[c.ClipID] && len(out) < n {
			out = append(out, c)
		}
	}
	return out, nil
}

func (f *fakeClips) AssetURL(_ context.Context, ref string, sid uuid.UUID) (string, string, int64, error) {
	f.asset++
	return "https://media.test/" + ref + "?sid=" + sid.String(), "ab" + fmt.Sprintf("%062d", f.asset), 1_840_000, nil
}

// fakeCompute answers like the verifier: the server result wins, mismatches are flagged.
type fakeCompute struct {
	mu       sync.Mutex
	requests []compute.VerifyRequest
	err      error // returned instead of a result when set
	pct      float64
	trust    float64
	timing   string
	flags    []string
}

func (f *fakeCompute) Verify(_ context.Context, req compute.VerifyRequest) (*compute.VerifyResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, req)
	if f.err != nil {
		return nil, f.err
	}
	flags := slices.Clone(f.flags)
	if flags == nil {
		flags = []string{}
	}
	trust := f.trust
	var cmp *compute.Comparison
	if len(req.ClientResult) > 0 {
		var c struct {
			Score struct {
				Pct float64 `json:"pct"`
			} `json:"score"`
		}
		_ = json.Unmarshal(req.ClientResult, &c)
		cmp = &compute.Comparison{Match: c.Score.Pct == f.pct, ClientPct: c.Score.Pct, ServerPct: f.pct, DeltaPct: c.Score.Pct - f.pct, FindingIDsMatch: true}
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
	result, _ := json.Marshal(map[string]any{
		"sid": req.SID, "gameId": req.GameID, "gameVersion": req.GameVersion, "scoringVersion": req.ScoringVersion,
		"seed": req.Seed, "seedOrigin": req.SeedOrigin, "difficulty": req.Difficulty, "mode": req.Mode,
		"score":    map[string]any{"raw": f.pct, "max": 100, "pct": f.pct, "passed": f.pct >= 60, "passRule": nil, "components": []any{}, "capApplied": nil},
		"findings": []any{}, "evidence": []any{}, "calibration": nil,
		"integrity": map[string]any{"flags": flags, "trust": trust, "timingMode": f.timing, "provisional": false},
		"replay":    map[string]any{"seed": req.Seed, "inputs": req.Inputs},
	})
	resp := &compute.VerifyResponse{Result: result, Digest: "sha256:result", EventsDigest: req.Digest, Comparison: cmp, ServerChecked: true}
	if len(req.Analysis) > 0 {
		resp.Analysis = map[string]compute.NazarAnalysis{}
		for _, k := range req.Analysis {
			resp.Analysis[k] = compute.NazarAnalysis{Rule: k, Clips: []compute.ClipAnalysis{}}
		}
	}
	sum, err := compute.ParseResult(result)
	if err != nil {
		return nil, err
	}
	resp.Summary = sum
	return resp, nil
}

func (f *fakeCompute) set(fn func(*fakeCompute)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

func (f *fakeCompute) last() compute.VerifyRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests[len(f.requests)-1]
}

func (f *fakeCompute) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

type fakeAwards struct{ calls []VerifiedSession }

func (a *fakeAwards) OnSessionVerified(_ context.Context, _ pgx.Tx, s VerifiedSession) (AwardSummary, error) {
	a.calls = append(a.calls, s)
	return AwardSummary{XPAwarded: 23}, nil
}

type fakeStudy struct{ calls []VerifiedSession }

func (h *fakeStudy) OnSessionVerified(_ context.Context, _ pgx.Tx, s VerifiedSession) error {
	h.calls = append(h.calls, s)
	return nil
}

type fakeRulePack struct{ questions int }

func (f fakeRulePack) Version(context.Context, string) (string, error) { return "2026.10.23", nil }
func (f fakeRulePack) LLMockFormat(context.Context, string) (LLFormat, error) {
	return LLFormat{RuleID: "LLT-JK", Questions: f.questions}, nil
}

type fakeStaircase struct{ level int }

func (f fakeStaircase) Level(context.Context, pgx.Tx, Subject, string, string) (int, error) {
	return f.level, nil
}

// seqRand is a deterministic seed source.
type seqRand struct{ n byte }

func (r *seqRand) Read(p []byte) (int, error) {
	for i := range p {
		r.n++
		p[i] = r.n * 37
	}
	return len(p), nil
}
