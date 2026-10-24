// Package ai wraps Google ADK for Go (google.golang.org/adk) and the Gemini API for the
// narration pipelines (docs/04-ai/AGENTS.md). ADK is used for its agent, runner, session, plugins
// and schema-constrained output; every fact stays in plain Go around one Runner.Run call.
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"google.golang.org/genai"

	"google.golang.org/adk/agent"
	"google.golang.org/adk/agent/llmagent"
	"google.golang.org/adk/model"
	"google.golang.org/adk/model/gemini"
	"google.golang.org/adk/plugin"
	"google.golang.org/adk/runner"
	"google.golang.org/adk/session"
)

// DefaultModel is the demo model (GEMINI_MODEL overrides it).
const DefaultModel = "gemini-3.8-flash"

// Config selects the Gemini model. An empty APIKey means AI is off (callers use templates).
type Config struct {
	APIKey  string
	Model   string
	Timeout time.Duration
	Log     *slog.Logger
}

// Enabled reports whether a key is configured.
func (c Config) Enabled() bool { return strings.TrimSpace(c.APIKey) != "" }

// Structured is one ADK llmagent that answers with JSON matching a schema.
type Structured struct {
	appName  string
	runner   *runner.Runner
	sessions session.Service
	timeout  time.Duration
	log      *slog.Logger
	Model    string
}

// NewStructured builds the agent, an in-memory session service and a runner against Gemini.
func NewStructured(ctx context.Context, cfg Config, name, instruction string, schema *genai.Schema) (*Structured, error) {
	if !cfg.Enabled() {
		return nil, errors.New("ai: no Gemini API key")
	}
	if cfg.Model == "" {
		cfg.Model = DefaultModel
	}
	llm, err := gemini.NewModel(ctx, cfg.Model, &genai.ClientConfig{APIKey: cfg.APIKey, Backend: genai.BackendGeminiAPI})
	if err != nil {
		return nil, fmt.Errorf("ai: gemini model: %w", err)
	}
	return NewStructuredWithModel(llm, cfg, name, instruction, schema)
}

