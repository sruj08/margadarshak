package clips

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// Service is the clip backend. Required: Store, Clock. Compute, Objects, Webhooks and Jobs are
// needed by the operations that use them; Consents and Takers are optional (nil skips the check
// or the step, which is logged).
type Service struct {
	Store    Store
	Compute  ClipCompute
	Objects  ObjectStore
	Webhooks WebhookPoster
	Jobs     JobStarter
	Consents ConsentChecker
	Takers   TakerStats
	Clock    servertime.Clock
	Log      *slog.Logger

	// HMACSecret signs n8n envelopes (N8N_HMAC_SECRET).
	HMACSecret []byte
	// ClipReadyPath is the W08 webhook path for md/clip-ready (N8N_CLIP_READY_PATH).
	ClipReadyPath string
	// AdjudicationPath is the W08 webhook path for adjudication requests (defaults to ClipReadyPath).
	AdjudicationPath string
	// MediaBaseURL, when set, serves media at <base>/<object key> instead of presigned URLs.
	MediaBaseURL string
	// MediaURLTTL is the presigned URL lifetime (MEDIA_URL_TTL, default 2 h).
	MediaURLTTL time.Duration
	// ScenesPath is content/nazar/scenes.json, the AI clip scene catalogue (ADR-0013).
	ScenesPath string
	// VideoModel is the video model recorded before generation (default DefaultVideoModel).
	VideoModel string
}

// Actor is the pseudonymous person behind an admin call (rater, auditor, curator). The handler
// maps the authenticated admin to its pseudonym; names never reach this package.
type Actor struct{ Pseudonym string }

func (s *Service) now() time.Time { return s.Clock.Now().UTC() }

func (s *Service) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return logging.Discard()
}

