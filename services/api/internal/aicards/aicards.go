// Package aicards builds and stores the debrief card of a checked session (API-36 and the RW-3
// fan-out share it), so a card costs at most one model call per session and locale.
package aicards

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/debrief"
	"github.com/sruj08/margadarshak/services/api/internal/games"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// Service is the debrief card store.
type Service struct {
	DB  *store.DB
	Gen *debrief.Generator
	Now func() time.Time
	Log *slog.Logger
}

// Debrief returns the card for a checked session. With useAI a stored card is reused, and a new
// AI-worded (or definitively failed) card is stored; transient failures (timeout, open breaker)
// are not stored so a later request can try again.
func (s *Service) Debrief(ctx context.Context, sess *games.Session, locale string, useAI bool) (debrief.Card, error) {
	stored := cardLocale(locale)
	if useAI && locale != "doi" {
		var raw json.RawMessage
		err := s.DB.Tenant(ctx, sess.Subject.Tenant, func(tx pgx.Tx) error {
			var err error
			raw, err = store.GetDebrief(ctx, tx, sess.ID, stored)
			return err
		})
		if err == nil {
			var c debrief.Card
			if json.Unmarshal(raw, &c) == nil {
				return c, nil
			}
		} else if !errors.Is(err, store.ErrNotFound) {
			return debrief.Card{}, fmt.Errorf("aicards: read card: %w", err)
		}
	}
	var prev []string
	err := s.DB.Tenant(ctx, sess.Subject.Tenant, func(tx pgx.Tx) error {
		var err error
		prev, err = store.PrevFindingIDs(ctx, tx, sess.Subject, sess.GameID, sess.ID)
		return err
	})
	if err != nil {
		return debrief.Card{}, fmt.Errorf("aicards: previous session: %w", err)
	}
	pct, findings := Findings(sess.ServerResult)
	card := s.Gen.BuildCard(ctx, debrief.Request{SessionID: sess.ID.String(), GameID: sess.GameID, ScorePct: pct,
		Findings: findings, Locale: locale, UseAI: useAI, PrevFindingIDs: prev})
	keep := card.Source == "ai" || (card.Status == "ai_failed" && card.FallbackReason == "validator")
	if useAI && keep {
		err := s.DB.Tenant(ctx, sess.Subject.Tenant, func(tx pgx.Tx) error {
			status := "ai_ready"
			if card.Source != "ai" {
				status = "ai_failed"
			}
			return store.PutDebrief(ctx, tx, sess.Subject.Tenant, sess.ID, card.Locale, card.Source, status, card, s.Now().UTC())
		})
		if err != nil {
			s.Log.WarnContext(ctx, "debrief card not stored", "err", err)
		}
	}
	return card, nil
}

func cardLocale(l string) string {
	switch l {
	case "hi", "doi":
		return "hi"
	case "hinglish":
		return "hinglish"
	}
	return "en"
}

// Findings reads the score and findings of a verifier SessionResult (camelCase).
func Findings(raw json.RawMessage) (float64, []debrief.Finding) {
	var doc struct {
		Score struct {
			Pct float64 `json:"pct"`
		} `json:"score"`
		Findings []struct {
			FindingID string         `json:"findingId"`
			Severity  float64        `json:"severity"`
			Critical  bool           `json:"critical"`
			RuleIDs   []string       `json:"ruleIds"`
			DrillIDs  []string       `json:"drillIds"`
			Facts     map[string]any `json:"facts"`
		} `json:"findings"`
	}
	_ = json.Unmarshal(raw, &doc) // a malformed result reads as no findings
	out := make([]debrief.Finding, 0, len(doc.Findings))
	for _, f := range doc.Findings {
		if f.FindingID == "" || len(out) == 12 {
			continue
		}
		out = append(out, debrief.Finding{ID: f.FindingID, Severity: math.Min(1, math.Max(0, f.Severity)), Critical: f.Critical,
			RuleIDs: f.RuleIDs, DrillIDs: f.DrillIDs, Facts: f.Facts})
	}
	return math.Min(100, math.Max(0, doc.Score.Pct)), out
}

// Backfill builds and stores cards for up to limit checked sessions without one whose holder
// allows AI (RW-3 debrief fan-out, `debrief_backfill`). It is idempotent: a stored card is never
// rebuilt. read loads a session by tenant and ID (games.Service.Session).
func (s *Service) Backfill(ctx context.Context, read func(ctx context.Context, tenant string, id uuid.UUID) (*games.Session, error), since time.Time, limit int) (map[string]any, error) {
	var pending []store.PendingDebrief
	err := s.DB.System(ctx, func(tx pgx.Tx) error {
		var err error
		pending, err = store.ListPendingDebriefs(ctx, tx, since, limit)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("aicards: pending: %w", err)
	}
	built, ai, transient := 0, 0, 0
	for _, p := range pending {
		sess, err := read(ctx, p.Tenant, p.SessionID)
		if err != nil {
			s.Log.WarnContext(ctx, "debrief backfill: session read failed", "err", err)
			continue
		}
		card, err := s.Debrief(ctx, sess, p.Locale, true)
		if err != nil {
			s.Log.WarnContext(ctx, "debrief backfill failed", "err", err)
			continue
		}
		switch {
		case card.Source == "ai":
			built++
			ai++
		case card.FallbackReason == "timeout" || card.FallbackReason == "circuit_open" || card.FallbackReason == "model_error":
			transient++ // not stored: the workflow retries with backoff (a 429 lands here)
		default:
			built++
		}
	}
	out := map[string]any{"pending": len(pending), "built": built, "ai": ai, "transient": transient}
	if transient > 0 {
		return out, fmt.Errorf("aicards: %d cards hit a transient model failure: %w", transient, ErrTransient)
	}
	return out, nil
}

// ErrTransient asks the caller (the RW-3 workflow) to retry later.
var ErrTransient = errors.New("aicards: transient failure")
