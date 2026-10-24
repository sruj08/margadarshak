package learn

import (
	"context"
	"errors"
	"math"
	"time"
)

// CalibrationWindow is the number of rated answers calibration uses (gamification
// CALIBRATION_WINDOW).
const CalibrationWindow = 40

// ReadinessGate is the advisory gate threshold (GAMIFICATION_ENGINE §5.2).
const ReadinessGate = 85

// snapshot returns the cached /learn/state output, recomputing it when the review log changed or
// it is older than StaleAfter. When the compute service is down it returns the last snapshot
// with stale = true; with no snapshot at all it returns ErrComputeUnavailable.
func (s *Service) snapshot(ctx context.Context, subj Subject) (*Snapshot, bool, error) {
	snap, err := s.Store.LatestSnapshot(ctx, subj)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}
	count, err := s.Store.LogCount(ctx, subj)
	if err != nil {
		return nil, false, err
	}
	staleAfter := s.StaleAfter
	if staleAfter <= 0 {
		staleAfter = time.Hour
	}
	now := s.now()
	if snap != nil && snap.LogCount == count && now.Sub(snap.ComputedAt) < staleAfter {
		return snap, false, nil
	}
	fresh, err := s.recompute(ctx, subj, snap, count, now)
	if err != nil {
		if errors.Is(err, ErrComputeUnavailable) && snap != nil {
			s.log().WarnContext(ctx, "learn compute unavailable; serving the last snapshot", "as_of", snap.ComputedAt)
			return snap, true, nil
		}
		return nil, false, err
	}
	return fresh, false, nil
}

func (s *Service) recompute(ctx context.Context, subj Subject, prev *Snapshot, count int, now time.Time) (*Snapshot, error) {
	rows, err := s.Store.ReviewLog(ctx, subj)
	if err != nil {
		return nil, err
	}
	rated, err := s.Store.RecentRatedAnswers(ctx, subj, CalibrationWindow)
	if err != nil {
		return nil, err
	}
	if rated == nil {
		rated = []RatedAnswer{}
	}
	req := StateRequest{Now: now.UnixMilli(), ReviewLog: logEntries(rows), RatedAnswers: rated, StateCode: subj.Tenant,
		ConceptCounts: map[string]int{}}
	if s.Catalog != nil {
		req.ConceptCounts = s.Catalog.ConceptCounts()
		seen := map[string]bool{}
		for _, r := range rows {
			seen[r.CardID] = true
		}
		req.NewCandidates = s.Catalog.NewCandidates(seen, 500)
	}
	var nazarN int
	if s.Nazar != nil {
		score, n, err := s.Nazar.NazarScore(ctx, subj)
		if err != nil {
			return nil, err
		}
		req.NazarScore, nazarN = score, n
	}
	if s.Gate != nil {
		if req.GateInput, err = s.Gate.LLGateInput(ctx, subj); err != nil {
			return nil, err
		}
	}
	if prev != nil {
		req.PreviousNodeStates = prev.State.NodeStates
	}
	resp, err := s.Compute.State(ctx, req)
	if err != nil {
		return nil, err
	}
	snap := &Snapshot{ComputedAt: now, LogCount: count, State: *resp, NazarScore: req.NazarScore, NazarSessions: nazarN}
	if err := s.Store.SaveSnapshot(ctx, subj, snap); err != nil {
		return nil, err
	}
	return snap, nil
}

// ReviewItem is one API-31 entry.
type ReviewItem struct {
	CardID         string    `json:"card_id"`
	TopicID        string    `json:"topic_id"`
	DueAt          time.Time `json:"due_at"`
	Retrievability float64   `json:"retrievability"`
}

// ReviewQueue is the API-31 response: due cards first (lowest retrievability), then new concepts.
type ReviewQueue struct {
	Items        []ReviewItem `json:"items"`
	New          []string     `json:"new"`
	DueRemaining int          `json:"due_remaining"`
	AsOf         time.Time    `json:"as_of"`
	Stale        bool         `json:"stale"`
}

// ReviewQueue is API-31, served from the cached state.
func (s *Service) ReviewQueue(ctx context.Context, subj Subject) (*ReviewQueue, error) {
	snap, stale, err := s.snapshot(ctx, subj)
	if err != nil {
		return nil, err
	}
	q := snap.State.ReviewQueue
	out := &ReviewQueue{Items: []ReviewItem{}, New: append([]string{}, q.Fresh...), DueRemaining: q.DueRemaining, AsOf: snap.ComputedAt, Stale: stale}
	for _, d := range q.Due {
		out.Items = append(out.Items, ReviewItem{CardID: d.CardID, TopicID: TopicOfCard(d.CardID), DueAt: time.UnixMilli(d.Due).UTC(),
			Retrievability: d.Retrievability})
	}
	return out, nil
}

