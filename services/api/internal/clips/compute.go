package clips

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// Poster is the one method a signed compute client needs to expose (POST path with a JSON body,
// decode the JSON response). internal/adapters/compute implements it at handover; it should
// return an error for which IsUnavailable is true when the service is down or times out.
type Poster interface {
	PostJSON(ctx context.Context, path string, in, out any) error
}

// IsUnavailable reports whether err means the compute service could not answer. The adapter
// signals this with an error that has an `Unavailable() bool` method returning true, or by
// wrapping context.DeadlineExceeded.
func IsUnavailable(err error) bool {
	var u interface{ Unavailable() bool }
	if errors.As(err, &u) && u.Unavailable() {
		return true
	}
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, ErrComputeUnavailable)
}

// NewComputeVia builds ClipCompute on a Poster.
func NewComputeVia(p Poster) ClipCompute { return viaPoster{p} }

type viaPoster struct{ p Poster }

func wrapUnavailable(err error) error {
	if err == nil {
		return nil
	}
	if IsUnavailable(err) {
		return fmt.Errorf("%w: %w", ErrComputeUnavailable, err)
	}
	return err
}

func (v viaPoster) Agreement(ctx context.Context, req AgreementRequest) (*AgreementResponse, error) {
	var raw json.RawMessage
	if err := v.p.PostJSON(ctx, "/clip/agreement", req, &raw); err != nil {
		return nil, wrapUnavailable(err)
	}
	return decodeAgreement(raw)
}

func (v viaPoster) Manifests(ctx context.Context, req ManifestsRequest) (*ManifestsResponse, error) {
	var out ManifestsResponse
	if err := v.p.PostJSON(ctx, "/clip/manifests", req, &out); err != nil {
		return nil, wrapUnavailable(err)
	}
	return &out, nil
}

// decodeAgreement parses a /clip/agreement response and keeps the agreement object verbatim.
func decodeAgreement(raw []byte) (*AgreementResponse, error) {
	var out AgreementResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("clips: decode /clip/agreement: %w", err)
	}
	var keep struct {
		Agreement json.RawMessage `json:"agreement"`
	}
	_ = json.Unmarshal(raw, &keep)
	out.Raw = keep.Agreement
	return &out, nil
}
