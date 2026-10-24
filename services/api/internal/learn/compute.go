package learn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// LearnCompute mirrors the compute service routes POST /learn/answers and POST /learn/state
// (services/score-verifier/src/routes/learn.ts). Errors wrap ErrComputeUnavailable when the
// service is down.
type LearnCompute interface {
	Answers(ctx context.Context, req AnswersRequest) (*AnswersResponse, error)
	State(ctx context.Context, req StateRequest) (*StateResponse, error)
}

// ---- /learn/answers -------------------------------------------------------------------------

// ComputeAnswer is one answer row (snake_case, like API-32).
type ComputeAnswer struct {
	ClientAnswerID   string  `json:"client_answer_id"`
	QRef             string  `json:"qref"`
	SelectedOptionID *string `json:"selected_option_id"` // null = no answer (wrong)
	Confidence       string  `json:"confidence,omitempty"`
	LatencyMs        *int    `json:"latency_ms,omitempty"`
	TimerMs          *int    `json:"timer_ms,omitempty"`
	AnsweredAt       int64   `json:"answered_at"`
	SourceSID        string  `json:"source_sid,omitempty"`
}

// ReviewLogEntry is gamification ReviewLogEntry (camelCase, as the package stores it).
type ReviewLogEntry struct {
	CardID     string `json:"cardId"`
	Rating     int    `json:"rating"`
	ReviewedAt int64  `json:"reviewedAt"`
	SourceSID  string `json:"sourceSid,omitempty"`
	Confidence string `json:"confidence,omitempty"`
}

// AnswersRequest is the /learn/answers body.
type AnswersRequest struct {
	Now       int64            `json:"now"`
	Answers   []ComputeAnswer  `json:"answers"`
	ReviewLog []ReviewLogEntry `json:"reviewLog"`
}

// ComputeAnswerResult is one /learn/answers result.
type ComputeAnswerResult struct {
	ClientAnswerID string `json:"client_answer_id"`
	QRef           string `json:"qref"`
	CardID         string `json:"card_id"`
	Topic          string `json:"topic"`
	Correct        bool   `json:"correct"`
	Rating         int    `json:"rating"`
	Overconfident  bool   `json:"overconfident"`
	ReviewedAt     int64  `json:"reviewed_at"`
	NextDueAt      int64  `json:"next_due_at"`
}

// AnswersResponse is the /learn/answers response; cards are gamification CardState, stored
// verbatim.
type AnswersResponse struct {
	Results []ComputeAnswerResult `json:"results"`
	Cards   []json.RawMessage     `json:"cards"`
}

// ---- /learn/state ---------------------------------------------------------------------------

// RatedAnswer is gamification RatedAnswer.
type RatedAnswer struct {
	Correct    bool   `json:"correct"`
	Confidence string `json:"confidence,omitempty"`
}

// GateInput is the readiness gate input.
type GateInput struct {
	LLMockPcts  []float64 `json:"llMockPcts"`
	PassMarkPct float64   `json:"passMarkPct"`
}

// StateRequest is the /learn/state body.
type StateRequest struct {
	Now                int64             `json:"now"`
	ReviewLog          []ReviewLogEntry  `json:"reviewLog"`
	RatedAnswers       []RatedAnswer     `json:"ratedAnswers"`
	ConceptCounts      map[string]int    `json:"conceptCounts"`
	StateCode          string            `json:"stateCode"`
	GateInput          *GateInput        `json:"gateInput,omitempty"`
	NazarScore         *float64          `json:"nazarScore,omitempty"`
	PreviousNodeStates map[string]string `json:"previousNodeStates,omitempty"`
	GameCriteriaMet    []string          `json:"gameCriteriaMet,omitempty"`
	NewCandidates      []string          `json:"newCandidates,omitempty"`
}

// TopicMastery is one masteryByTopic entry.
type TopicMastery struct {
	Mastery            float64  `json:"mastery"`
	Coverage           float64  `json:"coverage"`
	MeanRetrievability *float64 `json:"meanRetrievability"`
	ConceptCount       int      `json:"conceptCount"`
	Seen               int      `json:"seen"`
	Covered            int      `json:"covered"`
}