// ReadinessTopicView is one API-33 topic.
type ReadinessTopicView struct {
	TopicID  string  `json:"topic_id"`
	Weight   float64 `json:"weight"`
	Mastery  float64 `json:"mastery"`
	Coverage float64 `json:"coverage"`
}

// GateView is the API-33 gate. Advisory and BookAnywayVisible are constants (the CCPA
// interface-interference rule): no input can turn "book anyway" off.
type GateView struct {
	Threshold         int      `json:"threshold"`
	Met               bool     `json:"met"`
	Advisory          bool     `json:"advisory"`
	BookAnywayVisible bool     `json:"book_anyway_visible"`
	Reasons           []string `json:"reasons"`
	WeakTopics        []string `json:"weak_topics"`
}

// ReadinessView is the API-33 Readiness response. The client renders display_key
// ("readiness.formula": "{score} = knowledge {knowledge} − calibration {calibration_penalty}")
// with these three numbers, which come only from the compute service: Go never derives one
// from the others.
type ReadinessView struct {
	Score              int                  `json:"score"`
	Knowledge          int                  `json:"knowledge"`
	CalibrationPenalty int                  `json:"calibration_penalty"`
	DisplayKey         string               `json:"display_key"`
	Topics             []ReadinessTopicView `json:"topics"`
	WeightsSource      string               `json:"weights_source"`
	Brier              *float64             `json:"brier,omitempty"`
	Gate               GateView             `json:"gate"`
	RoadReadiness      map[string]any       `json:"road_readiness"`
	AsOf               time.Time            `json:"as_of"`
	Stale              bool                 `json:"stale"`
}

// DisplayKey is the message key of the readiness formula.
const DisplayKey = "readiness.formula"

// weightsSources maps the compute service's weightsSource to the API-33 value. Unknown values
// pass through unchanged.
var weightsSources = map[string]string{"equal": "equal_default_topic_mix_unknown"}

func whole(f float64) int { return int(math.Round(f)) }

// Readiness is API-33. When the compute service is down the last snapshot is served with its
// timestamp (as_of) and stale = true.
func (s *Service) Readiness(ctx context.Context, subj Subject) (*ReadinessView, error) {
	snap, stale, err := s.snapshot(ctx, subj)
	if err != nil {
		return nil, err
	}
	r := snap.State.Readiness
	ws := r.WeightsSource
	if mapped, ok := weightsSources[ws]; ok {
		ws = mapped
	}
	v := &ReadinessView{Score: whole(r.Readiness), Knowledge: whole(r.Knowledge), CalibrationPenalty: whole(r.CalPenalty),
		DisplayKey: DisplayKey, Topics: []ReadinessTopicView{}, WeightsSource: ws, Brier: snap.State.Calibration.Brier,
		Gate: GateView{Threshold: ReadinessGate, Met: r.Gate.Met, Advisory: true, BookAnywayVisible: true,
			Reasons: append([]string{}, r.Gate.Reasons...), WeakTopics: append([]string{}, r.Gate.WeakTopics...)},
		AsOf: snap.ComputedAt, Stale: stale}
	for _, t := range r.Topics {
		v.Topics = append(v.Topics, ReadinessTopicView{TopicID: t.Topic, Weight: t.Weight, Mastery: t.Mastery,
			Coverage: snap.State.MasteryByTopic[t.Topic].Coverage})
	}
	rr := snap.State.RoadReadiness
	v.RoadReadiness = map[string]any{"score": rr.Score, "knowledge_part": rr.KnowledgePart, "nazar_part": rr.NazarPart,
		"modules": rr.Modules, "nazar_score": snap.NazarScore, "nazar_verified_sessions": snap.NazarSessions}
	return v, nil
}

// NodeStates returns the cached skill-tree node states (used by gamify for ranks and badges).
func (s *Service) NodeStates(ctx context.Context, subj Subject) (map[string]string, error) {
	snap, _, err := s.snapshot(ctx, subj)
	if err != nil {
		return nil, err
	}
	return snap.State.NodeStates, nil
}