func isoMillis(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func requireActor(a Actor) error {
	if !ValidPseudonym(a.Pseudonym) {
		return ErrInvalidActor
	}
	return nil
}

func validObjectKey(k string) bool {
	return k != "" && len(k) <= 512 && !strings.Contains(k, "://") && !strings.Contains(k, "?") &&
		!strings.Contains(k, "..") && !strings.HasPrefix(k, "/")
}

// ---- Register (API-55 POST /v1/admin/clips) -------------------------------------------------

// RegisterInput registers a raw upload. Metadata carries the clip.json fields a curator knows at
// registration (tenantTags, city, roadType, timeOfDay, weather, pov, capturedMonth, speedKmhEst,
// speedSource, durationMs, quietSegments, difficulty, modules); the service sets clipId,
// version, status, licence, attribution, hazards, blurAudit and media.
type RegisterInput struct {
	RawObjectKey         string
	State                string
	FilmedBy             string // passenger | fixed_mount: never the rider
	FilmedOn             string
	Licence              string
	ContributorConsentID string
	ClipID               string // optional; allocated as <Prefix>-NNNN when empty
	Prefix               string // optional; defaults to State
	Metadata             json.RawMessage
}

// Register stores a new clip (status raw) and starts the clip_ingest task.
func (s *Service) Register(ctx context.Context, curator Actor, in RegisterInput) (*Clip, error) {
	if err := requireActor(curator); err != nil {
		return nil, err
	}
	switch {
	case !validObjectKey(in.RawObjectKey):
		return nil, &ValidationError{"/raw_object_key", "invalid_object_key"}
	case in.FilmedBy != "passenger" && in.FilmedBy != "fixed_mount":
		return nil, &ValidationError{"/filmed_by", "never_the_rider"}
	case in.Licence != Licence:
		return nil, &ValidationError{"/licence", "must_be_cc_by_4_0"}
	case strings.TrimSpace(in.ContributorConsentID) == "":
		return nil, &ValidationError{"/contributor_consent_id", "required"}
	case len(in.State) < 2 || len(in.State) > 3 || strings.ToUpper(in.State) != in.State:
		return nil, &ValidationError{"/state", "invalid"}
	}
	if s.Consents != nil {
		ok, err := s.Consents.ClipContributionActive(ctx, in.ContributorConsentID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrConsentRequired
		}
	}
	var d Doc
	if len(in.Metadata) > 0 {
		dec := json.NewDecoder(strings.NewReader(string(in.Metadata)))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&d); err != nil {
			return nil, &ValidationError{"/metadata", "invalid"}
		}
	}
	clipID := in.ClipID
	if clipID == "" {
		prefix := in.Prefix
		if prefix == "" {
			prefix = in.State
		}
		if !clipPrefixRe.MatchString(prefix) {
			return nil, &ValidationError{"/prefix", "invalid"}
		}
		n, err := s.Store.NextClipNumber(ctx, prefix)
		if err != nil {
			return nil, err
		}
		clipID = fmt.Sprintf("%s-%04d", prefix, n)
	}
	if !ValidClipID(clipID) {
		return nil, &ValidationError{"/clip_id", "invalid"}
	}
	d.ClipID, d.Version, d.Status = clipID, 1, StatusRaw
	d.Licence = Licence
	if d.Attribution == "" {
		d.Attribution = Attribution
	}
	if len(d.TenantTags) == 0 {
		d.TenantTags = []string{in.State}
	}
	d.Hazards, d.Media, d.BlurAudit = nil, nil, nil
	if err := ValidateDocStruct(&d); err != nil {
		return nil, err
	}
	d.normalize()
	now := s.now()
	c := &Clip{ClipID: clipID, Version: 1, Status: StatusRaw, Doc: d, Tenant: in.State, RawObjectKey: in.RawObjectKey,
		FilmedBy: in.FilmedBy, FilmedOn: in.FilmedOn, ContributorConsentID: in.ContributorConsentID,
		RegisteredBy: curator.Pseudonym, RegisteredAt: now, CueTexts: map[string]CueText{}, UpdatedAt: now}
	if err := s.Store.InsertClip(ctx, c); err != nil {
		return nil, err
	}
	if s.Jobs != nil {
		tenant := in.State
		run, err := s.Jobs.StartJob(ctx, &tenant, "clip_ingest",
			[]any{map[string]any{"clip_id": clipID, "version": 1, "raw_object_key": in.RawObjectKey}},
			StepIdempotencyKey("ingest", clipID, 1, 0))
		if err != nil {
			// The clip stays registered (status raw); the admin can retry the run.
			s.log().WarnContext(ctx, "clip_ingest start failed", "clip", c.Ref(), "err", err)
		} else {
			c.WorkflowRuns = append(c.WorkflowRuns, run)
			c.UpdatedAt = s.now()
			if err := s.Store.UpdateClip(ctx, c); err != nil {
				return nil, err
			}
		}
	}
	return c, nil
}

// StepIdempotencyKey mirrors clip-pipeline stepIdempotencyKey: `clipId:step:version`, plus
// `:r<round>` for clip_finalize re-runs (round ≥ 1; 0 means no round suffix).
func StepIdempotencyKey(step, clipID string, version, round int) string {
	k := fmt.Sprintf("%s:%s:%d", clipID, step, version)
	if round > 0 {
		k += fmt.Sprintf(":r%d", round)
	}
	return k
}

// ---- List and view (blindness) --------------------------------------------------------------

// List returns clips matching f.
func (s *Service) List(ctx context.Context, f ListFilter) ([]*Clip, error) {
	return s.Store.ListClips(ctx, f)
}

// RatingView is a rating as one viewer may see it.
type RatingView struct {
	Rater   string      `json:"rater"`
	Saved   bool        `json:"saved"`
	SavedAt *time.Time  `json:"saved_at,omitempty"`
	Marks   []RaterMark `json:"marks,omitempty"` // nil while hidden
	Hidden  bool        `json:"hidden"`
}

// AdminView is the API-55 GET view of a clip for one viewer.
type AdminView struct {
	Clip         *Clip           `json:"-"`
	Ratings      []RatingView    `json:"ratings"`
	RatingsSaved int             `json:"ratings_saved"`
	BothSaved    bool            `json:"both_saved"`
	Proposals    []Proposal      `json:"proposals"`
	Agreement    json.RawMessage `json:"agreement,omitempty"`
}

