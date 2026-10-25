package app

import (
	"context"
	"log/slog"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/coach"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/commentary"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/debrief"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/decoder"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/gamecoach"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/scam"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/signsnap"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/tutor"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/voiceguide"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/speech"
	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
	"google.golang.org/genai"
)

// AIAgents are the Google ADK agents (docs/04-ai/AGENTS.md). Each falls back to templates or
// reviewed text when GEMINI_API_KEY is empty or the model fails (EC-29). A nil agent's endpoints
// answer 503 (its content was not found).
type AIAgents struct {
	Scam       *scam.Checker
	Debrief    *debrief.Generator
	Tutor      *tutor.Tutor
	Decoder    *decoder.Decoder
	Commentary commentary.Transcriber
	SignSnap   *signsnap.Snapper
	Coach      *coach.Coach
	Voice      *voiceguide.Guide
	Speech     speech.Port
	GameCoach  *gamecoach.Coach
}

// model picks the env-pinned model for an agent family, else GEMINI_MODEL (MD-301).
func model(pinned, fallback string) string {
	if pinned != "" {
		return pinned
	}
	return fallback
}

// AIAgentsForTest builds every agent with AI off (no key): the EC-29 path.
func AIAgentsForTest(ctx context.Context, contentDir string) AIAgents {
	return newAIAgents(ctx, &config.Config{}, slog.New(slog.DiscardHandler), contentDir, nil)
}

// newAIAgents builds every agent. readDebrief backs the voice guide's read_debrief tool.
func newAIAgents(ctx context.Context, cfg *config.Config, log *slog.Logger, contentDir string,
	readDebrief func(ctx context.Context, userID, sessionID string) (string, error)) AIAgents {
	base := ai.Config{APIKey: cfg.GeminiAPIKey, Model: cfg.GeminiModel, Log: log}
	lite, vision, deb := base, base, base
	lite.Model = model(cfg.GeminiModelTextLite, cfg.GeminiModel)
	vision.Model = model(cfg.GeminiModelVision, cfg.GeminiModel)
	deb.Model = model(cfg.GeminiModelDebrief, lite.Model)
	// Narrators the learner waits for on screen (scam check, tutor note, game coach, debrief) think little.
	fast := lite
	fast.Thinking = genai.ThinkingLevelLow
	deb.Thinking = genai.ThinkingLevelLow
	out := AIAgents{Scam: scam.New(ctx, log, fast)}
	if g := commentary.NewGemini(ctx, log, base); g != nil {
		out.Commentary = g
	}
	if sp := speech.NewSarvam(cfg.SarvamBaseURL, cfg.SarvamAPIKey); sp != nil {
		out.Speech = sp
	}
	if d, err := decoder.New(ctx, log, contentDir, vision); err != nil {
		log.Warn("decoder catalogue not loaded; API-42 answers 503 (set CONTENT_DIR)", "err", err)
	} else {
		out.Decoder = d
	}
	if s, err := signsnap.New(ctx, log, contentDir, vision); err != nil {
		log.Warn("sign catalogue not loaded; API-75 answers 503 (set CONTENT_DIR)", "err", err)
	} else {
		out.SignSnap = s
	}
	if c, err := coach.New(ctx, log, contentDir, fast); err != nil {
		log.Warn("drill catalogue not loaded; API-76 answers 503 (set CONTENT_DIR)", "err", err)
	} else {
		out.Coach = c
	}
	if cat, err := debrief.LoadCatalogue(contentDir); err != nil {
		log.Warn("debrief catalogue not loaded; API-36 answers 503 (set CONTENT_DIR)", "err", err)
	} else {
		out.Debrief = debrief.New(ctx, log, cat, deb)
	}
	if g, err := gamecoach.New(ctx, log, contentDir, fast); err != nil {
		log.Warn("hazard catalogue not loaded; API-79 answers 503 (set CONTENT_DIR)", "err", err)
	} else {
		out.GameCoach = g
	}
	if t, err := tutor.New(ctx, log, contentDir, fast); err != nil {
		log.Warn("question bank not loaded; API-41 answers 503 (set CONTENT_DIR)", "err", err)
	} else {
		out.Tutor = t
	}
	rules, rerr := voiceguide.LoadRules(contentDir)
	drills, derr := voiceguide.LoadDrills(contentDir)
	if rerr != nil || derr != nil {
		log.Warn("voice catalogues not loaded; API-40 answers 503 (set CONTENT_DIR)", "rules", rerr, "drills", derr)
		return out
	}
	g, err := voiceguide.New(ctx, voiceguide.Config{AI: fast, LiveModel: cfg.GeminiModelLive, Rules: rules, Drills: drills,
		ReadDebrief: readDebrief, Log: log})
	if err != nil {
		log.Warn("voice guide disabled", "err", err)
		return out
	}
	out.Voice = g
	return out
}