// NewStructuredWithModel is NewStructured over any model.LLM (tests inject a fake).
func NewStructuredWithModel(llm model.LLM, cfg Config, name, instruction string, schema *genai.Schema) (*Structured, error) {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 20 * time.Second
	}
	if cfg.Log == nil {
		cfg.Log = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	temp := float32(0.2)
	block := genai.HarmBlockThresholdBlockMediumAndAbove
	a, err := llmagent.New(llmagent.Config{
		Name:         name,
		Model:        llm,
		Instruction:  instruction,
		OutputSchema: schema,
		// No agent transfer: this is a single-purpose narrator.
		DisallowTransferToParent: true,
		DisallowTransferToPeers:  true,
		GenerateContentConfig: &genai.GenerateContentConfig{
			Temperature: &temp,
			SafetySettings: []*genai.SafetySetting{
				{Category: genai.HarmCategoryHarassment, Threshold: block},
				{Category: genai.HarmCategoryHateSpeech, Threshold: block},
				{Category: genai.HarmCategorySexuallyExplicit, Threshold: block},
				{Category: genai.HarmCategoryDangerousContent, Threshold: block},
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ai: llmagent: %w", err)
	}
	pii, err := piiPlugin()
	if err != nil {
		return nil, err
	}
	audit, err := auditPlugin(cfg.Log, name)
	if err != nil {
		return nil, err
	}
	sessions := session.InMemoryService()
	r, err := runner.New(runner.Config{
		AppName: name, Agent: a, SessionService: sessions,
		PluginConfig: runner.PluginConfig{Plugins: []*plugin.Plugin{pii, audit}},
	})
	if err != nil {
		return nil, fmt.Errorf("ai: runner: %w", err)
	}
	return &Structured{appName: name, runner: r, sessions: sessions, timeout: cfg.Timeout, log: cfg.Log, Model: llm.Name()}, nil
}

// Run sends prompt (plus optional extra parts such as an image) in a fresh single-use session and
// decodes the final JSON answer into out. The session is deleted afterwards (nothing durable lives
// in ADK sessions, AGENTS.md §5).
func (s *Structured) Run(ctx context.Context, prompt string, out any, extra ...*genai.Part) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	user, sid := "anon", uuid.NewString()
	if _, err := s.sessions.Create(ctx, &session.CreateRequest{AppName: s.appName, UserID: user, SessionID: sid}); err != nil {
		return fmt.Errorf("ai: create session: %w", err)
	}
	defer func() {
		_ = s.sessions.Delete(context.WithoutCancel(ctx), &session.DeleteRequest{AppName: s.appName, UserID: user, SessionID: sid})
	}()

	var text strings.Builder
	msg := genai.NewContentFromText(prompt, genai.RoleUser)
	msg.Parts = append(msg.Parts, extra...)
	start := time.Now()
	for ev, err := range s.runner.Run(ctx, user, sid, msg, agent.RunConfig{}) {
		if err != nil {
			return fmt.Errorf("ai: run: %w", err)
		}
		if ev == nil {
			continue
		}
		if ev.ErrorCode != "" {
			return fmt.Errorf("ai: model error %s: %s", ev.ErrorCode, ev.ErrorMessage)
		}
		if ev.IsFinalResponse() && ev.Content != nil {
			text.Reset()
			for _, p := range ev.Content.Parts {
				if p != nil && !p.Thought {
					text.WriteString(p.Text)
				}
			}
		}
	}
	s.log.Debug("adk run finished", "agent", s.appName, "ms", time.Since(start).Milliseconds())
	if strings.TrimSpace(text.String()) == "" {
		return errors.New("ai: empty model answer")
	}
	dec := json.NewDecoder(strings.NewReader(text.String()))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return fmt.Errorf("ai: decode answer: %w", err)
	}
	return nil
}

// ---- ADK plugins (AGENTS.md §2.1) ------------------------------------------------------

var (
	aadhaarLike = regexp.MustCompile(`\b\d{4}[ -]?\d{4}[ -]?\d{4}\b`)
	longDigits  = regexp.MustCompile(`\d{9,}`)
	panLike     = regexp.MustCompile(`\b[A-Z]{5}[0-9]{4}[A-Z]\b`)
)

// RedactPII removes Aadhaar-like, PAN-like and long digit strings before text reaches a model (D-07).
func RedactPII(s string) string {
	s = aadhaarLike.ReplaceAllString(s, "[redacted]")
	s = panLike.ReplaceAllString(s, "[redacted]")
	return longDigits.ReplaceAllString(s, "[number]")
}

// piiPlugin is an ADK plugin: every user message is redacted before the runner stores or sends it.
func piiPlugin() (*plugin.Plugin, error) {
	return plugin.New(plugin.Config{
		Name: "pii_gate",
		OnUserMessageCallback: func(_ agent.InvocationContext, c *genai.Content) (*genai.Content, error) {
			if c == nil {
				return nil, nil
			}
			out := *c
			out.Parts = make([]*genai.Part, len(c.Parts))
			for i, p := range c.Parts {
				if p != nil && p.Text != "" {
					cp := *p
					cp.Text = RedactPII(p.Text)
					out.Parts[i] = &cp
				} else {
					out.Parts[i] = p
				}
			}
			return &out, nil
		},
	})
}

// auditPlugin logs model, token counts and finish reason per model call. Never prompt or answer
// text (AuditPlugin P7).
func auditPlugin(log *slog.Logger, name string) (*plugin.Plugin, error) {
	return plugin.New(plugin.Config{
		Name: "audit",
		AfterModelCallback: func(_ agent.CallbackContext, resp *model.LLMResponse, err error) (*model.LLMResponse, error) {
			if resp != nil && !resp.Partial {
				var in, outTok int32
				if u := resp.UsageMetadata; u != nil {
					in, outTok = u.PromptTokenCount, u.CandidatesTokenCount
				}
				log.Info("ai.model_call", "agent", name, "model", resp.ModelVersion, "in_tokens", in, "out_tokens", outTok, "finish", resp.FinishReason)
			}
			return nil, nil
		},
	})
}