// View returns the clip as viewer may see it. Raters are blind to each other (NAZAR §6.2.2):
// until both ratings are saved, a viewer sees only their own marks; other ratings show only that
// they exist, with their pseudonym hidden. The M-06 proposals and the agreement are shown to
// nobody until both have saved.
func (s *Service) View(ctx context.Context, viewer Actor, clipID string, version int) (*AdminView, error) {
	if err := requireActor(viewer); err != nil {
		return nil, err
	}
	c, err := s.Store.GetClip(ctx, clipID, version)
	if err != nil {
		return nil, err
	}
	ratings, err := s.Store.Ratings(ctx, c.ClipID, c.Version)
	if err != nil {
		return nil, err
	}
	both := len(ratings) >= 2
	v := &AdminView{Clip: c, RatingsSaved: len(ratings), BothSaved: both, Ratings: []RatingView{}, Proposals: []Proposal{}}
	for _, r := range ratings {
		at := r.SavedAt
		rv := RatingView{Rater: r.Rater, Saved: true, SavedAt: &at}
		if both || r.Rater == viewer.Pseudonym {
			rv.Marks = append([]RaterMark{}, r.Submission.Marks...)
		} else {
			rv.Rater, rv.SavedAt, rv.Hidden = "", nil, true
		}
		v.Ratings = append(v.Ratings, rv)
	}
	if both {
		v.Proposals = append(v.Proposals, c.Proposals...)
		v.Agreement = c.Agreement
	}
	return v, nil
}

// ---- Rate (API-55 POST …/ratings) -----------------------------------------------------------

// RateResult says whether this save completed the pair (W08 then resumes clip_finalize).
type RateResult struct {
	Rating    *Rating
	BothSaved bool
}

// Rate saves rater's blind marks for a clip awaiting ratings (status proposed). A rater may
// change their own marks until the second rater saves; a third rater is refused.
func (s *Service) Rate(ctx context.Context, rater Actor, clipID string, version int, marks []RaterMark) (*RateResult, error) {
	if err := requireActor(rater); err != nil {
		return nil, err
	}
	if len(marks) > 10 {
		return nil, &ValidationError{"/marks", "too_many"}
	}
	for i, m := range marks {
		ptr := fmt.Sprintf("/marks/%d", i)
		switch {
		case !validHazardType(m.HazardType):
			return nil, &ValidationError{ptr + "/hazardType", "invalid_enum"}
		case m.AMs < 0 || m.BMs <= 0 || m.AMs >= m.BMs:
			return nil, &ValidationError{ptr, "window_invalid"}
		case m.Cue != nil && utf8.RuneCountInString(*m.Cue) > 160:
			return nil, &ValidationError{ptr + "/cue", "too_long"}
		}
		if m.Cue != nil {
			if len(privacy.Detect(*m.Cue)) > 0 {
				return nil, &ValidationError{ptr + "/cue", "PROHIBITED_FIELD"}
			}
		}
	}
	c, err := s.Store.GetClip(ctx, clipID, version)
	if err != nil {
		return nil, err
	}
	if c.Status != StatusProposed {
		return nil, ErrWrongStatus
	}
	for _, m := range marks {
		if m.BMs > c.Doc.DurationMs {
			return nil, &ValidationError{"/marks", "window_after_clip_end"}
		}
	}
	existing, err := s.Store.Ratings(ctx, c.ClipID, c.Version)
	if err != nil {
		return nil, err
	}
	mine := false
	for _, r := range existing {
		if r.Rater == rater.Pseudonym {
			mine = true
		}
	}
	if len(existing) >= 2 {
		if mine {
			return nil, ErrRatingsFrozen
		}
		return nil, ErrTooManyRaters
	}
	now := s.now()
	if marks == nil {
		marks = []RaterMark{}
	}
	r := &Rating{ClipID: c.ClipID, Version: c.Version, Rater: rater.Pseudonym, SavedAt: now,
		Submission: RaterSubmission{Rater: rater.Pseudonym, ClipID: c.ClipID, Version: c.Version, Marks: marks, SubmittedAt: isoMillis(now)}}
	if err := s.Store.UpsertRating(ctx, r); err != nil {
		return nil, err
	}
	saved := len(existing)
	if !mine {
		saved++
	}
	return &RateResult{Rating: r, BothSaved: saved >= 2}, nil
}

