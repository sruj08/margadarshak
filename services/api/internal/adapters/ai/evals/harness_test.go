//go:build evals

// Package evals is the Go eval harness for the P3 agents (AI_EVALS §4; ADK for Go has no eval CLI).
// The JSONL files in ai/evals are the source of truth. EVAL_MODE=offline (default) runs the real
// pipelines (validators, provenance, PII gate, routes, template fallback) against scripted golden
// and adversarial model answers; EVAL_MODE=model runs the same cases against Gemini (paid tier,
// synthetic data only). Every agent writes a summary (EVAL_OUT) and fails on a thresholds.yaml miss.
package evals

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"iter"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/genai"
	"gopkg.in/yaml.v3"

	"google.golang.org/adk/model"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
)

var quiet = slog.New(slog.DiscardHandler)

func modelMode() bool { return os.Getenv("EVAL_MODE") == "model" }

func suiteDir(t *testing.T) string {
	if d := os.Getenv("EVAL_SUITE_DIR"); d != "" {
		return d
	}
	return filepath.Join("..", "..", "..", "..", "..", "..", "ai", "evals")
}

func contentDir() string { return filepath.Join("..", "..", "..", "..", "..", "..", "content") }

// readJSONL decodes every non-empty line of ai/evals/<name> into T.
func readJSONL[T any](t *testing.T, name string) []T {
	t.Helper()
	f, err := os.Open(filepath.Join(suiteDir(t), name))
	if err != nil {
		t.Fatalf("eval set %s: %v", name, err)
	}
	defer f.Close()
	var out []T
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 4<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var v T
		if err := json.Unmarshal([]byte(line), &v); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		out = append(out, v)
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return out
}

// geminiConfig is the model-mode config for an agent family (env-pinned models, MD-301).
func geminiConfig(t *testing.T, pinnedEnv string) ai.Config {
	key := os.Getenv("GEMINI_API_KEY")
	if key == "" {
		key = os.Getenv("GOOGLE_API_KEY")
	}
	if key == "" {
		t.Skip("EVAL_MODE=model needs GEMINI_API_KEY")
	}
	m := os.Getenv(pinnedEnv)
	if m == "" {
		m = os.Getenv("GEMINI_MODEL")
	}
	return ai.Config{APIKey: key, Model: m, Log: quiet}
}

// scripted is an offline model.LLM: each call is answered by reply(prompt), so the real ADK
// runner, plugins and validators run without a network. It records every prompt (the
// "outgoing request log" the PII and route metrics assert on).
type scripted struct {
	mu      sync.Mutex
	reply   func(prompt string) (string, error)
	prompts []string
}

func (s *scripted) Name() string { return "eval-scripted" }

func (s *scripted) GenerateContent(_ context.Context, req *model.LLMRequest, _ bool) iter.Seq2[*model.LLMResponse, error] {
	var prompt strings.Builder
	for _, c := range req.Contents {
		for _, p := range c.Parts {
			if p != nil {
				prompt.WriteString(p.Text)
			}
		}
	}
	s.mu.Lock()
	s.prompts = append(s.prompts, prompt.String())
	s.mu.Unlock()
	text, err := s.reply(prompt.String())
	return func(yield func(*model.LLMResponse, error) bool) {
		if err != nil {
			yield(nil, err)
			return
		}
		yield(&model.LLMResponse{Content: genai.NewContentFromText(text, genai.RoleModel), TurnComplete: true}, nil)
	}
}

func (s *scripted) calls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.prompts)
}

func (s *scripted) sawText(sub string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.prompts {
		if strings.Contains(p, sub) {
			return true
		}
	}
	return false
}

// fallbacks is an agent's count of transient model failures so far (timeouts, provider errors,
// an open breaker): a rise during a case means the model never answered it.
func fallbacks(agent string) int {
	for _, s := range ai.Usage() {
		if s.Agent == agent {
			return s.Fallbacks["timeout"] + s.Fallbacks["model_error"] + s.Fallbacks["circuit_open"]
		}
	}
	return 0
}

// paced runs one model-mode case, pacing calls (EVAL_PACE_MS, default 3 s) and retrying with
// backoff when the provider failed transiently (a rate limit is not a quality result). Offline it
// just runs once.
func paced(t *testing.T, agent string, run func()) {
	if !modelMode() {
		run()
		return
	}
	pace := 3 * time.Second
	if v, err := strconv.Atoi(os.Getenv("EVAL_PACE_MS")); err == nil {
		pace = time.Duration(v) * time.Millisecond
	}
	for attempt := 0; ; attempt++ {
		time.Sleep(pace)
		before := fallbacks(agent)
		run()
		if fallbacks(agent) == before || attempt == 3 {
			return
		}
		wait := time.Duration(20*(attempt+1)) * time.Second
		t.Logf("%s: transient model failure, retrying in %s", agent, wait)
		time.Sleep(wait)
	}
}

// thresholds is ai/evals/thresholds.yaml: per agent, metric -> {min|max}.
type gate struct {
	Min *float64 `yaml:"min"`
	Max *float64 `yaml:"max"`
}

