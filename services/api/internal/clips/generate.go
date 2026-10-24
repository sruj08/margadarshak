package clips

// AI-generated clips (ADR-0013): the curator's "Generate clip" (starts the clip_generate Render
// Workflows task for one scene revision and batch), the clip.register_generated step that task
// calls once the video exists (it creates the clip), and the synthetic-content review that
// replaces the blur audit for these clips. Two raters and agreement stay required.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// DefaultVideoModel is clip-pipeline DEFAULT_VIDEO_MODEL (GEMINI_MODEL_VIDEO_GEN default).
const DefaultVideoModel = "gemini-omni-1.1-flash"

// generatedRegistrar is the pseudonym that registers the clips clip_generate creates.
const generatedRegistrar = "system-clipgen"

var (
	sceneIDRe = regexp.MustCompile(`^SCN-\d{3}$`)
	batchIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	modelIDRe = regexp.MustCompile(`^[a-z][a-z0-9.-]{2,63}$`)
	monthRe   = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)
)

var (
	// ErrScenesUnavailable means the scene catalogue (content/nazar/scenes.json) cannot be read.
	ErrScenesUnavailable = errors.New("clips: scene catalogue unavailable")
	// ErrNoJobRunner means no JobStarter is configured, so clip_generate cannot start.
	ErrNoJobRunner = errors.New("clips: no job runner configured")
)

// Scene is the part of a content/nazar/scenes.json scene the API checks (the generator
// validates the full scene with clip-pipeline SceneSpecSchema).
type Scene struct {
	SceneID  string `json:"sceneId"`
	Revision int    `json:"revision"`
}

// GenerationKey is the dedupe key of one generated clip: `sceneId:revision:batchId`.
func GenerationKey(sceneID string, revision int, batchID string) string {
	return fmt.Sprintf("%s:%d:%s", sceneID, revision, batchID)
}

// generationIdempotencyKey mirrors clip-pipeline generationIdempotencyKey.
func generationIdempotencyKey(step, sceneID string, revision int, batchID string) string {
	return fmt.Sprintf("%s:%d:%s:%s", sceneID, revision, batchID, step)
}

