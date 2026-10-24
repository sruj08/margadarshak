package app

import (
	"context"
	"log/slog"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/debrief"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/decoder"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/scam"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/tutor"
	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
)

// AIAgents are the Google ADK agents (docs/04-ai/AGENTS.md). Each falls back to templates or
// reviewed text when GEMINI_API_KEY is empty or the model fails (EC-29).
type AIAgents struct {
	Scam    *scam.Checker
	Debrief *debrief.Generator // nil when the content catalogue is missing
	Tutor   *tutor.Tutor       // nil when the question bank is missing
	Decoder *decoder.Decoder
}

func newAIAgents(ctx context.Context, cfg *config.Config, log *slog.Logger, contentDir string) AIAgents {
	ac := ai.Config{APIKey: cfg.GeminiAPIKey, Model: cfg.GeminiModel, Log: log}
	out := AIAgents{Scam: scam.New(ctx, log, ac), Decoder: decoder.New(ctx, log, ac)}
	if cat, err := debrief.LoadCatalogue(contentDir); err != nil {
		log.Warn("debrief catalogue not loaded; API-36 answers 503 (set CONTENT_DIR)", "err", err)
	} else {
		out.Debrief = debrief.New(ctx, log, cat, ac)
	}
	if t, err := tutor.New(ctx, log, contentDir, ac); err != nil {
		log.Warn("question bank not loaded; API-41 answers 503 (set CONTENT_DIR)", "err", err)
	} else {
		out.Tutor = t
	}
	return out
}