func loadGates(t *testing.T) map[string]map[string]gate {
	path := os.Getenv("EVAL_THRESHOLDS")
	if path == "" {
		path = filepath.Join(suiteDir(t), "thresholds.yaml")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("thresholds: %v", err)
	}
	var doc struct {
		Agents map[string]map[string]gate `yaml:"agents"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("thresholds: %v", err)
	}
	return doc.Agents
}

// report collects one agent's metrics and checks them against the gates.
type report struct {
	agent   string
	cases   int
	metrics map[string]float64
	fails   []string
}

func newReport(agent string) *report { return &report{agent: agent, metrics: map[string]float64{}} }

// rate records hits/total as a percentage.
func (r *report) rate(metric string, hits, total int) {
	if total == 0 {
		r.metrics[metric] = 100
		return
	}
	r.metrics[metric] = math.Round(1000*float64(hits)/float64(total)) / 10
}

func (r *report) count(metric string, n int) { r.metrics[metric] = float64(n) }

// failf records a case-level miss for the summary (the gate decides pass/fail).
func (r *report) failf(format string, a ...any) {
	if len(r.fails) < 40 {
		r.fails = append(r.fails, fmt.Sprintf(format, a...))
	}
}

// finish checks every gated metric, writes EVAL_OUT and fails the test on a miss.
func (r *report) finish(t *testing.T) {
	t.Helper()
	gates := loadGates(t)[r.agent]
	passed := true
	for metric, g := range gates {
		v, ok := r.metrics[metric]
		switch {
		case !ok:
			t.Errorf("%s: gate %s has no measured value", r.agent, metric)
			passed = false
		case g.Min != nil && v < *g.Min:
			t.Errorf("%s: %s = %.1f below gate %.1f", r.agent, metric, v, *g.Min)
			passed = false
		case g.Max != nil && v > *g.Max:
			t.Errorf("%s: %s = %.1f above gate %.1f", r.agent, metric, v, *g.Max)
			passed = false
		}
	}
	for _, f := range r.fails {
		t.Log(f)
	}
	spendINR := 0.0
	for _, s := range ai.Usage() {
		spendINR += float64(s.EstCostMicro) / 1e6 * 88
	}
	summary := map[string]any{"agent": r.agent, "mode": map[bool]string{true: "model", false: "offline"}[modelMode()],
		"cases": r.cases, "metrics": r.metrics, "passed": passed, "spend_inr": math.Round(spendINR*100) / 100,
		"schema_valid_pct": r.metrics["schema_valid_pct"], "invented_numbers": r.metrics["invented_numbers"],
		"rule_id_precision_pct": r.metrics["rule_id_precision_pct"], "fallback_pct": r.metrics["fallback_pct"]}
	t.Logf("%s summary: %v", r.agent, summary)
	b, _ := json.MarshalIndent(summary, "", "  ")
	if out := os.Getenv("EVAL_OUT"); out != "" {
		if err := os.WriteFile(out, b, 0o644); err != nil {
			t.Errorf("EVAL_OUT: %v", err)
		}
	}
	// EVAL_REPORT_DIR keeps one file per agent (the dated reports under ai/evals/reports, MD-325).
	if dir := os.Getenv("EVAL_REPORT_DIR"); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err == nil {
			_ = os.WriteFile(filepath.Join(dir, r.agent+".json"), append(b, '\n'), 0o644)
		}
	}
	if max := os.Getenv("EVAL_MAX_INR"); max != "" {
		var cap float64
		if _, err := fmt.Sscan(max, &cap); err == nil && spendINR > cap {
			t.Errorf("spend %.2f INR exceeds EVAL_MAX_INR %.0f", spendINR, cap)
		}
	}
}

// TestAgentEvals runs every agent suite; the CI matrix selects one with -run TestAgentEvals/<agent>.
func TestAgentEvals(t *testing.T) {
	t.Run("debrief", evalDebrief)
	t.Run("tutor", evalTutor)
	t.Run("screen_decoder", evalDecoder)
	t.Run("voice_text", evalVoice)
	t.Run("coach", evalCoach)
	t.Run("sign_snap", evalSignSnap)
}

// TestSignSnap is the nightly multimodal alias (evals.yml).
func TestSignSnap(t *testing.T) { evalSignSnap(t) }

// TestClipWindows: the ClipWindowProposer (M-06) is still the P2 stub (`clip.propose_windows`
// returns no proposals, D8: no unaudited frame goes to a model), so there is nothing to score.
func TestClipWindows(t *testing.T) {
	t.Skip("ClipWindowProposer is a stub until clip.propose_windows sends frames to a model (D8)")
}

// TestModelDrift warns when a pinned model looks retired (no network: name check only).
func TestModelDrift(t *testing.T) {
	for _, k := range []string{"GEMINI_MODEL", "GEMINI_MODEL_DEBRIEF", "GEMINI_MODEL_VISION", "GEMINI_MODEL_TEXT_LITE", "GEMINI_MODEL_LIVE"} {
		if v := os.Getenv(k); strings.Contains(v, "legacy") || strings.Contains(v, "-exp") {
			t.Logf("warning: %s=%s looks retired or experimental", k, v)
		}
	}
}