// LoadScene reads one scene from ScenesPath (ErrScenesUnavailable when it cannot be read; a
// *ValidationError for an unknown scene).
func (s *Service) LoadScene(sceneID string) (*Scene, error) {
	if s.ScenesPath == "" {
		return nil, ErrScenesUnavailable
	}
	raw, err := os.ReadFile(s.ScenesPath)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrScenesUnavailable, err)
	}
	var doc struct {
		Scenes []Scene `json:"scenes"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrScenesUnavailable, err)
	}
	for i := range doc.Scenes {
		if doc.Scenes[i].SceneID == sceneID {
			return &doc.Scenes[i], nil
		}
	}
	return nil, &ValidationError{"/sceneId", "unknown_scene"}
}

// allocateClipID returns <prefix>-NNNN.
func (s *Service) allocateClipID(ctx context.Context, prefix string) (string, error) {
	if !clipPrefixRe.MatchString(prefix) {
		return "", &ValidationError{"/facts/tenantTags", "invalid"}
	}
	n, err := s.Store.NextClipNumber(ctx, prefix)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%04d", prefix, n), nil
}

// GenerateResult is an accepted generation request.
type GenerateResult struct {
	SceneID       string
	Revision      int
	BatchID       string
	GenerationKey string
	RunID         string
	// Clip is the clip clip.register_generated created for this scene revision and batch, when
	// it already exists (a repeat after the task registered it); nil before that.
	Clip *Clip
}

// Generate starts the clip_generate task for one scene revision and batch (generate → precheck
// → register → transcode → render → flash check → open review); the task's
// clip.register_generated step creates the clip. The scene and its revision are checked against
// the catalogue when it can be read (the task checks them again). Idempotent per scene revision
// and batch: the run is started once (the job key is `sceneId:version:batchId:generate`).
func (s *Service) Generate(ctx context.Context, curator Actor, sceneID string, revision int, batchID string) (*GenerateResult, error) {
	if err := requireActor(curator); err != nil {
		return nil, err
	}
	switch {
	case !sceneIDRe.MatchString(sceneID):
		return nil, &ValidationError{"/sceneId", "invalid"}
	case revision < 1:
		return nil, &ValidationError{"/version", "invalid"}
	case !batchIDRe.MatchString(batchID):
		return nil, &ValidationError{"/batchId", "invalid"}
	}
	sc, err := s.LoadScene(sceneID)
	switch {
	case err == nil:
		if sc.Revision != revision {
			return nil, &ValidationError{"/version", "not_the_scene_revision"}
		}
	case errors.Is(err, ErrScenesUnavailable):
		s.log().WarnContext(ctx, "scene catalogue unreadable; clip_generate checks the scene", "scene", sceneID, "err", err)
	default:
		return nil, err
	}
	if s.Jobs == nil {
		return nil, ErrNoJobRunner
	}
	res := &GenerateResult{SceneID: sceneID, Revision: revision, BatchID: batchID, GenerationKey: GenerationKey(sceneID, revision, batchID)}
	if c, err := s.Store.ClipByGenerationKey(ctx, res.GenerationKey); err == nil {
		res.Clip = c
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	run, err := s.Jobs.StartJob(ctx, nil, "clip_generate",
		[]any{map[string]any{"sceneId": sceneID, "version": revision, "batchId": batchID}},
		generationIdempotencyKey("generate", sceneID, revision, batchID))
	if err != nil {
		return nil, fmt.Errorf("clips: start clip_generate: %w", err)
	}
	res.RunID = run
	s.log().InfoContext(ctx, "clip_generate started", "scene", sceneID, "revision", revision, "batch", batchID, "by", curator.Pseudonym)
	return res, nil
}

// Origin returns the origin (filmed | ai_generated) of the clip a ref names (`clip:KL-0007@1`
// or `KL-0007@1`).
func (s *Service) Origin(ctx context.Context, ref string) (string, error) {
	id, v, err := ParseRef(ref)
	if err != nil {
		return "", err
	}
	c, err := s.Store.GetClip(ctx, id, v)
	if err != nil {
		return "", err
	}
	return c.Doc.OriginOrDefault(), nil
}

// OnsetHint is the approximate cue time of a generated clip (clip-pipeline OnsetHint): ±3 s, for
// the raters' first look only. Never authoritative (two humans set every window, D-09), never in
// clip.json, never sent to learners or the verifier.
type OnsetHint struct {
	ApproxOnsetMs int    `json:"approxOnsetMs"`
	ToleranceMs   int    `json:"toleranceMs"`
	Authoritative bool   `json:"authoritative"`
	Basis         string `json:"basis"` // measured | nominal
}

// registerGeneratedArgs is the clip_generate register step body (services/workflows
// clip-generate.ts): IDs, keys, hashes and small facts only. The cue text, hazard type, curator
// difficulty suggestion and occlusion flag it also sends are scene data the raters and the
// curator decide on themselves, so they are not stored.
type registerGeneratedArgs struct {
	SceneID       string          `json:"scene_id"`
	SceneRevision int             `json:"scene_revision"`
	BatchID       string          `json:"batch_id"`
	RawKey        string          `json:"raw_key"`
	RawSHA256     string          `json:"raw_sha256"`
	RawBytes      int64           `json:"raw_bytes"`
	DurationMs    int             `json:"duration_ms"`
	Facts         json.RawMessage `json:"facts"`
	Generation    *Generation     `json:"generation"`
	OnsetHint     *OnsetHint      `json:"onset_hint"`
	Flash         *struct {
		Passes bool `json:"passes"`
	} `json:"flash"`
}

// clip.register_generated creates the ai_generated clip (status raw) for a generated video: the
// scene's clip.json facts, the generation record, the normalised video as its raw object and the
// raters' onset hint. Idempotent per scene revision and batch (the task's key is
// `sceneId:revision:batchId:register`): a repeat returns the same clip and changes nothing.
func (s *Service) stepRegisterGenerated(ctx context.Context, args map[string]any) (map[string]any, error) {
	var a registerGeneratedArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, err
	}
	switch {
	case !sceneIDRe.MatchString(a.SceneID):
		return nil, &ValidationError{"/scene_id", "invalid"}
	case a.SceneRevision < 1:
		return nil, &ValidationError{"/scene_revision", "invalid"}
	case !batchIDRe.MatchString(a.BatchID):
		return nil, &ValidationError{"/batch_id", "invalid"}
	case !validObjectKey(a.RawKey):
		return nil, &ValidationError{"/raw_key", "invalid_object_key"}
	case a.RawSHA256 != "" && !sha256Re.MatchString(a.RawSHA256):
		return nil, &ValidationError{"/raw_sha256", "invalid"}
	case a.Generation == nil:
		return nil, &ValidationError{"/generation", "required"}
	case !a.Generation.SynthID || a.Generation.Disclosure != OriginAIGenerated || a.Generation.SceneID != a.SceneID ||
		!modelIDRe.MatchString(a.Generation.Model) || !monthRe.MatchString(a.Generation.GeneratedAt):
		return nil, &ValidationError{"/generation", "invalid"}
	case a.OnsetHint != nil && (a.OnsetHint.Authoritative || a.OnsetHint.ApproxOnsetMs < 0 || a.OnsetHint.ToleranceMs < 0):
		return nil, &ValidationError{"/onset_hint", "invalid"}
	}
	gk := GenerationKey(a.SceneID, a.SceneRevision, a.BatchID)
	if c, err := s.Store.ClipByGenerationKey(ctx, gk); err == nil {
		return toMap(map[string]any{"clip_id": c.ClipID, "version": c.Version, "status": c.Status, "replayed": true})
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	var d Doc
	if len(a.Facts) > 0 {
		if err := json.Unmarshal(a.Facts, &d); err != nil {
			return nil, &ValidationError{"/facts", "invalid"}
		}
	}
	gen := *a.Generation
	d.Origin, d.Generation, d.SyntheticReview, d.BlurAudit = OriginAIGenerated, &gen, nil, nil
	d.CapturedMonth = gen.GeneratedAt
	if a.DurationMs > 0 {
		d.DurationMs = a.DurationMs
	}
	d.Licence, d.Hazards, d.Media = Licence, nil, nil
	if d.Attribution == "" {
		d.Attribution = Attribution
	}
	if len(d.TenantTags) == 0 {
		return nil, &ValidationError{"/facts/tenantTags", "required"}
	}
	clipID, err := s.allocateClipID(ctx, d.TenantTags[0])
	if err != nil {
		return nil, err
	}
	d.ClipID, d.Version, d.Status = clipID, 1, StatusRaw
	if err := ValidateDocStruct(&d); err != nil {
		return nil, err
	}
	d.normalize()
	now := s.now()
	c := &Clip{ClipID: clipID, Version: 1, Status: StatusRaw, Doc: d, Tenant: d.TenantTags[0], RawObjectKey: a.RawKey,
		RegisteredBy: generatedRegistrar, RegisteredAt: now, CueTexts: map[string]CueText{}, UpdatedAt: now, GenerationKey: gk}
	if a.Flash != nil {
		passes := a.Flash.Passes
		c.FlashPassed = &passes
	}
	if a.OnsetHint != nil {
		raw, err := json.Marshal(a.OnsetHint)
		if err != nil {
			return nil, err
		}
		c.OnsetHint = raw
	}
	if err := s.Store.InsertClip(ctx, c); err != nil {
		// A concurrent retry may have registered it first: answer with that clip.
		if prev, gerr := s.Store.ClipByGenerationKey(ctx, gk); gerr == nil {
			return toMap(map[string]any{"clip_id": prev.ClipID, "version": prev.Version, "status": prev.Status, "replayed": true})
		}
		return nil, err
	}
	s.log().InfoContext(ctx, "generated clip registered", "clip", c.Ref(), "scene", a.SceneID, "batch", a.BatchID)
	return toMap(map[string]any{"clip_id": c.ClipID, "version": c.Version, "status": c.Status, "replayed": false})
}

// syntheticReviewPasses is clip-pipeline syntheticReviewPasses: an ai_generated clip whose
// clip.json carries a (necessarily passing) syntheticReview.
func syntheticReviewPasses(c *Clip) bool {
	return c.Doc.IsAI() && c.Doc.SyntheticReview != nil && c.SyntheticReview != nil && c.SyntheticReview.Passed
}

// SyntheticReviewPasses is syntheticReviewPasses for the HTTP layer.
func SyntheticReviewPasses(c *Clip) bool { return syntheticReviewPasses(c) }

// SubmitSyntheticReview records the curator's synthetic-content review of an ai_generated clip
// (ADR-0013; it replaces the blur audit). Every check true passes and enters clip.json; any
// false check is stored with passed=false and blocks publishing (regenerate or retire). Only for
// ai_generated clips with renditions (transcoded through rated); ErrWrongStatus otherwise.
func (s *Service) SubmitSyntheticReview(ctx context.Context, reviewer Actor, clipID string, version int, checks SyntheticChecks, note string) (*Clip, error) {
	if err := requireActor(reviewer); err != nil {
		return nil, err
	}
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > 240 {
		return nil, &ValidationError{"/note", "too_long"}
	}
	if note != "" && len(privacy.Detect(note)) > 0 {
		return nil, &ValidationError{"/note", "PROHIBITED_FIELD"}
	}
	c, err := s.Store.GetClip(ctx, clipID, version)
	if err != nil {
		return nil, err
	}
	if !c.Doc.IsAI() {
		return nil, ErrWrongStatus
	}
	switch c.Status {
	case StatusTranscoded, StatusProposed, StatusAdjudication, StatusRated:
	default:
		return nil, ErrWrongStatus
	}
	now := s.now()
	rec := &SyntheticReviewRecord{Reviewer: reviewer.Pseudonym, ReviewedAt: now, Checks: checks, Passed: checks.All(), Note: note}
	c.SyntheticReview = rec
	c.Doc.SyntheticReview = nil
	if rec.Passed {
		c.Doc.SyntheticReview = &SyntheticReview{Reviewer: rec.Reviewer, CheckedAt: isoMillis(now), NoRealPersonLikeness: true,
			NoReadablePlates: true, NoRealBrands: true, NoCollisionOrInjury: true, HazardVisible: true}
	}
	c.UpdatedAt = now
	if err := ValidateDocStruct(&c.Doc); err != nil {
		return nil, err
	}
	return c, s.Store.UpdateClip(ctx, c)
}
