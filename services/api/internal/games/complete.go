package games

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// CompleteRequest is API-35 after auth.
type CompleteRequest struct {
	Subject      Subject
	SessionID    uuid.UUID
	ClientResult json.RawMessage // the client's preview SessionResult (optional)
	Replay       Replay
}

// Completed is the API-35 result.
type Completed struct {
	SessionID     uuid.UUID
	Status        string
	ServerChecked bool
	Provisional   bool
	Replayed      bool // an idempotent repeat: the stored outcome, no new work
	// Result is the server SessionResult; when the verifier was down it is the client preview
	// with integrity.provisional = true.
	Result      json.RawMessage
	ClientPct   *float64
	ServerPct   *float64
	Trust       *float64
	Flags       []string
	TimingMode  string
	Eligible    map[string]bool
	Comparison  *ports.Comparison
	Analysis    json.RawMessage
	Awards      *AwardSummary
	NazarScore  *float64
	NazarScoreN int
}

var (
	digestRe = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	base64Re = regexp.MustCompile(`^[A-Za-z0-9+/]*={0,2}$`)
)

// validateReplay applies the verifier's own envelope rules before any work.
func validateReplay(r Replay, client json.RawMessage) error {
	if len(r.Inputs) > MaxReplayChars {
		return ErrReplayTooLarge
	}
	switch {
	case !digestRe.MatchString(r.Digest):
		return fmt.Errorf("%w: digest", ErrInvalidReplay)
	case r.Encoding != "" && r.Encoding != "mdr1" && r.Encoding != "mdr1+gzip":
		return fmt.Errorf("%w: encoding", ErrInvalidReplay)
	case r.TelemetryVersion != 0 && r.TelemetryVersion != 1:
		return fmt.Errorf("%w: telemetryVersion", ErrInvalidReplay)
	case r.EventCount < 0 || r.EventCount > 5000:
		return fmt.Errorf("%w: eventCount", ErrInvalidReplay)
	case !base64Re.MatchString(r.Inputs):
		return fmt.Errorf("%w: inputs", ErrInvalidReplay)
	}
	if len(client) > 0 {
		var obj map[string]json.RawMessage
		if len(client) > MaxClientResult || json.Unmarshal(client, &obj) != nil {
			return fmt.Errorf("%w: clientResult", ErrInvalidReplay)
		}
	}
	return nil
}

