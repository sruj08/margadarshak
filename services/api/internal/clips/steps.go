package clips

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	adnotify "github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
)

// Raw-footage deadlines (clip-pipeline blur.ts RAW_RETENTION_MS / RAW_AFTER_AUDIT_MS).
const (
	RawRetention  = 7 * 24 * time.Hour
	RawAfterAudit = 24 * time.Hour
	// MinTakersForEmpirical is when empirical difficulty is shown (NAZAR §7.2).
	MinTakersForEmpirical = 30
	// ClipReadyEvent is the W08 event that opens a clip for review.
	ClipReadyEvent = "md/clip-ready"
	// AdjudicationEvent asks W08 for a third rater.
	AdjudicationEvent = "md/clip-adjudication"
)

// stepArgs is the common clip step input. idempotency_key is the clip-pipeline
// stepIdempotencyKey the task sends; the API dedupes on it.
type stepArgs struct {
	ClipID         string `json:"clip_id"`
	Version        int    `json:"version"`
	Round          int    `json:"round"`
	IdempotencyKey string `json:"idempotency_key"`
}

func decodeArgs(args map[string]any, v any) error {
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return &ValidationError{"/args", "invalid"}
	}
	return nil
}

func toMap(v any) (map[string]any, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	return out, json.Unmarshal(raw, &out)
}

func (s *Service) loadStepClip(ctx context.Context, args map[string]any, extra any) (*Clip, stepArgs, error) {
	var a stepArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, a, err
	}
	if extra != nil {
		if err := decodeArgs(args, extra); err != nil {
			return nil, a, err
		}
	}
	if !ValidClipID(a.ClipID) || a.Version < 1 {
		return nil, a, &ValidationError{"/clip_id", "invalid"}
	}
	c, err := s.Store.GetClip(ctx, a.ClipID, a.Version)
	return c, a, err
}

// Steps returns the clip job steps for jobs.Steps(…, extra) (POST /internal/job-steps/{step}).
func (s *Service) Steps() map[string]StepFunc {
	return map[string]StepFunc{
		"clip.get":                  s.stepGet,
		"clip.open_review":          s.stepOpenReview,
		"clip.propose_windows":      s.stepProposeWindows,
		"clip.agreement":            s.stepAgreement,
		"clip.request_adjudication": s.stepRequestAdjudication,
		"clip.blur_audit_check":     s.stepBlurAuditCheck,
		"clip.delete_raw":           s.stepDeleteRaw,
		"clip.publish_manifest":     s.stepPublishManifest,
		"clip.recompute_difficulty": s.stepRecomputeDifficulty,
		"clip.register_generated":   s.stepRegisterGenerated,
	}
}

// clip.get: what the task needs to process a clip version (keys, durations, current status).
func (s *Service) stepGet(ctx context.Context, args map[string]any) (map[string]any, error) {
	c, _, err := s.loadStepClip(ctx, args, nil)
	if err != nil {
		return nil, err
	}
	return toMap(map[string]any{
		"clip_id": c.ClipID, "version": c.Version, "ref": c.Ref(), "status": c.Status,
		"raw_object_key": c.RawObjectKey, "duration_ms": c.Doc.DurationMs, "media": c.Doc.Media,
		"flash_passed": c.FlashPassed, "raw_deleted": c.RawDeletedAt != nil, "round": c.Round,
	})
}

// openReviewArgs are the ingest results the task records in one call (IDs, hashes and small
// results only; never media).
type openReviewArgs struct {
	// Origin is what the task believes the clip is; a mismatch with the stored clip is refused.
	Origin           string          `json:"origin"`
	Media            []MediaEntry    `json:"media"`
	FlashPassed      *bool           `json:"flash_passed"`
	Proposals        []Proposal      `json:"proposals"`
	BlurRegions      json.RawMessage `json:"blur_regions"`
	IntermediateKeys []string        `json:"intermediate_keys"`
}