// ---- Blur audit (API-55 POST …/blur-audit) --------------------------------------------------

// BlurAuditInput is one human audit of a rendition (NAZAR §5: 100% of frames).
type BlurAuditInput struct {
	RenditionSHA256 string
	FramesTotal     int
	FramesChecked   int
	Misses          int
	MissFrames      []BlurAuditMiss
}

// BlurAuditResult is the audit outcome.
type BlurAuditResult struct {
	Passed bool     `json:"passed"`
	Issues []string `json:"issues"`
}

// blurAuditIssues mirrors clip-pipeline blurAuditIssues, plus the Go check that framesTotal is
// the clip's full frame count at 30 fps.
func blurAuditIssues(a *BlurAudit, d *Doc) []string {
	issues := []string{}
	if !ValidPseudonym(a.Auditor) {
		issues = append(issues, "auditor must be a pseudonym")
	}
	if a.FramesTotal <= 0 {
		issues = append(issues, "framesTotal must be a positive integer")
	}
	if want := ExpectedFrameCount(d.DurationMs, DeliveryFPS); a.FramesTotal != want {
		issues = append(issues, fmt.Sprintf("framesTotal %d is not the clip's %d frames", a.FramesTotal, want))
	}
	if a.FramesChecked < a.FramesTotal {
		issues = append(issues, fmt.Sprintf("checked %d of %d frames (100%% required)", a.FramesChecked, a.FramesTotal))
	}
	if a.Misses != 0 {
		issues = append(issues, fmt.Sprintf("%d misses (0 required)", a.Misses))
	}
	if len(a.MissFrames) != a.Misses {
		issues = append(issues, "misses does not match missFrames")
	}
	if !mediaHasSHA(d, a.RenditionSHA256) {
		issues = append(issues, "audit was for different bytes than the current renditions")
	}
	return issues
}

func mediaHasSHA(d *Doc, sha string) bool {
	for _, m := range d.Media {
		if m.SHA256 == sha {
			return true
		}
	}
	return false
}

// SubmitBlurAudit records an audit. A passing audit (every frame, 0 misses, on the current
// bytes) sets the clip.json summary and moves blurred → audited; a failing one is recorded too
// and blocks publishing until a re-blur and a new audit.
func (s *Service) SubmitBlurAudit(ctx context.Context, auditor Actor, clipID string, version int, in BlurAuditInput) (*BlurAuditResult, error) {
	if err := requireActor(auditor); err != nil {
		return nil, err
	}
	if !sha256Re.MatchString(in.RenditionSHA256) {
		return nil, &ValidationError{"/rendition_sha256", "invalid"}
	}
	if in.FramesChecked < 0 || in.Misses < 0 {
		return nil, &ValidationError{"/frames_checked", "negative"}
	}
	// Malformed records are refused rather than stored as failing audits: the audit log
	// (content.clip_blur_audits) requires framesTotal > 0 and one missFrames entry per miss.
	if in.FramesTotal <= 0 {
		return nil, &ValidationError{"/frames_total", "invalid"}
	}
	if len(in.MissFrames) != in.Misses {
		return nil, &ValidationError{"/miss_frames", "count_mismatch"}
	}
	c, err := s.Store.GetClip(ctx, clipID, version)
	if err != nil {
		return nil, err
	}
	if c.Doc.IsAI() {
		return nil, ErrWrongStatus // ADR-0013: nothing real to blur (SubmitSyntheticReview instead)
	}
	switch c.Status {
	case StatusBlurred, StatusAudited, StatusProposed, StatusAdjudication, StatusRated:
	default:
		return nil, ErrWrongStatus
	}
	now := s.now()
	a := &BlurAudit{ClipID: c.ClipID, Version: c.Version, Auditor: auditor.Pseudonym, RenditionSHA256: in.RenditionSHA256,
		FramesTotal: in.FramesTotal, FramesChecked: in.FramesChecked, Misses: in.Misses, MissFrames: in.MissFrames, AuditedAt: now}
	if a.MissFrames == nil {
		a.MissFrames = []BlurAuditMiss{}
	}
	issues := blurAuditIssues(a, &c.Doc)
	if err := s.Store.InsertBlurAudit(ctx, a); err != nil {
		return nil, err
	}
	c.Doc.BlurAudit = &DocBlurAudit{Auditor: a.Auditor, FramesChecked: a.FramesChecked, Misses: a.Misses, AuditedAt: isoMillis(now)}
	passed := len(issues) == 0
	if passed {
		c.AuditPassedAt = &now
		if c.Status == StatusBlurred {
			c.Status, c.Doc.Status = StatusAudited, StatusAudited
		}
	} else {
		c.AuditPassedAt = nil
	}
	c.UpdatedAt = now
	if err := s.Store.UpdateClip(ctx, c); err != nil {
		return nil, err
	}
	return &BlurAuditResult{Passed: passed, Issues: issues}, nil
}

