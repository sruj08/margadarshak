package ports

import (
	"context"
	"errors"
)

// ---- Compute service (services/score-verifier, decision D1) ----------------------------------
//
// The private TypeScript compute service replays game sessions (POST /verify) and runs the
// learning, gamification and clip maths, so the browser and the server share one implementation.
// internal/adapters/compute is the HMAC-signed client; the wire types are in
// compute_{verify,learn,clip}.go.
//
// Callers degrade when the service cannot answer (errors.Is(err, ErrComputeUnavailable)): API-35
// stores the session as pending_verification, readiness serves the last snapshot. Any other 4xx
// is ErrComputeInvalid; the concrete error carries the problem type slug.

// computeError is a sentinel that also answers Unavailable(), the method the domain packages'
// IsUnavailable helpers look for (clips, learn, gamify), so they need not import this package.
type computeError struct {
	msg         string
	unavailable bool
}

func (e *computeError) Error() string     { return e.msg }
func (e *computeError) Unavailable() bool { return e.unavailable }

// Compute errors. Match with errors.Is.
var (
	ErrComputeUnavailable error = &computeError{msg: "compute: unavailable", unavailable: true}
	ErrComputeInvalid     error = &computeError{msg: "compute: request rejected"}
)

// IsComputeUnavailable reports whether err means the compute service could not answer.
func IsComputeUnavailable(err error) bool {
	if errors.Is(err, ErrComputeUnavailable) {
		return true
	}
	var u interface{ Unavailable() bool }
	return errors.As(err, &u) && u.Unavailable()
}

// ScoreVerifier replays game sessions (POST /verify). The server result always wins (D-11).
type ScoreVerifier interface {
	Verify(ctx context.Context, req VerifyRequest) (*VerifyResponse, error)
}

// LearnCompute runs the learning and gamification maths (/learn/answers, /learn/state,
// /gamification/evaluate).
type LearnCompute interface {
	LearnAnswers(ctx context.Context, req LearnAnswersRequest) (*LearnAnswersResponse, error)
	LearnState(ctx context.Context, req LearnStateRequest) (*LearnStateResponse, error)
	EvaluateGamification(ctx context.Context, req EvaluateRequest) (*EvaluateResponse, error)
}

// ClipCompute runs the clip-pipeline maths (/clip/agreement, /clip/manifests).
type ClipCompute interface {
	ClipAgreement(ctx context.Context, req ClipAgreementRequest) (*ClipAgreementResponse, error)
	ClipManifests(ctx context.Context, req ClipManifestsRequest) (*ClipManifestsResponse, error)
}

// ComputePoster is the untyped seam: sign and POST in as JSON to path, decode the 200 answer into
// out. The learn, gamify and clips packages declare their own narrow request and response types
// over it (NewComputeVia), so the domain packages do not depend on the adapter's types. Errors
// satisfy IsComputeUnavailable when the service is down, times out or answers 5xx/401/403/429.
type ComputePoster interface {
	PostJSON(ctx context.Context, path string, in, out any) error
}

// ComputeProblemType returns the problem type slug of a compute error ("digest-mismatch",
// "content-not-found", ...), or "" when err carries none.
func ComputeProblemType(err error) string {
	var p interface{ ProblemType() string }
	if errors.As(err, &p) {
		return p.ProblemType()
	}
	return ""
}