// clip.open_review records the ingest results (renditions, flash check, proposals), moves the
// clip forward to proposed (awaiting two blind ratings) and posts the signed n8n md/clip-ready
// envelope to W08. Re-running with the same idempotency key changes nothing and posts nothing.
func (s *Service) stepOpenReview(ctx context.Context, args map[string]any) (map[string]any, error) {
	var in openReviewArgs
	c, a, err := s.loadStepClip(ctx, args, &in)
	if err != nil {
		return nil, err
	}
	eventID := a.IdempotencyKey
	if eventID == "" {
		eventID = StepIdempotencyKey("open_review", c.ClipID, c.Version, 0)
	}
	if in.Origin != "" && in.Origin != c.Doc.OriginOrDefault() {
		return nil, &ValidationError{"/origin", "does_not_match_clip"}
	}
	if c.ReviewEventID == eventID {
		return toMap(map[string]any{"status": c.Status, "event_id": eventID, "replayed": true})
	}
	if c.Status != StatusProposed {
		path := pathTo(c.Doc.Origin, c.Status, StatusProposed)
		if path == nil {
			return nil, &TransitionError{From: c.Status, To: StatusProposed}
		}
		if len(in.Media) > 0 {
			c.Doc.Media = in.Media
		}
		for _, k := range in.IntermediateKeys {
			if !validObjectKey(k) {
				return nil, &ValidationError{"/intermediate_keys", "invalid_object_key"}
			}
		}
		c.IntermediateKeys = append(c.IntermediateKeys, in.IntermediateKeys...)
		if in.FlashPassed != nil {
			c.FlashPassed = in.FlashPassed
		}
		c.Proposals = append([]Proposal{}, in.Proposals...)
		c.BlurRegions = in.BlurRegions
		c.Status, c.Doc.Status = StatusProposed, StatusProposed
		// Renditions must exist from blurred on (clip-pipeline checkInvariants).
		for _, r := range Renditions {
			if _, ok := c.Doc.MediaFor(r); !ok {
				return nil, &ValidationError{"/media", "missing_rendition_" + r}
			}
		}
		if err := ValidateDocStruct(&c.Doc); err != nil {
			return nil, err
		}
	}
	now := s.now()
	payload, err := json.Marshal(map[string]any{
		"event": ClipReadyEvent, "event_id": eventID, "tenant": c.Tenant, "clip_id": c.ClipID, "version": c.Version,
		"ref": c.Ref(), "raters_needed": 2, "flash_passed": c.FlashPassed, "proposals": len(c.Proposals),
		"blur_audit_needed": !c.Doc.IsAI() && c.AuditPassedAt == nil, "origin": c.Doc.OriginOrDefault(),
		"synthetic_review_needed": c.Doc.IsAI() && !syntheticReviewPasses(c),
	})
	if err != nil {
		return nil, err
	}
	env := adnotify.SignEnvelope(s.HMACSecret, now, payload)
	if s.Webhooks != nil {
		if err := s.Webhooks.PostEnvelope(ctx, s.ClipReadyPath, env); err != nil {
			return nil, fmt.Errorf("clips: post %s: %w", ClipReadyEvent, err)
		}
	}
	c.ReviewEventID, c.UpdatedAt = eventID, now
	if err := s.Store.UpdateClip(ctx, c); err != nil {
		return nil, err
	}
	return toMap(map[string]any{"status": c.Status, "event_id": eventID, "replayed": false})
}

// clip.propose_windows is a stub in P2 (decision D8): the AI layer is P3, and no unaudited
// media is sent to a model. Raters start without proposals.
func (s *Service) stepProposeWindows(context.Context, map[string]any) (map[string]any, error) {
	return map[string]any{"status": "skipped", "reason": "AI layer is P3", "proposals": []any{}}, nil
}