// blurAuditPasses is clip-pipeline clipBlurAuditPasses over the full record.
func blurAuditPasses(a *BlurAudit, d *Doc) bool { return a != nil && len(blurAuditIssues(a, d)) == 0 }

// ---- Cue texts ------------------------------------------------------------------------------

// SetCueTexts stores the curator's bilingual cue per final hazard. clip.json hazards need a cue
// in English and Hindi, which raters do not write, so final hazards enter clip.json once every
// hazard has one (publish checks this).
func (s *Service) SetCueTexts(ctx context.Context, curator Actor, clipID string, version int, cues map[string]CueText) (*Clip, error) {
	if err := requireActor(curator); err != nil {
		return nil, err
	}
	c, err := s.Store.GetClip(ctx, clipID, version)
	if err != nil {
		return nil, err
	}
	if c.Status != StatusRated {
		return nil, ErrWrongStatus
	}
	known := map[string]bool{}
	for _, h := range c.FinalHazards {
		known[h.HazardID] = true
	}
	for id, ct := range cues {
		if !known[id] {
			return nil, &ValidationError{"/cues/" + id, "unknown_hazard"}
		}
		for lang, txt := range map[string]string{"en": ct.En, "hi": ct.Hi} {
			if strings.TrimSpace(txt) == "" || utf8.RuneCountInString(txt) > 160 {
				return nil, &ValidationError{"/cues/" + id + "/" + lang, "length"}
			}
			if len(privacy.Detect(txt)) > 0 {
				return nil, &ValidationError{"/cues/" + id + "/" + lang, "PROHIBITED_FIELD"}
			}
		}
	}
	if c.CueTexts == nil {
		c.CueTexts = map[string]CueText{}
	}
	for id, ct := range cues {
		c.CueTexts[id] = ct
	}
	applyFinalHazards(c)
	c.UpdatedAt = s.now()
	if err := ValidateDocStruct(&c.Doc); err != nil {
		return nil, err
	}
	return c, s.Store.UpdateClip(ctx, c)
}

func roundInt(f float64) int { return int(math.Round(f)) }

// applyFinalHazards writes the final hazards into clip.json when every one has a cue text.
func applyFinalHazards(c *Clip) {
	hs := make([]DocHazard, 0, len(c.FinalHazards))
	for _, h := range c.FinalHazards {
		ct, ok := c.CueTexts[h.HazardID]
		if !ok {
			c.Doc.Hazards = []DocHazard{}
			return
		}
		rc := h.RaterCount
		if rc < 2 {
			rc = 2
		}
		if rc > 3 {
			rc = 3
		}
		hs = append(hs, DocHazard{HazardID: h.HazardID, HazardType: h.HazardType,
			Window:     Window{AMs: roundInt(h.Window.AMs), BMs: roundInt(h.Window.BMs)},
			RaterCount: rc, DeltaOnsetMs: roundInt(h.DeltaOnsetMs), DeltaEndMs: roundInt(h.DeltaEndMs),
			Adjudicated: h.Adjudicated, Occlusion: h.Occlusion, CueText: ct})
	}
	c.Doc.Hazards = hs
}

