package games

// Difficulty staircase updates (GAME_SDK §7, game-core learning/staircase.ts): after a verified
// practice or learn session, every item outcome of the server result is applied in order, two
// consecutive passes step up, one fail steps down (levels 1–5). Mock (and pair) mode never adapts.
//
// The ladder updated is the one Start reads: game ID as the skill (StartRequest.SkillID is
// empty for every API-34 call). Per-skill ladders below the game (Nazar hazard types, Blind Spot
// parts A and B; GAME_DESIGN §2.8, §4.8) need a skill on API-34 and a practice clip source that
// reads them, which P2 does not have.

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// StaircaseRecorder applies one item outcome and returns the new level (store.GamesStaircase,
// MemStaircase). A Staircase without it is read-only.
type StaircaseRecorder interface {
	Record(ctx context.Context, tx pgx.Tx, subj Subject, gameID, skillID string, passed bool) (int, error)
}

// NazarItemPassMarks is GAME_DESIGN §2.7 rule 8 (game-core scoring config itemPassMarks): a
// clip is an item pass at 6 or more Kerala marks (of 10).
const NazarItemPassMarks = 6

type stairResult struct {
	Score struct {
		Raw float64 `json:"raw"`
		Max float64 `json:"max"`
	} `json:"score"`
	Components []struct {
		ID    string  `json:"id"`
		Value float64 `json:"value"`
		Max   float64 `json:"max"`
	} `json:"components"`
	Findings []struct {
		Critical bool `json:"critical"`
	} `json:"findings"`
	Evidence []struct {
		Correct    bool    `json:"correct"`
		Confidence *string `json:"confidence"`
	} `json:"evidence"`
}

// ItemPasses returns the per-item outcomes of a verified session, in item order, as each game
// defines an item pass (GAME_DESIGN §x.7):
//   - nazar: per clip of the verifier's kerala_5band analysis (nazar_clips), marks ≥ 6; quiet
//     clips (no hazard) are not items, a pattern-voided clip is a fail, a clip voided by the
//     device (tab hidden, clock drift) is skipped;
//   - ll_sim: per question (SessionResult.evidence), correct and not answered at 50% confidence;
//   - stopping_distance: the run is one item, ≥ 80% of its max;
//   - blind_spot: part A (placement) ≥ 80% of its max, then part B (the other components)
//     ≥ 80% of its max with no critical finding.
//
// It returns nil when the result has nothing to adapt on.
func ItemPasses(gameID string, result json.RawMessage, analysis map[string]ports.NazarAnalysis) []bool {
	if gameID == GameNazar {
		a, ok := analysis[ports.AnalysisNazarClips]
		if !ok {
			return nil
		}
		var out []bool
		for _, c := range a.Clips {
			if len(c.Hazards) == 0 {
				continue
			}
			if c.Voided != nil && *c.Voided != "pattern" {
				continue
			}
			out = append(out, c.Voided == nil && c.Marks >= NazarItemPassMarks)
		}
		return out
	}
	var r stairResult
	if json.Unmarshal(result, &r) != nil {
		return nil
	}
	switch gameID {
	case GameLLSim:
		out := make([]bool, 0, len(r.Evidence))
		for _, e := range r.Evidence {
			out = append(out, e.Correct && (e.Confidence == nil || *e.Confidence != "50"))
		}
		return out
	case GameStoppingDistance:
		if r.Score.Max <= 0 {
			return nil
		}
		return []bool{r.Score.Raw >= 0.8*r.Score.Max}
	case GameBlindSpot:
		var aVal, aMax, bVal, bMax float64
		for _, c := range r.Components {
			if c.ID == "placement" {
				aVal, aMax = aVal+c.Value, aMax+c.Max
			} else {
				bVal, bMax = bVal+c.Value, bMax+c.Max
			}
		}
		critical := false
		for _, f := range r.Findings {
			critical = critical || f.Critical
		}
		var out []bool
		if aMax > 0 {
			out = append(out, aVal >= 0.8*aMax)
		}
		if bMax > 0 {
			out = append(out, !critical && bVal >= 0.8*bMax)
		}
		return out
	}
	return nil
}

// adapt records the item outcomes of a verified practice or learn session on the staircase.
func (s *Service) adapt(ctx context.Context, tx pgx.Tx, sess *Session, analysis map[string]ports.NazarAnalysis) error {
	rec, ok := s.Staircase.(StaircaseRecorder)
	if !ok || (sess.Mode != ModePractice && sess.Mode != ModeLearn) || sess.Cohort != "" || !sess.Eligible[EligibleXP] {
		return nil
	}
	for _, passed := range ItemPasses(sess.GameID, sess.ServerResult, analysis) {
		if _, err := rec.Record(ctx, tx, sess.Subject, sess.GameID, sess.GameID, passed); err != nil {
			return fmt.Errorf("games: staircase: %w", err)
		}
	}
	return nil
}