// clip.agreement runs /clip/agreement over the two saved ratings. Accepted → final windows and
// status rated; otherwise next = clip.request_adjudication (the run ends; W08 restarts
// clip_finalize after the adjudication).
func (s *Service) stepAgreement(ctx context.Context, args map[string]any) (map[string]any, error) {
	c, a, err := s.loadStepClip(ctx, args, nil)
	if err != nil {
		return nil, err
	}
	if c.Status == StatusRated || c.Status == StatusPublished {
		return toMap(map[string]any{"accepted": true, "status": c.Status, "replayed": true, "final_hazards": len(c.FinalHazards)})
	}
	if c.Status == StatusAdjudication {
		return toMap(map[string]any{"accepted": false, "status": c.Status, "next": "await_adjudication"})
	}
	if c.Status != StatusProposed {
		return nil, ErrWrongStatus
	}
	ratings, err := s.Store.Ratings(ctx, c.ClipID, c.Version)
	if err != nil {
		return nil, err
	}
	if len(ratings) != 2 {
		return toMap(map[string]any{"accepted": false, "status": c.Status, "next": "await_ratings", "ratings": len(ratings)})
	}
	dur := c.Doc.DurationMs
	resp, err := s.Compute.Agreement(ctx, AgreementRequest{Op: "agreement", Now: s.now().UnixMilli(),
		RaterA: &ratings[0].Submission, RaterB: &ratings[1].Submission, DurationMs: &dur, Proposals: c.Proposals})
	if err != nil {
		return nil, err
	}
	if resp.Agreement == nil {
		return nil, errors.New("clips: /clip/agreement returned no agreement")
	}
	g := resp.Agreement
	c.Agreement, c.AgreementAccepted, c.NeedsThirdRater = resp.Raw, g.Accepted, g.NeedsThirdRater
	if a.Round > c.Round {
		c.Round = a.Round
	}
	out := map[string]any{"accepted": g.Accepted, "needs_third_rater": g.NeedsThirdRater, "reasons": g.Reasons}
	if g.Accepted {
		c.FinalHazards = g.FinalHazards
		c.Status, c.Doc.Status = StatusRated, StatusRated
		applyFinalHazards(c)
		out["next"] = "clip.blur_audit_check"
	} else {
		out["next"] = "clip.request_adjudication"
	}
	out["status"] = c.Status
	c.UpdatedAt = s.now()
	if err := s.Store.UpdateClip(ctx, c); err != nil {
		return nil, err
	}
	return toMap(out)
}

// clip.request_adjudication moves proposed → adjudication and asks W08 for a third rater.
func (s *Service) stepRequestAdjudication(ctx context.Context, args map[string]any) (map[string]any, error) {
	c, a, err := s.loadStepClip(ctx, args, nil)
	if err != nil {
		return nil, err
	}
	eventID := a.IdempotencyKey
	if eventID == "" {
		eventID = StepIdempotencyKey("request_adjudication", c.ClipID, c.Version, a.Round)
	}
	if c.AdjudicationEventID == eventID || c.Status == StatusAdjudication && c.AdjudicationEventID != "" {
		return toMap(map[string]any{"status": c.Status, "event_id": c.AdjudicationEventID, "replayed": true})
	}
	if c.Status != StatusAdjudication {
		if _, err := checkPath(c.Doc.Origin, c.Status, StatusAdjudication); err != nil {
			return nil, err
		}
		c.Status, c.Doc.Status = StatusAdjudication, StatusAdjudication
	}
	now := s.now()
	payload, err := json.Marshal(map[string]any{"event": AdjudicationEvent, "event_id": eventID, "tenant": c.Tenant,
		"clip_id": c.ClipID, "version": c.Version, "ref": c.Ref()})
	if err != nil {
		return nil, err
	}
	if s.Webhooks != nil {
		path := s.AdjudicationPath
		if path == "" {
			path = s.ClipReadyPath
		}
		if err := s.Webhooks.PostEnvelope(ctx, path, adnotify.SignEnvelope(s.HMACSecret, now, payload)); err != nil {
			return nil, fmt.Errorf("clips: post %s: %w", AdjudicationEvent, err)
		}
	}
	c.AdjudicationEventID, c.UpdatedAt = eventID, now
	if err := s.Store.UpdateClip(ctx, c); err != nil {
		return nil, err
	}
	return toMap(map[string]any{"status": c.Status, "event_id": eventID, "replayed": false})
}

// clip.blur_audit_check: pass only for a 100%-of-frames audit with 0 misses on the current bytes.
// A failure ends the run (back to blur with manual masks, as a new version: see open questions).
func (s *Service) stepBlurAuditCheck(ctx context.Context, args map[string]any) (map[string]any, error) {
	c, _, err := s.loadStepClip(ctx, args, nil)
	if err != nil {
		return nil, err
	}
	if c.Doc.IsAI() {
		// clip-pipeline clipReviewPasses: the synthetic review is the gate for ai_generated clips.
		if syntheticReviewPasses(c) {
			return map[string]any{"passed": true, "issues": []any{}, "gate": "synthetic_review"}, nil
		}
		return map[string]any{"passed": false, "issues": []any{"no passing synthetic review recorded"}, "gate": "synthetic_review"}, nil
	}
	a, err := s.Store.LatestBlurAudit(ctx, c.ClipID, c.Version)
	if errors.Is(err, ErrNotFound) {
		return map[string]any{"passed": false, "issues": []any{"no blur audit recorded"}}, nil
	}
	if err != nil {
		return nil, err
	}
	issues := blurAuditIssues(a, &c.Doc)
	return toMap(map[string]any{"passed": len(issues) == 0, "issues": issues})
}