// ---- Adjudication (API-55 POST …/adjudication) ----------------------------------------------

// AdjudicationDecision is the ruling on one agreement cluster.
type AdjudicationDecision struct {
	ClusterID string     `json:"clusterId"`
	Verdict   string     `json:"verdict"` // hazard | not_hazard
	Mark      *RaterMark `json:"mark,omitempty"`
}

// AdjudicationInput is the adjudicator's input; the service adds adjudicator and decidedAt.
type AdjudicationInput struct {
	ReasonCode string                 `json:"reasonCode"`
	Decisions  []AdjudicationDecision `json:"decisions"`
}

// Adjudicate records a third person's ruling on a clip in status adjudication. The agreement is
// recomputed from the two ratings by the compute service; when the ruling resolves every
// cluster, the clip moves to rated with the adjudicated final windows.
func (s *Service) Adjudicate(ctx context.Context, adjudicator Actor, clipID string, version int, in AdjudicationInput) (*Adjudication, error) {
	if err := requireActor(adjudicator); err != nil {
		return nil, err
	}
	c, err := s.Store.GetClip(ctx, clipID, version)
	if err != nil {
		return nil, err
	}
	if c.Status != StatusAdjudication {
		return nil, ErrWrongStatus
	}
	ratings, err := s.Store.Ratings(ctx, c.ClipID, c.Version)
	if err != nil {
		return nil, err
	}
	if len(ratings) != 2 {
		return nil, ErrWrongStatus
	}
	for _, r := range ratings {
		if r.Rater == adjudicator.Pseudonym {
			return nil, ErrAdjudicatorIsRater
		}
	}
	now := s.now()
	if in.Decisions == nil {
		in.Decisions = []AdjudicationDecision{}
	}
	input, err := json.Marshal(struct {
		Adjudicator string `json:"adjudicator"`
		DecidedAt   string `json:"decidedAt"`
		AdjudicationInput
	}{adjudicator.Pseudonym, isoMillis(now), in})
	if err != nil {
		return nil, err
	}
	dur := c.Doc.DurationMs
	resp, err := s.Compute.Agreement(ctx, AgreementRequest{Op: "adjudicate", Now: now.UnixMilli(),
		RaterA: &ratings[0].Submission, RaterB: &ratings[1].Submission, DurationMs: &dur,
		Proposals: c.Proposals, Adjudication: input})
	if err != nil {
		return nil, err
	}
	if resp.Adjudication == nil || resp.Agreement == nil {
		return nil, errors.New("clips: /clip/agreement adjudicate returned no adjudication")
	}
	adj := &Adjudication{Adjudicator: adjudicator.Pseudonym, Input: input, Resolved: resp.Adjudication.Resolved,
		Hazards: resp.Adjudication.Hazards, Dropped: resp.Adjudication.Dropped, Issues: resp.Adjudication.Issues, At: now}
	c.Adjudication = adj
	c.Agreement = resp.Raw
	if adj.Resolved {
		c.FinalHazards = adj.Hazards
		c.Status, c.Doc.Status = StatusRated, StatusRated
		applyFinalHazards(c)
	}
	c.UpdatedAt = now
	if err := s.Store.UpdateClip(ctx, c); err != nil {
		return nil, err
	}
	return adj, nil
}

// ---- Publish (API-55 POST …/publish) --------------------------------------------------------

