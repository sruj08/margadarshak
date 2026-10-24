package compute

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// The wire types of this file live in internal/ports (compute_verify.go); these aliases keep the
// adapter's own names.
type (
	VerifyRequest  = ports.VerifyRequest
	SessionItem    = ports.SessionItem
	VerifyContext  = ports.VerifyContext
	VerifyHints    = ports.VerifyHints
	InlineContent  = ports.InlineContent
	VerifyResponse = ports.VerifyResponse
	Comparison     = ports.Comparison
	ResultSummary  = ports.ResultSummary
	FindingSummary = ports.FindingSummary
	Integrity      = ports.Integrity
	NazarAnalysis  = ports.NazarAnalysis
	ClipAnalysis   = ports.ClipAnalysis
	HazardAnalysis = ports.HazardAnalysis
)

const (
	AnalysisNazarClips       = ports.AnalysisNazarClips
	AnalysisNazarClipsLinear = ports.AnalysisNazarClipsLinear
)

// ParseResult is ports.ParseResult.
func ParseResult(raw json.RawMessage) (ResultSummary, error) { return ports.ParseResult(raw) }

// Verify replays a session (POST /verify). The server result always wins.
func (c *Client) Verify(ctx context.Context, req VerifyRequest) (*VerifyResponse, error) {
	if req.Items == nil {
		req.Items = []SessionItem{}
	}
	var out VerifyResponse
	if err := c.post(ctx, "/verify", req, &out); err != nil {
		return nil, err
	}
	s, err := ParseResult(out.Result)
	if err != nil {
		return nil, fmt.Errorf("%w: /verify: %w", ErrUnavailable, err)
	}
	out.Summary = s
	return &out, nil
}