// clip.delete_raw deletes the raw upload, the mezzanine and the unblurred intermediates from
// the object store and logs a RawDeletion record (MD-218). It needs a passing audit, unless the
// 7-day retention limit has passed (then it deletes anyway, reason retention_limit). Idempotent:
// a second call returns the existing record.
func (s *Service) stepDeleteRaw(ctx context.Context, args map[string]any) (map[string]any, error) {
	c, _, err := s.loadStepClip(ctx, args, nil)
	if err != nil {
		return nil, err
	}
	if c.Doc.IsAI() {
		// ADR-0013: an ai_generated clip has no raw footage of real people or places to delete.
		s.log().InfoContext(ctx, "raw deletion skipped: ai_generated clip", "clip", c.Ref())
		return map[string]any{"deleted": false, "skipped": true, "reason": "ai_generated: no raw footage"}, nil
	}
	if prev, err := s.Store.RawDeletion(ctx, c.ClipID, c.Version); err == nil {
		return deletionMap(prev, true)
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	now := s.now()
	reason := "audit_passed"
	if c.AuditPassedAt == nil {
		if now.Before(c.RegisteredAt.Add(RawRetention)) {
			return map[string]any{"deleted": false, "reason": "blur audit has not passed"}, nil
		}
		reason = "retention_limit"
	}
	keys := append([]string{c.RawObjectKey}, c.IntermediateKeys...)
	sort.Strings(keys[1:])
	for _, k := range keys {
		if !validObjectKey(k) {
			return nil, &ValidationError{"/object_keys", "invalid_object_key"}
		}
		if err := s.Objects.Delete(ctx, k); err != nil {
			return nil, fmt.Errorf("clips: delete raw object: %w", err)
		}
	}
	deadline := c.RegisteredAt.Add(RawRetention)
	if c.AuditPassedAt != nil && c.AuditPassedAt.Add(RawAfterAudit).Before(deadline) {
		deadline = c.AuditPassedAt.Add(RawAfterAudit)
	}
	d := &RawDeletion{ClipID: c.ClipID, Version: c.Version, ObjectKeys: keys, Reason: reason, UploadedAt: c.RegisteredAt,
		AuditPassedAt: c.AuditPassedAt, DeletedAt: now, DeletedBy: "clip_finalize", Deadline: deadline, OnTime: !now.After(deadline)}
	if err := s.Store.InsertRawDeletion(ctx, d); err != nil {
		return nil, err
	}
	if !d.OnTime {
		s.log().WarnContext(ctx, "raw footage deleted after its deadline", "clip", c.Ref(), "deadline", deadline)
	}
	s.log().InfoContext(ctx, "raw footage deleted", "clip", c.Ref(), "objects", len(keys), "reason", reason)
	c.RawDeletedAt, c.UpdatedAt = &now, now
	if err := s.Store.UpdateClip(ctx, c); err != nil {
		return nil, err
	}
	return deletionMap(d, false)
}

func deletionMap(d *RawDeletion, replayed bool) (map[string]any, error) {
	return toMap(map[string]any{"deleted": true, "replayed": replayed, "reason": d.Reason, "objects": len(d.ObjectKeys),
		"deleted_at": d.DeletedAt, "deadline": d.Deadline, "on_time": d.OnTime})
}

// clip.publish_manifest publishes the clip when it is still rated (every publish precondition
// is checked again) and rebuilds both manifests through /clip/manifests.
func (s *Service) stepPublishManifest(ctx context.Context, args map[string]any) (map[string]any, error) {
	var a stepArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, err
	}
	if a.ClipID != "" {
		if _, err := s.publish(ctx, a.ClipID, a.Version); err != nil {
			return nil, err
		}
	}
	m, err := s.RebuildManifest(ctx)
	if err != nil {
		return nil, err
	}
	eligible := 0
	for _, e := range m.MockEligibility {
		if e.Eligible {
			eligible++
		}
	}
	return toMap(map[string]any{"manifest_version": m.Version, "generated_at": m.GeneratedAt, "clips": len(m.MockEligibility),
		"mock_eligible": eligible, "bank_key": "manifests/bank/" + m.Version + ".json", "client_key": "manifests/client/" + m.Version + ".json"})
}

