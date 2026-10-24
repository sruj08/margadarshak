package compute

import (
	"context"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// The wire types of this file live in internal/ports (compute_learn.go); these aliases keep the
// adapter's own names.
type (
	ReviewLogEntry       = ports.ReviewLogEntry
	RatedAnswer          = ports.RatedAnswer
	Answer               = ports.Answer
	LearnAnswersRequest  = ports.LearnAnswersRequest
	AnswerResult         = ports.AnswerResult
	CardState            = ports.CardState
	LearnAnswersResponse = ports.LearnAnswersResponse
	GateInput            = ports.GateInput
	LearnStateRequest    = ports.LearnStateRequest
	TopicMastery         = ports.TopicMastery
	DueCard              = ports.DueCard
	ReviewQueue          = ports.ReviewQueue
	TopicWeight          = ports.TopicWeight
	Readiness            = ports.Readiness
	CalibrationBin       = ports.CalibrationBin
	Calibration          = ports.Calibration
	RoadReadiness        = ports.RoadReadiness
	LearnStateResponse   = ports.LearnStateResponse
	SessionLike          = ports.SessionLike
	SessionFinding       = ports.SessionFinding
	SessionIntegrity     = ports.SessionIntegrity
	BadgeSession         = ports.BadgeSession
	ReviewSitting        = ports.ReviewSitting
	StreakState          = ports.StreakState
	ClosedWeek           = ports.ClosedWeek
	KhudLicence          = ports.KhudLicence
	Declarations         = ports.Declarations
	BadgeNazar           = ports.BadgeNazar
	BadgeHistory         = ports.BadgeHistory
	EvaluateRequest      = ports.EvaluateRequest
	XPAward              = ports.XPAward
	RankGap              = ports.RankGap
	StreakView           = ports.StreakView
	BadgeStatus          = ports.BadgeStatus
	EvaluateResponse     = ports.EvaluateResponse
)

// LearnAnswers scores LL answers with the verifier's server keys (Go never sees a key).
func (c *Client) LearnAnswers(ctx context.Context, req LearnAnswersRequest) (*LearnAnswersResponse, error) {
	if req.Now == 0 {
		req.Now = c.nowMs()
	}
	if req.ReviewLog == nil {
		req.ReviewLog = []ReviewLogEntry{}
	}
	var out LearnAnswersResponse
	if err := c.post(ctx, "/learn/answers", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// LearnState computes cards, mastery, nodes, queue, readiness, calibration and Road Readiness.
func (c *Client) LearnState(ctx context.Context, req LearnStateRequest) (*LearnStateResponse, error) {
	if req.Now == 0 {
		req.Now = c.nowMs()
	}
	if req.ReviewLog == nil {
		req.ReviewLog = []ReviewLogEntry{}
	}
	if req.RatedAnswers == nil {
		req.RatedAnswers = []RatedAnswer{}
	}
	if req.ConceptCounts == nil {
		req.ConceptCounts = map[string]int{}
	}
	var out LearnStateResponse
	if err := c.post(ctx, "/learn/state", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// EvaluateGamification computes XP, rank, streak and badges.
func (c *Client) EvaluateGamification(ctx context.Context, req EvaluateRequest) (*EvaluateResponse, error) {
	if req.Now == 0 {
		req.Now = c.nowMs()
	}
	if req.NodeStates == nil {
		req.NodeStates = map[string]string{}
	}
	if req.Session != nil && req.Session.Integrity.Flags == nil {
		s := *req.Session
		s.Integrity.Flags = []string{}
		req.Session = &s
	}
	var out EvaluateResponse
	if err := c.post(ctx, "/gamification/evaluate", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
