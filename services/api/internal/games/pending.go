package games

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ReplayStats is one page of the sessions.replay_pending step.
type ReplayStats struct {
	Scanned  int  `json:"scanned"`
	Verified int  `json:"verified"`
	Voided   int  `json:"voided"`
	Pending  int  `json:"pending"`
	More     bool `json:"more"` // a full page: call again
}

// ReplayPending re-verifies up to limit (≤ 50) pending sessions, oldest submission first, in a
// cross-tenant System transaction with FOR UPDATE SKIP LOCKED, so concurrent runs never take the
// same row. A verified session is overwritten with the server result (awards and the study hook
// run then, exactly once); a rejected one is voided. The page stops early when the verifier is
// still unavailable.
func (s *Service) ReplayPending(ctx context.Context, limit int) (ReplayStats, error) {
	if limit <= 0 || limit > PendingPageSize {
		limit = PendingPageSize
	}
	var st ReplayStats
	err := s.DB.System(ctx, func(tx pgx.Tx) error {
		page, err := s.Store.ListPending(ctx, tx, limit)
		if err != nil {
			return err
		}
		st.Scanned, st.More = len(page), len(page) == limit
		for i, sess := range page {
			if sess.Replay == nil {
				return fmt.Errorf("games: pending session %s has no replay", sess.ID)
			}
			res, err := s.verify(ctx, tx, sess, s.Clock.Now().UTC())
			var rej *RejectedError
			switch {
			case errors.As(err, &rej):
				st.Voided++
			case err != nil:
				return err
			case res.Status == StatusChecked:
				st.Verified++
			default:
				// Still unavailable: leave this and the rest of the page for the next run.
				st.Pending += len(page) - i
				return nil
			}
		}
		return nil
	})
	if err != nil {
		return ReplayStats{}, err
	}
	return st, nil
}

// ReplayPendingStep is the sessions.replay_pending job step (its signature is jobs.StepFunc).
// Args: {"limit": n} (optional, ≤ 50).
func (s *Service) ReplayPendingStep(ctx context.Context, args map[string]any) (map[string]any, error) {
	limit := PendingPageSize
	if v, ok := args["limit"].(float64); ok && v >= 1 {
		limit = int(v)
	}
	st, err := s.ReplayPending(ctx, limit)
	if err != nil {
		return nil, err
	}
	return map[string]any{"scanned": st.Scanned, "verified": st.Verified, "voided": st.Voided, "pending": st.Pending, "more": st.More}, nil
}

// NazarScore is the mean server score of the subject's last 3 eligible mocks (NAZAR §2.5:
// server seed, unseen clips, trust ≥ 0.6, rvfc timing, verified) and how many were used. It is
// nil with n = 0 before the first eligible mock; with 1–2 eligible mocks it is their mean
// (shown with "verified sessions: n").
func (s *Service) NazarScore(ctx context.Context, tx pgx.Tx, subj Subject) (*float64, int, error) {
	pcts, err := s.Store.EligibleMocks(ctx, tx, subj, NazarScoreWindow)
	if err != nil {
		return nil, 0, err
	}
	if len(pcts) == 0 {
		return nil, 0, nil
	}
	if len(pcts) > NazarScoreWindow {
		pcts = pcts[:NazarScoreWindow]
	}
	sum := 0.0
	for _, p := range pcts {
		sum += p
	}
	mean := sum / float64(len(pcts))
	return &mean, len(pcts), nil
}