// RebuildManifest builds the bank and client manifests from every published and retired clip,
// stores the new version, updates per-clip mock eligibility and, with an object store, uploads
// both manifests under manifests/{bank,client}/<version>.json (the previous version stays).
func (s *Service) RebuildManifest(ctx context.Context) (*Manifest, error) {
	clips, err := s.Store.ListClips(ctx, ListFilter{Status: []Status{StatusPublished, StatusRetired}})
	if err != nil {
		return nil, err
	}
	if len(clips) > 200 {
		return nil, fmt.Errorf("clips: %d released clips exceed one /clip/manifests call (200)", len(clips))
	}
	req := ManifestsRequest{Now: s.now().UnixMilli(), Clips: []json.RawMessage{}, FlashPassed: map[string]bool{}, Include: []string{"bank", "client"}}
	for _, c := range clips {
		raw, err := c.Doc.JSON()
		if err != nil {
			return nil, err
		}
		req.Clips = append(req.Clips, raw)
		if c.FlashPassed != nil {
			req.FlashPassed[c.Ref()] = *c.FlashPassed
		}
	}
	resp, err := s.Compute.Manifests(ctx, req)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(resp.Client)
	m := &Manifest{Version: hex.EncodeToString(sum[:8]), GeneratedAt: s.now(), Bank: resp.Bank, Client: resp.Client, MockEligibility: resp.MockEligibility}
	var digest struct {
		Digest string `json:"digest"`
	}
	if json.Unmarshal(resp.Client, &digest) == nil && digest.Digest != "" {
		m.Version = shortDigest(digest.Digest)
	}
	if s.Objects != nil {
		if err := s.Objects.Put(ctx, "manifests/bank/"+m.Version+".json", resp.Bank, "application/json"); err != nil {
			return nil, err
		}
		if err := s.Objects.Put(ctx, "manifests/client/"+m.Version+".json", resp.Client, "application/json"); err != nil {
			return nil, err
		}
	}
	if err := s.Store.SaveManifest(ctx, m); err != nil {
		return nil, err
	}
	for _, c := range clips {
		e, ok := resp.MockEligibility[c.Ref()]
		eligible := ok && e.Eligible && c.Status == StatusPublished
		if c.MockEligible != eligible || ok {
			c.MockEligible, c.MockReasons, c.UpdatedAt = eligible, e.Reasons, s.now()
			if err := s.Store.UpdateClip(ctx, c); err != nil {
				return nil, err
			}
		}
	}
	return m, nil
}

func shortDigest(d string) string {
	if i := len("sha256:"); len(d) > i && d[:i] == "sha256:" {
		d = d[i:]
	}
	if len(d) > 16 {
		d = d[:16]
	}
	return d
}

// clip.recompute_difficulty updates empirical difficulty from verified sessions: mean points per
// hazard mapped to the curator scale as 1 + (5 − points) × 4/5 (clip-pipeline difficulty.ts),
// shown from 30 takers. It flags a ≥ 2-level gap from the curator's rating.
func (s *Service) stepRecomputeDifficulty(ctx context.Context, args map[string]any) (map[string]any, error) {
	c, _, err := s.loadStepClip(ctx, args, nil)
	if err != nil {
		return nil, err
	}
	if s.Takers == nil {
		return map[string]any{"status": "skipped", "reason": "no taker statistics source configured"}, nil
	}
	points, n, err := s.Takers.ClipTakerStats(ctx, c.Ref())
	if err != nil {
		return nil, err
	}
	c.Doc.Difficulty.NTakers = n
	c.Doc.Difficulty.Empirical = nil
	flag := false
	if n >= MinTakersForEmpirical {
		lvl := 1 + (5-points)*4/5
		if lvl < 1 {
			lvl = 1
		}
		if lvl > 5 {
			lvl = 5
		}
		lvl = float64(roundInt(lvl*100)) / 100
		c.Doc.Difficulty.Empirical = &lvl
		if cur := c.Doc.Difficulty.Curator; cur != nil {
			diff := lvl - float64(*cur)
			flag = diff >= 2 || diff <= -2
		}
	}
	c.UpdatedAt = s.now()
	if err := s.Store.UpdateClip(ctx, c); err != nil {
		return nil, err
	}
	return toMap(map[string]any{"n_takers": n, "empirical": c.Doc.Difficulty.Empirical, "curator": c.Doc.Difficulty.Curator,
		"review_flag": flag})
}