// publishViolations lists every unmet publish precondition: two saved ratings, agreement or a
// resolved adjudication, a 100% blur audit with 0 misses on the current bytes (filmed) or a
// passing synthetic review (ai_generated), cue texts for
// every final hazard, both renditions, 20–60 s, a speed estimate and a curator difficulty.
func publishViolations(c *Clip, ratings []*Rating, audit *BlurAudit) []Violation {
	var v []Violation
	add := func(code, msg string) { v = append(v, Violation{Code: code, Message: msg}) }
	if c.Status != StatusRated && c.Status != StatusPublished {
		add("status", fmt.Sprintf("status %s cannot publish (needs rated)", c.Status))
	}
	if len(ratings) != 2 {
		add("ratings", fmt.Sprintf("publish needs two independent ratings (have %d)", len(ratings)))
	}
	if !c.AgreementAccepted && (c.Adjudication == nil || !c.Adjudication.Resolved) {
		add("agreement", "publish needs an accepted agreement or a resolved adjudication")
	}
	switch {
	case c.Doc.IsAI():
		// ADR-0013: nothing real to blur; the curator's synthetic-content review replaces the audit.
		if !syntheticReviewPasses(c) {
			add("synthetic_review", "publish needs a passing curator synthetic review (no real-person likeness, no readable plates, no real brands, no collision or injury, hazard visible)")
		}
	case audit == nil:
		add("blur_audit", "publish needs a human blur audit of 100% of frames")
	case !blurAuditPasses(audit, &c.Doc):
		add("blur_audit", fmt.Sprintf("publish needs all %d frames audited with 0 misses (got %d frames, %d misses)",
			ExpectedFrameCount(c.Doc.DurationMs, DeliveryFPS), audit.FramesChecked, audit.Misses))
	}
	if len(c.FinalHazards) != len(c.Doc.Hazards) {
		add("cue_text", "every final hazard needs an English and a Hindi cue text")
	}
	for _, r := range Renditions {
		if _, ok := c.Doc.MediaFor(r); !ok {
			add("missing_rendition", "no "+r+" rendition")
		}
	}
	if c.Doc.DurationMs < PublishMinMs || c.Doc.DurationMs > PublishMaxMs {
		add("duration", fmt.Sprintf("published clips are 20–60 s (got %d ms)", c.Doc.DurationMs))
	}
	if c.Doc.SpeedKmhEst == nil {
		add("speed", "publish needs a speed estimate (late seconds become metres with it)")
	}
	if c.Doc.Difficulty.Curator == nil {
		add("curator_difficulty", "publish needs a curator difficulty (NAZAR §7.1)")
	}
	return v
}

// Publish publishes a rated clip once every precondition holds (AI never auto-publishes). It is
// idempotent for a clip that is already published. The manifests are rebuilt afterwards when the
// compute service answers; otherwise the next clip_finalize run or nightly job rebuilds them.
func (s *Service) Publish(ctx context.Context, curator Actor, clipID string, version int) (*Clip, error) {
	if err := requireActor(curator); err != nil {
		return nil, err
	}
	c, err := s.publish(ctx, clipID, version)
	if err != nil {
		return nil, err
	}
	if s.Compute != nil {
		if _, err := s.RebuildManifest(ctx); err != nil {
			s.log().WarnContext(ctx, "manifest rebuild after publish failed", "clip", c.Ref(), "err", err)
		}
	}
	return c, nil
}

func (s *Service) publish(ctx context.Context, clipID string, version int) (*Clip, error) {
	c, err := s.Store.GetClip(ctx, clipID, version)
	if err != nil {
		return nil, err
	}
	if c.Status == StatusPublished {
		return c, nil
	}
	ratings, err := s.Store.Ratings(ctx, c.ClipID, c.Version)
	if err != nil {
		return nil, err
	}
	audit, err := s.Store.LatestBlurAudit(ctx, c.ClipID, c.Version)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if v := publishViolations(c, ratings, audit); len(v) > 0 {
		return nil, &PublishBlockedError{Violations: v}
	}
	if _, err := checkPath(c.Doc.Origin, c.Status, StatusPublished); err != nil {
		return nil, err
	}
	next := *c
	next.Doc.Status = StatusPublished
	if err := ValidateDocStruct(&next.Doc); err != nil {
		return nil, err
	}
	now := s.now()
	c.Status, c.Doc.Status, c.PublishedAt, c.UpdatedAt = StatusPublished, StatusPublished, &now, now
	return c, s.Store.UpdateClip(ctx, c)
}