// DueCard is a review-queue entry.
type DueCard struct {
	CardID         string  `json:"cardId"`
	Retrievability float64 `json:"retrievability"`
	Due            int64   `json:"due"`
}

// ReviewQueueOut is the reviewQueue block.
type ReviewQueueOut struct {
	Due                []DueCard `json:"due"`
	Fresh              []string  `json:"fresh"`
	DueRemaining       int       `json:"dueRemaining"`
	NewIntroducedToday int       `json:"newIntroducedToday"`
}

// ReadinessTopic is one LL topic in the readiness block.
type ReadinessTopic struct {
	Topic   string  `json:"topic"`
	Mastery float64 `json:"mastery"`
	Weight  float64 `json:"weight"`
}

// ReadinessOut is gamification Readiness.
type ReadinessOut struct {
	Readiness   float64          `json:"readiness"`
	Knowledge   float64          `json:"knowledge"`
	CalPenalty  float64          `json:"calPenalty"`
	Topics      []ReadinessTopic `json:"topics"`
	Calibration struct {
		N      int      `json:"n"`
		OC     *float64 `json:"oc"`
		Enough bool     `json:"enough"`
	} `json:"calibration"`
	WeightsSource string `json:"weightsSource"`
	Gate          struct {
		Met               bool     `json:"met"`
		Reasons           []string `json:"reasons"`
		WeakTopics        []string `json:"weakTopics"`
		BookAnywayVisible bool     `json:"bookAnywayVisible"`
	} `json:"gate"`
}

// CalibrationOut is the calibration block.
type CalibrationOut struct {
	N              int               `json:"n"`
	Brier          *float64          `json:"brier"`
	Overconfidence *float64          `json:"overconfidence"`
	Bins           []json.RawMessage `json:"bins"`
	SureAndWrong   int               `json:"sureAndWrong"`
	Calibrated     bool              `json:"calibrated"`
}

// RoadReadinessOut is gamification RoadReadiness.
type RoadReadinessOut struct {
	Score         *float64 `json:"score"`
	KnowledgePart float64  `json:"knowledgePart"`
	NazarPart     *float64 `json:"nazarPart"`
	Modules       []string `json:"modules"`
}

// StateResponse is the /learn/state response.
type StateResponse struct {
	Cards          []json.RawMessage       `json:"cards"`
	MasteryByTopic map[string]TopicMastery `json:"masteryByTopic"`
	NodeStates     map[string]string       `json:"nodeStates"`
	ReviewQueue    ReviewQueueOut          `json:"reviewQueue"`
	Readiness      ReadinessOut            `json:"readiness"`
	Calibration    CalibrationOut          `json:"calibration"`
	RoadReadiness  RoadReadinessOut        `json:"roadReadiness"`
}

// ---- Poster-based implementation ------------------------------------------------------------

// Poster is the one method a signed compute client needs (see clips.Poster).
type Poster interface {
	PostJSON(ctx context.Context, path string, in, out any) error
}

// IsUnavailable reports whether err means the compute service could not answer.
func IsUnavailable(err error) bool {
	var u interface{ Unavailable() bool }
	if errors.As(err, &u) && u.Unavailable() {
		return true
	}
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, ErrComputeUnavailable)
}

// NewComputeVia builds LearnCompute on a Poster.
func NewComputeVia(p Poster) LearnCompute { return via{p} }

type via struct{ p Poster }

func wrap(err error) error {
	if err != nil && IsUnavailable(err) && !errors.Is(err, ErrComputeUnavailable) {
		return fmt.Errorf("%w: %w", ErrComputeUnavailable, err)
	}
	return err
}

func (v via) Answers(ctx context.Context, req AnswersRequest) (*AnswersResponse, error) {
	var out AnswersResponse
	if err := v.p.PostJSON(ctx, "/learn/answers", req, &out); err != nil {
		return nil, wrap(err)
	}
	return &out, nil
}

func (v via) State(ctx context.Context, req StateRequest) (*StateResponse, error) {
	var out StateResponse
	if err := v.p.PostJSON(ctx, "/learn/state", req, &out); err != nil {
		return nil, wrap(err)
	}
	return &out, nil
}