// Complete verifies a session through the verifier; the server result wins (API-35).
// Idempotent on sid + digest; a different digest after completion is ErrDigestConflict.
func (s *Service) Complete(ctx context.Context, req CompleteRequest) (*Completed, error) {
	if err := validateReplay(req.Replay, req.ClientResult); err != nil {
		return nil, err
	}
	var out *Completed
	var rejected error
	err := s.DB.Tenant(ctx, req.Subject.Tenant, func(tx pgx.Tx) error {
		sess, err := s.Store.GetSessionForUpdate(ctx, tx, req.SessionID)
		if errors.Is(err, ErrNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if !sess.Subject.Same(req.Subject) {
			return ErrNotFound // never reveal another subject's session
		}
		switch sess.Status {
		case StatusChecked, StatusPendingVerification:
			if sess.Replay == nil || sess.Replay.Digest != req.Replay.Digest {
				return ErrDigestConflict
			}
			out, err = s.stored(ctx, tx, sess)
			return err
		case StatusVoided:
			return ErrSessionVoided
		case StatusStarted:
		default:
			return fmt.Errorf("games: session in status %q", sess.Status)
		}

		now := s.Clock.Now().UTC()
		r := req.Replay
		if r.Encoding == "" {
			r.Encoding = "mdr1"
		}
		if r.TelemetryVersion == 0 {
			r.TelemetryVersion = 1
		}
		sess.Replay, sess.SubmittedAt = &r, &now
		sess.ClientResult = req.ClientResult
		sess.ClientPct = clientPct(req.ClientResult)
		sess.Hints.SessionExpired = now.After(sess.ExpiresAt)
		if sess.GameID == GameNazar && (sess.Mode == ModeMock || sess.Mode == ModePair) {
			ids := clipIDs(sess.Items)
			before, err := s.Store.ClipsSeenBefore(ctx, tx, sess.Subject, ids, sess.StartedAt)
			if err != nil {
				return err
			}
			sess.Hints.SeenClip = len(before) > 0
		}
		res, err := s.verify(ctx, tx, sess, now)
		if err != nil {
			var rej *RejectedError
			if errors.As(err, &rej) {
				rejected = err // the void is committed; the error goes to the caller
				return nil
			}
			return err
		}
		out = res
		return nil
	})
	if err != nil {
		return nil, err
	}
	if rejected != nil {
		return nil, rejected
	}
	return out, nil
}

// verify calls the verifier for a submitted session and persists the outcome: checked (server
// result, awards, study hook), pending (verifier unavailable) or voided (replay rejected,
// returned as *RejectedError). Shared by Complete and the replay-pending step.
func (s *Service) verify(ctx context.Context, tx pgx.Tx, sess *Session, now time.Time) (*Completed, error) {
	vreq, err := s.verifyRequest(ctx, sess)
	if err != nil {
		return nil, err
	}
	resp, err := s.Compute.Verify(ctx, vreq)
	switch {
	case err == nil:
	case errors.Is(err, ports.ErrComputeUnavailable) || serverSide(err):
		// R-05 / R-11: keep the submission, show it as provisional, re-check later.
		s.Log.WarnContext(ctx, "games: verifier unavailable, session pending", "sid", sess.ID.String(),
			"problem", ports.ComputeProblemType(err))
		sess.Status = StatusPendingVerification
		if err := s.Store.MarkPending(ctx, tx, sess); err != nil {
			return nil, err
		}
		return s.view(sess, nil), nil
	default:
		sess.Status = StatusVoided
		sess.RejectedType = ports.ComputeProblemType(err)
		if err := s.Store.VoidSession(ctx, tx, sess); err != nil {
			return nil, err
		}
		return nil, &RejectedError{ProblemType: sess.RejectedType}
	}

	sum := resp.Summary
	sess.Status = StatusChecked
	sess.VerifiedAt = &now
	sess.ServerResult = resp.Result
	pct, trust := sum.Score.Pct, sum.Integrity.Trust
	sess.ServerPct, sess.Trust = &pct, &trust
	sess.Flags, sess.TimingMode = sum.Integrity.Flags, sum.Integrity.TimingMode
	sess.Eligible = eligibility(sum, sess.Hints)
	if len(resp.Analysis) > 0 {
		if sess.Analysis, err = json.Marshal(resp.Analysis); err != nil {
			return nil, err
		}
	}
	if err := s.Store.CompleteSession(ctx, tx, sess); err != nil {
		return nil, err
	}
	if sess.Eligible[EligibleCounted] {
		if err := s.Store.IncrementCounter(ctx, tx, sess.Subject.Tenant, CounterCounted, 1); err != nil {
			return nil, err
		}
	}
	// GAME_SDK §7: practice and learn adapt the difficulty staircase; mock never does.
	if err := s.adapt(ctx, tx, sess, resp.Analysis); err != nil {
		return nil, err
	}
	vs := VerifiedSession{
		ID: sess.ID, Subject: sess.Subject, GameID: sess.GameID, Mode: sess.Mode, Result: sess.ServerResult,
		Trust: trust, Eligible: sess.Eligible, VerifiedAt: now,
	}
	if sess.SubmittedAt != nil {
		vs.DurationMs = sess.SubmittedAt.Sub(sess.StartedAt).Milliseconds()
	}
	out := s.view(sess, resp.Comparison)
	if s.Awards != nil {
		a, err := s.Awards.OnSessionVerified(ctx, tx, vs)
		if err != nil {
			return nil, fmt.Errorf("games: awards: %w", err)
		}
		out.Awards = &a
	}
	if s.Study != nil {
		if err := s.Study.OnSessionVerified(ctx, tx, vs); err != nil {
			return nil, fmt.Errorf("games: study hook: %w", err)
		}
	}
	if sess.GameID == GameNazar && sess.Mode == ModeMock {
		if out.NazarScore, out.NazarScoreN, err = s.NazarScore(ctx, tx, sess.Subject); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// serverSide reports verifier rejections caused by our side (content we failed to send, a
// version the verifier has not loaded, a request it found malformed): the session stays pending
// so a fixed deployment can still verify it, instead of voiding the player's work.
func serverSide(err error) bool {
	switch ports.ComputeProblemType(err) {
	case "validation-failed", "content-not-found", "content-mismatch", "unsupported-game",
		"unsupported-version", "payload-too-large", "bad-request", "unsupported-media-type", "not-found":
		return true
	}
	return false
}

// verifyRequest builds POST /verify from the stored session: the SessionContext the client got,
// the replay, hints, and for Nazar the clip documents inline plus both per-clip analyses.
func (s *Service) verifyRequest(ctx context.Context, sess *Session) (ports.VerifyRequest, error) {
	var sc SessionContext
	if err := json.Unmarshal(sess.Context, &sc); err != nil {
		return ports.VerifyRequest{}, fmt.Errorf("games: stored context: %w", err)
	}
	items := make([]ports.SessionItem, len(sc.Items))
	for i, it := range sc.Items {
		items[i] = ports.SessionItem{Ref: it.Ref, ContentVersion: it.ContentVersion}
	}
	offline := sc.Offline
	req := ports.VerifyRequest{
		SID: sess.ID.String(), GameID: sess.GameID, GameVersion: sess.GameVersion, ScoringVersion: sess.ScoringVersion,
		Mode: sess.Mode, Difficulty: sess.Difficulty, Seed: sess.Seed, SeedOrigin: sess.SeedOrigin, Items: items,
		Tenant: sc.Tenant, RulePackVersion: sc.RulePackVersion,
		TelemetryVersion: sess.Replay.TelemetryVersion, Encoding: sess.Replay.Encoding, Inputs: sess.Replay.Inputs,
		Digest: sess.Replay.Digest, EventCount: sess.Replay.EventCount,
		Context: &ports.VerifyContext{UserBand: sc.UserBand, Locale: sc.Locale, A11yModes: sc.A11y.Modes,
			DeviceClass: sc.DeviceClass, Offline: &offline, ServerStartISO: sc.ServerStartISO},
		ClientResult: comparable(sess.ClientResult),
	}
	expired := sess.Hints.SessionExpired
	req.Hints = &ports.VerifyHints{SessionExpired: &expired}
	if sess.GameID == GameNazar {
		if sess.Mode == ModeMock || sess.Mode == ModePair {
			seen := sess.Hints.SeenClip
			req.Hints.SeenClip = &seen
		}
		refs := make([]string, 0, len(sess.Items))
		for _, it := range sess.Items {
			refs = append(refs, it.Ref)
		}
		docs, err := s.Clips.ScoringDocs(ctx, uniq(refs))
		if err != nil {
			return ports.VerifyRequest{}, fmt.Errorf("games: scoring documents: %w", err)
		}
		req.Content = &ports.InlineContent{Items: docs}
		req.Analysis = []string{ports.AnalysisNazarClips, ports.AnalysisNazarClipsLinear}
	}
	return req, nil
}

// eligibility derives what the session counts for from the server result only (GAME_SDK §6.4).
func eligibility(sum ports.ResultSummary, h Hints) map[string]bool {
	verified := !sum.Integrity.Provisional
	counted := verified && sum.Integrity.Trust >= TrustThreshold
	nazar := counted && sum.GameID == GameNazar && sum.Mode == ModeMock && sum.SeedOrigin == SeedOriginServer &&
		sum.Integrity.TimingMode == "rvfc" && !sum.Integrity.HasFlag("INT_SEEN_CLIP") &&
		!sum.Integrity.HasFlag("INT_OFFLINE_SEED") && !h.SeenClip
	return map[string]bool{
		EligibleXP: verified, EligibleBadges: verified, EligibleCounted: counted,
		EligibleNazarScore: nazar, EligiblePercentiles: nazar,
	}
}

// stored rebuilds the outcome of an already-completed session (idempotent repeat).
func (s *Service) stored(ctx context.Context, tx pgx.Tx, sess *Session) (*Completed, error) {
	out := s.view(sess, nil)
	out.Replayed = true
	if sess.Status == StatusChecked && sess.GameID == GameNazar && sess.Mode == ModeMock {
		var err error
		if out.NazarScore, out.NazarScoreN, err = s.NazarScore(ctx, tx, sess.Subject); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Service) view(sess *Session, cmp *ports.Comparison) *Completed {
	out := &Completed{
		SessionID: sess.ID, Status: sess.Status, ClientPct: sess.ClientPct, Comparison: cmp,
		Eligible: sess.Eligible, Analysis: sess.Analysis,
	}
	if sess.Status == StatusChecked {
		out.ServerChecked = true
		out.Result, out.ServerPct, out.Trust = sess.ServerResult, sess.ServerPct, sess.Trust
		out.Flags, out.TimingMode = sess.Flags, sess.TimingMode
		return out
	}
	out.Provisional = true
	out.Result = provisional(sess.ClientResult)
	out.Eligible = map[string]bool{} // provisional sessions count for nothing until verified
	return out
}

// provisional marks a client preview as provisional (integrity.provisional = true).
func provisional(client json.RawMessage) json.RawMessage {
	var doc map[string]json.RawMessage
	if len(client) == 0 || json.Unmarshal(client, &doc) != nil {
		return client
	}
	var integ map[string]any
	if raw, ok := doc["integrity"]; !ok || json.Unmarshal(raw, &integ) != nil || integ == nil {
		integ = map[string]any{}
	}
	integ["provisional"] = true
	doc["integrity"], _ = json.Marshal(integ)
	out, err := json.Marshal(doc)
	if err != nil {
		return client
	}
	return out
}

// comparable returns the client result when it has the fields the verifier compares
// (score.pct and findings[].findingId); otherwise nothing is sent. A preview with an empty score
// (score.max == 0: the web's mock mode never scores the windows it never received) is not a
// claim about the score, so it is not compared and never adds INT_REPLAY_MISMATCH.
func comparable(client json.RawMessage) json.RawMessage {
	var c struct {
		Score *struct {
			Pct *float64 `json:"pct"`
			Max *float64 `json:"max"`
		} `json:"score"`
		Findings *[]struct {
			FindingID string `json:"findingId"`
		} `json:"findings"`
	}
	if len(client) == 0 || json.Unmarshal(client, &c) != nil || c.Score == nil || c.Score.Pct == nil || c.Findings == nil {
		return nil
	}
	if c.Score.Max != nil && *c.Score.Max == 0 {
		return nil
	}
	return client
}

func clientPct(client json.RawMessage) *float64 {
	var c struct {
		Score struct {
			Pct *float64 `json:"pct"`
			Max *float64 `json:"max"`
		} `json:"score"`
	}
	if len(client) == 0 || json.Unmarshal(client, &c) != nil || c.Score.Pct == nil || *c.Score.Pct < 0 || *c.Score.Pct > 100 ||
		(c.Score.Max != nil && *c.Score.Max == 0) {
		return nil
	}
	return c.Score.Pct
}

func clipIDs(items []Item) []string {
	var out []string
	for _, it := range items {
		if id, _, ok := clipRef(it.Ref); ok {
			out = append(out, id)
		}
	}
	return uniq(out)
}

func uniq(xs []string) []string {
	seen := map[string]bool{}
	out := xs[:0:0]
	for _, x := range xs {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}
