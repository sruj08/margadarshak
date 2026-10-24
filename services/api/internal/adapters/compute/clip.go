package compute

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// The wire types of this file live in internal/ports (compute_clip.go); these aliases keep the
// adapter's own names.
type (
	RaterMark             = ports.RaterMark
	RaterSubmission       = ports.RaterSubmission
	ProposedWindow        = ports.ProposedWindow
	AdjudicationDecision  = ports.AdjudicationDecision
	AdjudicationInput     = ports.AdjudicationInput
	WindowMark            = ports.WindowMark
	ClipAgreementRequest  = ports.ClipAgreementRequest
	Window                = ports.Window
	FinalHazard           = ports.FinalHazard
	AgreementMetrics      = ports.AgreementMetrics
	ClipAgreement         = ports.ClipAgreement
	AdjudicationResult    = ports.AdjudicationResult
	ClipAgreementResponse = ports.ClipAgreementResponse
	ClipManifestsRequest  = ports.ClipManifestsRequest
	ClientMedia           = ports.ClientMedia
	ClientEntry           = ports.ClientEntry
	ClientManifest        = ports.ClientManifest
	Eligibility           = ports.Eligibility
	ClipManifestsResponse = ports.ClipManifestsResponse
)

const (
	OpAgreement   = ports.OpAgreement
	OpAdjudicate  = ports.OpAdjudicate
	OpFinalWindow = ports.OpFinalWindow
	OpScoringClip = ports.OpScoringClip
)

// AgreementOp is ports.AgreementOp.
func AgreementOp(a, b RaterSubmission) ClipAgreementRequest { return ports.AgreementOp(a, b) }

// AdjudicateOp is ports.AdjudicateOp.
func AdjudicateOp(a, b RaterSubmission, adj AdjudicationInput) ClipAgreementRequest {
	return ports.AdjudicateOp(a, b, adj)
}

// FinalWindowOp is ports.FinalWindowOp.
func FinalWindowOp(marks ...WindowMark) ClipAgreementRequest { return ports.FinalWindowOp(marks...) }

// ScoringClipOp is ports.ScoringClipOp.
func ScoringClipOp(clip json.RawMessage) ClipAgreementRequest { return ports.ScoringClipOp(clip) }

// ClipAgreement runs one /clip/agreement op.
func (c *Client) ClipAgreement(ctx context.Context, req ClipAgreementRequest) (*ClipAgreementResponse, error) {
	switch req.Op {
	case OpAgreement, OpAdjudicate, OpFinalWindow, OpScoringClip:
	default:
		return nil, &ProblemError{Path: "/clip/agreement", Status: 400, Type: "validation-failed",
			Title: fmt.Sprintf("unknown op %q", req.Op), Local: true}
	}
	if req.Now == 0 {
		req.Now = c.nowMs()
	}
	var out ClipAgreementResponse
	if err := c.post(ctx, "/clip/agreement", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ClipManifests builds the bank and client manifests and the mock eligibility of every clip.
func (c *Client) ClipManifests(ctx context.Context, req ClipManifestsRequest) (*ClipManifestsResponse, error) {
	if req.Now == 0 {
		req.Now = c.nowMs()
	}
	if req.Clips == nil {
		req.Clips = []json.RawMessage{}
	}
	var out ClipManifestsResponse
	if err := c.post(ctx, "/clip/manifests", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
