package httpapi

// API-55 clip admin (curator board, register, blind ratings, blur audit, adjudication, cue
// texts, publish) and the W08 internal endpoints (review tasks, review outcomes). Every admin
// actor is the session's clip pseudonym (s.adminActor), never a body field. The clip package
// decides; this file maps the wire (snake_case, api/openapi.yaml) to it and back.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// clipsResumeURLField binds the vault ciphertext of a W08 resume URL to its column.
const clipsResumeURLField = "content.clip_review_tasks.resume_url"

// ---- Wire shapes (api/openapi.yaml Clip, ClipRating, ClipReviewTask) -------------------------

type clipsMarkOut struct {
	HazardType string  `json:"hazard_type"`
	AMs        int     `json:"a_ms"`
	BMs        int     `json:"b_ms"`
	Cue        *string `json:"cue,omitempty"`
	Occlusion  *bool   `json:"occlusion,omitempty"`
}

type clipsRatingOut struct {
	RatingID    string         `json:"rating_id"`
	ClipID      string         `json:"clip_id"`
	Version     int            `json:"version"`
	Rater       string         `json:"rater"`
	Decision    string         `json:"decision"`
	Marks       []clipsMarkOut `json:"marks"`
	SubmittedAt time.Time      `json:"submitted_at"`
}

type clipsCueOut struct {
	En string `json:"en"`
	Hi string `json:"hi"`
}

type clipsHazardOut struct {
	HazardID     string       `json:"hazard_id"`
	HazardType   string       `json:"hazard_type"`
	AMs          int          `json:"a_ms"`
	BMs          int          `json:"b_ms"`
	RaterCount   int          `json:"rater_count"`
	DeltaOnsetMs int          `json:"delta_onset_ms"`
	DeltaEndMs   int          `json:"delta_end_ms"`
	Adjudicated  bool         `json:"adjudicated"`
	Occlusion    bool         `json:"occlusion"`
	CueText      *clipsCueOut `json:"cue_text"`
}

type clipsBlurAuditOut struct {
	Auditor         string    `json:"auditor"`
	RenditionSHA256 string    `json:"rendition_sha256"`
	FramesTotal     int       `json:"frames_total"`
	FramesChecked   int       `json:"frames_checked"`
	Misses          int       `json:"misses"`
	AuditedAt       time.Time `json:"audited_at"`
	Passed          bool      `json:"passed"`
}

type clipsProposalOut struct {
	HazardType string `json:"hazard_type"`
	AMs        int    `json:"a_ms"`
	BMs        int    `json:"b_ms"`
	Why        string `json:"why,omitempty"`
}

type clipsAdjudicationOut struct {
	Adjudicator string    `json:"adjudicator"`
	DecidedAt   time.Time `json:"decided_at"`
	ReasonCode  string    `json:"reason_code,omitempty"`
	Resolved    bool      `json:"resolved"`
	Dropped     []string  `json:"dropped"`
	Issues      []string  `json:"issues"`
}

type clipsTaskOut struct {
	ReviewTaskID string    `json:"review_task_id"`
	ClipID       string    `json:"clip_id"`
	Version      int       `json:"version"`
	Stage        string    `json:"stage"`
	Status       string    `json:"status"`
	Assignee     *string   `json:"assignee"`
	DueAt        time.Time `json:"due_at"`
	CreatedAt    time.Time `json:"created_at"`
}

type clipsDifficultyOut struct {
	Curator   *int     `json:"curator"`
	Empirical *float64 `json:"empirical"`
	IRT       *float64 `json:"irt"`
	NTakers   int      `json:"n_takers"`
}

type clipsMediaOut struct {
	Res    string `json:"res"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type clipsQuietOut struct {
	FromMs int `json:"from_ms"`
	ToMs   int `json:"to_ms"`
}

type clipsFlashOut struct {
	Passed bool `json:"passed"`
}

// clipsChecksOut is ClipSyntheticChecks (the web's check IDs).
type clipsChecksOut struct {
	NoRealLikeness      bool `json:"no_real_likeness"`
	NoReadablePlates    bool `json:"no_readable_plates"`
	NoRealBrands        bool `json:"no_real_brands"`
	NoCollisionOrInjury bool `json:"no_collision_or_injury"`
	HazardVisible       bool `json:"hazard_visible"`
}

// clipsSyntheticOut is ClipSyntheticReview (AI clips; replaces the blur audit).
type clipsSyntheticOut struct {
	Reviewer   string         `json:"reviewer"`
	ReviewedAt time.Time      `json:"reviewed_at"`
	Checks     clipsChecksOut `json:"checks"`
	Passed     bool           `json:"passed"`
	Note       string         `json:"note,omitempty"`
}

// clipsOut is the E-20 admin view. Fields the viewer may not see are omitted.
type clipsOut struct {
	ClipID                string                `json:"clip_id"`
	Version               int                   `json:"version"`
	ItemRef               string                `json:"item_ref"`
	Status                string                `json:"status"`
	Origin                string                `json:"origin"`
	SceneID               string                `json:"scene_id,omitempty"`
	BatchID               string                `json:"batch_id,omitempty"`
	SyntheticReview       *clipsSyntheticOut    `json:"synthetic_review,omitempty"`
	OnsetHint             json.RawMessage       `json:"onset_hint,omitempty"`
	TenantTags            []string              `json:"tenant_tags,omitempty"`
	City                  string                `json:"city,omitempty"`
	RoadType              string                `json:"road_type,omitempty"`
	TimeOfDay             string                `json:"time_of_day,omitempty"`
	Weather               string                `json:"weather,omitempty"`
	POV                   string                `json:"pov,omitempty"`
	CapturedMonth         string                `json:"captured_month,omitempty"`
	SpeedKmhEst           *float64              `json:"speed_kmh_est"`
	SpeedSource           string                `json:"speed_source,omitempty"`
	DurationMs            int                   `json:"duration_ms,omitempty"`
	Modules               []string              `json:"modules,omitempty"`
	Licence               string                `json:"licence,omitempty"`
	Attribution           string                `json:"attribution,omitempty"`
	Difficulty            clipsDifficultyOut    `json:"difficulty"`
	Media                 []clipsMediaOut       `json:"media,omitempty"`
	MediaURL              string                `json:"media_url,omitempty"`
	FlashCheck            *clipsFlashOut        `json:"flash_check"`
	MockEligible          bool                  `json:"mock_eligible"`
	MockIneligibleReasons []string              `json:"mock_ineligible_reasons,omitempty"`
	Hazards               []clipsHazardOut      `json:"hazards,omitempty"`
	QuietSegments         []clipsQuietOut       `json:"quiet_segments,omitempty"`
	BlurAudit             *clipsBlurAuditOut    `json:"blur_audit"`
	ProposalsVisible      bool                  `json:"proposals_visible"`
	Proposals             []clipsProposalOut    `json:"proposals,omitempty"`
	RatingsVisible        bool                  `json:"ratings_visible"`
	RatingCount           int                   `json:"rating_count"`
	MyRating              *clipsRatingOut       `json:"my_rating,omitempty"`
	Ratings               []clipsRatingOut      `json:"ratings,omitempty"`
	Agreement             json.RawMessage       `json:"agreement,omitempty"`
	Adjudication          *clipsAdjudicationOut `json:"adjudication,omitempty"`
	ReviewTasks           []clipsTaskOut        `json:"review_tasks,omitempty"`
	WorkflowRuns          []gen.JobRun          `json:"workflow_runs,omitempty"`
	RawDeletedAt          *time.Time            `json:"raw_deleted_at"`
}

// ---- Helpers -------------------------------------------------------------------------------

func (s *Server) clipsService(w http.ResponseWriter, r *http.Request) (*clips.Service, bool) {
	if s.deps.Clips == nil {
		serviceMissing(w, r)
		return nil, false
	}
	return s.deps.Clips, true
}

var clipsCamelRe = regexp.MustCompile(`([a-z0-9])([A-Z])`)

// clipsSnakeKey turns a clip-pipeline camelCase key into the API's snake_case.
func clipsSnakeKey(k string) string {
	switch k {
	case "meanIoU":
		return "mean_iou"
	case "minIoU":
		return "min_iou"
	}
	return strings.ToLower(clipsCamelRe.ReplaceAllString(k, "${1}_${2}"))
}

// clipsSnakePointer maps a package pointer (/marks/0/hazardType) to the wire (/marks/0/hazard_type).
func clipsSnakePointer(p string) string {
	parts := strings.Split(p, "/")
	for i, x := range parts {
		parts[i] = clipsSnakeKey(x)
	}
	return strings.Join(parts, "/")
}

// clipsSnake converts a compute-service JSON value to snake_case keys; a `window: {aMs, bMs}`
// (final hazards) is flattened to a_ms / b_ms as the spec's ClipAgreement has it.
func clipsSnake(v any) any {
	switch x := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, val := range x {
			if w, ok := val.(map[string]any); ok && k == "window" {
				out["a_ms"], out["b_ms"] = w["aMs"], w["bMs"]
				continue
			}
			out[clipsSnakeKey(k)] = clipsSnake(val)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = clipsSnake(e)
		}
		return out
	default:
		return v
	}
}

func clipsSnakeJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return nil
	}
	out, err := json.Marshal(clipsSnake(v))
	if err != nil {
		return nil
	}
	return out
}

func clipsMarksOut(ms []clips.RaterMark) []clipsMarkOut {
	out := make([]clipsMarkOut, 0, len(ms))
	for _, m := range ms {
		out = append(out, clipsMarkOut{HazardType: m.HazardType, AMs: m.AMs, BMs: m.BMs, Cue: m.Cue, Occlusion: m.Occlusion})
	}
	return out
}

func clipsMarksIn(ms []gen.ClipMark) []clips.RaterMark {
	out := make([]clips.RaterMark, 0, len(ms))
	for _, m := range ms {
		out = append(out, clips.RaterMark{HazardType: string(m.HazardType), AMs: m.AMs, BMs: m.BMs, Cue: m.Cue, Occlusion: m.Occlusion})
	}
	return out
}

// clipsRatingID is the stable wire ID of a rating (one per rater per clip version).
func clipsRatingID(clipID string, version int, rater string) string {
	return ids.Encode(ids.Rating, ids.Deterministic(fmt.Sprintf("clip-rating:%s@%d:%s", clipID, version, rater)))
}

func clipsDecision(decisions map[string]string, rater string) string {
	if d := decisions[rater]; d != "" {
		return d
	}
	return clips.DecisionWindowsSet
}

func clipsTaskWire(t *clips.ReviewTask) clipsTaskOut {
	out := clipsTaskOut{ReviewTaskID: ids.Encode(ids.ReviewTask, t.ID), ClipID: t.ClipID, Version: t.Version, Stage: t.Stage,
		Status: t.Status, DueAt: t.DueAt, CreatedAt: t.CreatedAt}
	if t.Assignee != "" {
		a := t.Assignee
		out.Assignee = &a
	}
	return out
}

func clipsRound(f float64) int {
	if f < 0 {
		return int(f - 0.5)
	}
	return int(f + 0.5)
}

func clipsClampRaters(n int) int {
	return min(max(n, 2), 3)
}

// clipsIsRater reports whether a pseudonym is a rater (rater-07); every other admin pseudonym
// (curator-01) has the curator view of the board.
func clipsIsRater(a clips.Actor) bool { return strings.HasPrefix(a.Pseudonym, "rater-") }

var clipsJobStatus = map[string]gen.JobRunStatus{"started": gen.JobRunStatusStarted, "running": gen.JobRunStatusRunning,
	"succeeded": gen.JobRunStatusSucceeded, "failed": gen.JobRunStatusFailed, "cancelled": gen.JobRunStatusCancelled}

// clipsView builds the admin view of c for viewer. Blindness follows clips.Service.View: until
// both ratings are saved a viewer sees only their own rating, no proposals and no agreement.
func (s *Server) clipsView(ctx context.Context, svc *clips.Service, viewer clips.Actor, c *clips.Clip) (*clipsOut, error) {
	v, err := svc.View(ctx, viewer, c.ClipID, c.Version)
	if err != nil {
		return nil, err
	}
	d := &c.Doc
	out := &clipsOut{ClipID: c.ClipID, Version: c.Version, ItemRef: "clip:" + c.Ref(), Status: string(c.Status), Origin: d.OriginOrDefault(),
		TenantTags: d.TenantTags, City: d.City, RoadType: d.RoadType, TimeOfDay: d.TimeOfDay, Weather: d.Weather, POV: d.POV,
		CapturedMonth: d.CapturedMonth, SpeedKmhEst: d.SpeedKmhEst, SpeedSource: d.SpeedSource, DurationMs: d.DurationMs,
		Modules: d.Modules, Licence: d.Licence, Attribution: d.Attribution,
		Difficulty:   clipsDifficultyOut{Curator: d.Difficulty.Curator, Empirical: d.Difficulty.Empirical, IRT: d.Difficulty.IRT, NTakers: d.Difficulty.NTakers},
		MockEligible: c.MockEligible, MockIneligibleReasons: c.MockReasons, RawDeletedAt: c.RawDeletedAt,
		RatingsVisible: v.BothSaved, ProposalsVisible: v.BothSaved, RatingCount: v.RatingsSaved}
	if c.FlashPassed != nil {
		out.FlashCheck = &clipsFlashOut{Passed: *c.FlashPassed}
	}
	if g := d.Generation; g != nil {
		out.SceneID, out.BatchID = g.SceneID, g.SeedOrBatchID
	}
	if len(c.OnsetHint) > 0 {
		out.OnsetHint = clipsSnakeJSON(c.OnsetHint) // admin view only (raters' first look; never authoritative)
	}
	if sr := c.SyntheticReview; sr != nil {
		out.SyntheticReview = &clipsSyntheticOut{Reviewer: sr.Reviewer, ReviewedAt: sr.ReviewedAt.UTC(), Passed: sr.Passed, Note: sr.Note,
			Checks: clipsChecksOut{NoRealLikeness: sr.Checks.NoRealPersonLikeness, NoReadablePlates: sr.Checks.NoReadablePlates,
				NoRealBrands: sr.Checks.NoRealBrands, NoCollisionOrInjury: sr.Checks.NoCollisionOrInjury, HazardVisible: sr.Checks.HazardVisible}}
	}
	for _, m := range d.Media {
		out.Media = append(out.Media, clipsMediaOut{Res: m.Res, Bytes: m.Bytes, SHA256: m.SHA256})
	}
	if c.Status != clips.StatusRaw && c.Status != clips.StatusTranscoded && c.RawDeletedAt == nil || c.Status == clips.StatusPublished {
		for _, res := range []string{"480p", "360p"} {
			if _, ok := d.MediaFor(res); ok {
				u, err := svc.MediaURL(ctx, c.ClipID, c.Version, res)
				if err != nil {
					return nil, err
				}
				if strings.Contains(u, "://") {
					out.MediaURL = u
				}
				break
			}
		}
	}
	for _, q := range d.QuietSegments {
		out.QuietSegments = append(out.QuietSegments, clipsQuietOut{FromMs: q.FromMs, ToMs: q.ToMs})
	}
	for _, h := range c.FinalHazards {
		ho := clipsHazardOut{HazardID: h.HazardID, HazardType: h.HazardType, AMs: clipsRound(h.Window.AMs), BMs: clipsRound(h.Window.BMs),
			RaterCount: clipsClampRaters(h.RaterCount), DeltaOnsetMs: clipsRound(h.DeltaOnsetMs), DeltaEndMs: clipsRound(h.DeltaEndMs),
			Adjudicated: h.Adjudicated, Occlusion: h.Occlusion}
		if ct, ok := c.CueTexts[h.HazardID]; ok {
			ho.CueText = &clipsCueOut{En: ct.En, Hi: ct.Hi}
		}
		out.Hazards = append(out.Hazards, ho)
	}
	audit, err := svc.Store.LatestBlurAudit(ctx, c.ClipID, c.Version)
	switch {
	case err == nil:
		out.BlurAudit = &clipsBlurAuditOut{Auditor: audit.Auditor, RenditionSHA256: audit.RenditionSHA256, FramesTotal: audit.FramesTotal,
			FramesChecked: audit.FramesChecked, Misses: audit.Misses, AuditedAt: audit.AuditedAt, Passed: clips.BlurAuditPassed(audit, d)}
	case !errors.Is(err, clips.ErrNotFound):
		return nil, err
	}
	decisions, err := svc.RatingDecisions(ctx, c.ClipID, c.Version)
	if err != nil {
		return nil, err
	}
	for _, rv := range v.Ratings {
		if rv.Hidden || rv.SavedAt == nil {
			continue
		}
		ro := clipsRatingOut{RatingID: clipsRatingID(c.ClipID, c.Version, rv.Rater), ClipID: c.ClipID, Version: c.Version, Rater: rv.Rater,
			Decision: clipsDecision(decisions, rv.Rater), Marks: clipsMarksOut(rv.Marks), SubmittedAt: rv.SavedAt.UTC()}
		if rv.Rater == viewer.Pseudonym {
			mine := ro
			out.MyRating = &mine
		}
		if v.BothSaved {
			out.Ratings = append(out.Ratings, ro)
		}
	}
	if v.BothSaved {
		out.Proposals = []clipsProposalOut{}
		for _, p := range v.Proposals {
			out.Proposals = append(out.Proposals, clipsProposalOut{HazardType: p.HazardType, AMs: p.AMs, BMs: p.BMs, Why: p.Why})
		}
		out.Agreement = clipsSnakeJSON(v.Agreement)
	}
	if a := c.Adjudication; a != nil {
		ao := &clipsAdjudicationOut{Adjudicator: a.Adjudicator, DecidedAt: a.At, Resolved: a.Resolved, Dropped: a.Dropped, Issues: a.Issues}
		var in struct {
			ReasonCode string `json:"reasonCode"`
		}
		if json.Unmarshal(a.Input, &in) == nil {
			ao.ReasonCode = in.ReasonCode
		}
		if ao.Dropped == nil {
			ao.Dropped = []string{}
		}
		if ao.Issues == nil {
			ao.Issues = []string{}
		}
		out.Adjudication = ao
	}
	tasks, err := svc.ReviewTasks(ctx, c.ClipID, c.Version)
	if err != nil && !errors.Is(err, clips.ErrReviewTasksUnsupported) {
		return nil, err
	}
	for _, t := range tasks {
		// While blind, another rater's task would name who rated first.
		if !v.BothSaved && t.Assignee != "" && t.Assignee != viewer.Pseudonym {
			continue
		}
		out.ReviewTasks = append(out.ReviewTasks, clipsTaskWire(t))
	}
	runs, err := store.ClipJobRuns(ctx, s.deps.DB, c.WorkflowRuns)
	if err != nil {
		return nil, err
	}
	for _, run := range runs {
		st, ok := clipsJobStatus[run.Status]
		if !ok {
			st = gen.JobRunStatusRunning
		}
		out.WorkflowRuns = append(out.WorkflowRuns, gen.JobRun{Job: gen.JobRunJob(run.Job), RunId: run.RunID, Runner: gen.JobRunRunner(run.Runner), Status: st})
	}
	return out, nil
}

func (s *Server) clipsWriteView(w http.ResponseWriter, r *http.Request, svc *clips.Service, viewer clips.Actor, c *clips.Clip, status int) {
	out, err := s.clipsView(r.Context(), svc, viewer, c)
	if err != nil {
		s.clipsError(w, r, err)
		return
	}
	writeJSON(w, status, out)
}

// clipsCurrent loads the clip's current version. A body version that is not the current one
// is 409 CLIP_INVALID_TRANSITION (operations act on the current version only).
func (s *Server) clipsCurrent(w http.ResponseWriter, r *http.Request, svc *clips.Service, clipID string, version int) (*clips.Clip, bool) {
	c, err := svc.Store.GetClip(r.Context(), clipID, 0)
	if err != nil {
		s.clipsError(w, r, err)
		return nil, false
	}
	if version != 0 && version != c.Version {
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "CLIP_INVALID_TRANSITION",
			Detail: fmt.Sprintf("version %d is not the clip's current version", version),
			Errors: []FieldError{{Pointer: "/version", Code: "not_current"}}})
		return nil, false
	}
	return c, true
}

var clipsViolationPointer = map[string]string{"status": "/status", "ratings": "/rating_count", "agreement": "/agreement",
	"blur_audit": "/blur_audit", "cue_text": "/hazards", "missing_rendition": "/media", "duration": "/duration_ms",
	"speed": "/speed_kmh_est", "curator_difficulty": "/difficulty/curator"}

// clipsPublishCheckID maps the service's violation codes to the curator UI's publish check IDs
// (apps/web features/curator Publish.tsx: status, two_ratings, agreement, blur_audit,
// synthetic_review, flash_check, cue_texts, duration, speed, difficulty, licence). Codes without
// a UI check (a missing rendition) pass through unchanged.
var clipsPublishCheckID = map[string]string{"ratings": "two_ratings", "cue_text": "cue_texts", "curator_difficulty": "difficulty"}

// clipsPublishBlocked answers a refused publish: 409 CLIP_INVALID_TRANSITION (the spec's and the
// web's contract) whose detail is the comma-separated list of failing check IDs, plus one field
// error per unmet precondition. New violation codes need no handler change.
func clipsPublishBlocked(w http.ResponseWriter, r *http.Request, pb *clips.PublishBlockedError) {
	p := Problem{Status: http.StatusConflict, Code: "CLIP_INVALID_TRANSITION"}
	ids := make([]string, 0, len(pb.Violations))
	for _, v := range pb.Violations {
		ptr := clipsViolationPointer[v.Code]
		if ptr == "" {
			ptr = "/" + clipsSnakeKey(v.Code)
		}
		id := v.Code
		if m, ok := clipsPublishCheckID[v.Code]; ok {
			id = m
		}
		p.Errors = append(p.Errors, FieldError{Pointer: ptr, Code: id})
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	p.Detail = strings.Join(ids, ",")
	writeProblem(w, r, p)
}

// clipsError maps clip-service errors to problem+json; internal error text never leaks.
func (s *Server) clipsError(w http.ResponseWriter, r *http.Request, err error) {
	var ve *clips.ValidationError
	var de *clips.DocError
	var pb *clips.PublishBlockedError
	var te *clips.TransitionError
	switch {
	case errors.As(err, &ve):
		ptr := clipsSnakePointer(ve.Pointer)
		if ve.Code == "PROHIBITED_FIELD" {
			writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED",
				Detail: "Cues never name a person, phone, vehicle number or exact place.",
				Errors: []FieldError{{Pointer: ptr, Code: "PROHIBITED_FIELD", MessageKey: "errors.prohibited_field"}}})
			return
		}
		validation(w, r, ptr, ve.Code)
	case errors.As(err, &de):
		ptr := ""
		if len(de.Issues) > 0 {
			if f := strings.Fields(strings.TrimPrefix(de.Issues[0], "schema at ")); len(f) > 0 && strings.HasPrefix(f[0], "/") {
				ptr = clipsSnakePointer(f[0])
			}
		}
		validation(w, r, ptr, "clip_document_invalid")
	case errors.As(err, &pb):
		clipsPublishBlocked(w, r, pb)
	case errors.Is(err, clips.ErrNotFound):
		notFound(w, r)
	case errors.Is(err, clips.ErrWrongStatus), errors.As(err, &te):
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "CLIP_INVALID_TRANSITION", Detail: "not possible in this clip's status"})
	case errors.Is(err, clips.ErrAlreadyRated), errors.Is(err, clips.ErrRatingsFrozen):
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "RATING_ALREADY_SUBMITTED", Detail: "you have already rated this clip version"})
	case errors.Is(err, clips.ErrTooManyRaters):
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "RATING_ALREADY_SUBMITTED", Detail: "two ratings are already stored; disagreements go to adjudication"})
	case errors.Is(err, clips.ErrAdjudicatorIsRater):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "ADJUDICATOR_IS_RATER", Detail: "the adjudicator must not be one of the two raters"})
	case errors.Is(err, clips.ErrConsentRequired):
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "CONSENT_REQUIRED",
			Detail: "the contributor has no active clip_contribution consent",
			Errors: []FieldError{{Pointer: "/contributor_consent_id", Code: "consent_required"}}})
	case errors.Is(err, clips.ErrInvalidActor):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "FORBIDDEN", Detail: "this admin session has no clip pseudonym"})
	case errors.Is(err, clips.ErrUnknownReviewTask):
		validation(w, r, "/review_task_id", "unknown_or_closed")
	case errors.Is(err, clips.ErrReviewTasksUnsupported), errors.Is(err, clips.ErrScenesUnavailable), errors.Is(err, clips.ErrNoJobRunner):
		serviceMissing(w, r)
	case clips.IsUnavailable(err), ports.IsComputeUnavailable(err):
		computeUnavailable(w, r)
	case errors.Is(err, ports.ErrComputeInvalid):
		validation(w, r, "/decisions", "rejected_by_compute")
	default:
		s.deps.Log.ErrorContext(r.Context(), "clip admin error", "err", err)
		internalError(w, r)
	}
}

// clipsConsentUUID converts the wire consent ID (cns_<ULID>, or a bare UUID) to the UUID string
// content.clips stores.
func clipsConsentUUID(id string) (string, bool) {
	if u, err := ids.Decode(ids.Consent, id); err == nil {
		return u.String(), true
	}
	if u, err := uuid.Parse(id); err == nil {
		return u.String(), true
	}
	return "", false
}

// ---- API-55 admin --------------------------------------------------------------------------

// ListClipsAdmin is GET /v1/admin/clips: curators see every clip; a rater sees the clips that
// await ratings (proposed) and those with a review task or a rating of theirs. Newest first.
func (s *Server) ListClipsAdmin(w http.ResponseWriter, r *http.Request, params gen.ListClipsAdminParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	viewer, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	f := clips.ListFilter{}
	if params.Status != nil {
		st, ok := clips.ParseStatus(string(*params.Status))
		if !ok {
			validation(w, r, "/status", "invalid_enum")
			return
		}
		f.Status = []clips.Status{st}
	}
	if params.State != nil {
		f.Tenant = *params.State
	}
	limit := 20
	if params.Limit != nil {
		if *params.Limit < 1 || *params.Limit > 100 {
			validation(w, r, "/limit", "out_of_range")
			return
		}
		limit = *params.Limit
	}
	offset := 0
	if params.Cursor != nil && *params.Cursor != "" {
		n, err := strconv.Atoi(strings.TrimPrefix(*params.Cursor, "o"))
		if err != nil || n < 0 || !strings.HasPrefix(*params.Cursor, "o") {
			validation(w, r, "/cursor", "invalid")
			return
		}
		offset = n
	}
	all, err := svc.List(r.Context(), f)
	if err != nil {
		s.clipsError(w, r, err)
		return
	}
	if clipsIsRater(viewer) {
		mine := all[:0:0]
		for _, c := range all {
			keep := c.Status == clips.StatusProposed
			if !keep {
				ratings, err := svc.Store.Ratings(r.Context(), c.ClipID, c.Version)
				if err != nil {
					s.clipsError(w, r, err)
					return
				}
				for _, rt := range ratings {
					keep = keep || rt.Rater == viewer.Pseudonym
				}
				tasks, err := svc.ReviewTasks(r.Context(), c.ClipID, c.Version)
				if err != nil && !errors.Is(err, clips.ErrReviewTasksUnsupported) {
					s.clipsError(w, r, err)
					return
				}
				for _, t := range tasks {
					keep = keep || t.Assignee == viewer.Pseudonym
				}
			}
			if keep {
				mine = append(mine, c)
			}
		}
		all = mine
	}
	sort.SliceStable(all, func(i, j int) bool {
		a, b := all[i], all[j]
		if !a.RegisteredAt.Equal(b.RegisteredAt) {
			return a.RegisteredAt.After(b.RegisteredAt)
		}
		if a.ClipID != b.ClipID {
			return a.ClipID > b.ClipID
		}
		return a.Version > b.Version
	})
	page := struct {
		Items      []*clipsOut `json:"items"`
		NextCursor *string     `json:"next_cursor"`
	}{Items: []*clipsOut{}}
	for i := offset; i < len(all) && len(page.Items) < limit; i++ {
		v, err := s.clipsView(r.Context(), svc, viewer, all[i])
		if err != nil {
			s.clipsError(w, r, err)
			return
		}
		page.Items = append(page.Items, v)
	}
	if next := offset + limit; next < len(all) {
		c := "o" + strconv.Itoa(next)
		page.NextCursor = &c
	}
	writeJSON(w, http.StatusOK, page)
}

// clipsRegisterIn is ClipRegister plus duration_ms: clip.json requires durationMs from status
// raw on (clip-pipeline ClipSchema) and the ingest steps never report it, so the curator states
// it at registration (a spec addition is requested).
type clipsRegisterIn struct {
	RawObjectKey         string          `json:"raw_object_key"`
	State                string          `json:"state"`
	TenantTags           []string        `json:"tenant_tags"`
	FilmedBy             string          `json:"filmed_by"`
	City                 string          `json:"city"`
	RoadType             string          `json:"road_type"`
	TimeOfDay            string          `json:"time_of_day"`
	Weather              string          `json:"weather"`
	POV                  string          `json:"pov"`
	CapturedMonth        string          `json:"captured_month"`
	SpeedKmhEst          json.RawMessage `json:"speed_kmh_est"`
	SpeedSource          string          `json:"speed_source"`
	Licence              string          `json:"licence"`
	ContributorConsentID string          `json:"contributor_consent_id"`
	DurationMs           *int            `json:"duration_ms"`
}

// RegisterClip is POST /v1/admin/clips: stores clip.json in status raw and starts clip_ingest.
func (s *Server) RegisterClip(w http.ResponseWriter, r *http.Request, _ gen.RegisterClipParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	curator, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	var in clipsRegisterIn
	if !decodeJSON(w, r, &in, false) {
		return
	}
	for ptr, v := range map[string]string{"/raw_object_key": in.RawObjectKey, "/state": in.State, "/filmed_by": in.FilmedBy,
		"/city": in.City, "/road_type": in.RoadType, "/time_of_day": in.TimeOfDay, "/weather": in.Weather, "/pov": in.POV,
		"/captured_month": in.CapturedMonth, "/speed_source": in.SpeedSource, "/licence": in.Licence,
		"/contributor_consent_id": in.ContributorConsentID} {
		if strings.TrimSpace(v) == "" {
			validation(w, r, ptr, "required")
			return
		}
	}
	if len(in.RawObjectKey) > 256 {
		validation(w, r, "/raw_object_key", "too_long")
		return
	}
	if in.DurationMs == nil {
		validation(w, r, "/duration_ms", "required")
		return
	}
	consent, ok := clipsConsentUUID(in.ContributorConsentID)
	if !ok {
		validation(w, r, "/contributor_consent_id", "invalid")
		return
	}
	var speed *float64
	if len(in.SpeedKmhEst) > 0 && string(in.SpeedKmhEst) != "null" {
		var f float64
		if json.Unmarshal(in.SpeedKmhEst, &f) != nil {
			validation(w, r, "/speed_kmh_est", "wrong_type")
			return
		}
		speed = &f
	}
	tags := []string{in.State}
	for _, t := range in.TenantTags {
		if t != in.State && !strings.ContainsFunc(t, func(r rune) bool { return !unicode.IsUpper(r) }) {
			tags = append(tags, t)
		} else if t != in.State {
			validation(w, r, "/tenant_tags", "invalid")
			return
		}
	}
	meta, err := json.Marshal(map[string]any{"tenantTags": tags, "city": in.City, "roadType": in.RoadType, "timeOfDay": in.TimeOfDay,
		"weather": in.Weather, "pov": in.POV, "capturedMonth": in.CapturedMonth, "speedKmhEst": speed, "speedSource": in.SpeedSource,
		"durationMs": *in.DurationMs})
	if err != nil {
		internalError(w, r)
		return
	}
	c, err := svc.Register(r.Context(), curator, clips.RegisterInput{RawObjectKey: in.RawObjectKey, State: in.State, FilmedBy: in.FilmedBy,
		Licence: in.Licence, ContributorConsentID: consent, Metadata: meta})
	if err != nil {
		s.clipsError(w, r, err)
		return
	}
	s.clipsWriteView(w, r, svc, curator, c, http.StatusAccepted)
}

// GetClipAdmin is GET /v1/admin/clips/{clipId} (current version, blind for raters).
func (s *Server) GetClipAdmin(w http.ResponseWriter, r *http.Request, clipID gen.ClipId) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	viewer, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	c, ok := s.clipsCurrent(w, r, svc, clipID, 0)
	if !ok {
		return
	}
	s.clipsWriteView(w, r, svc, viewer, c, http.StatusOK)
}

// RateClip is POST /v1/admin/clips/{clipId}/ratings: one blind rating per rater per version.
func (s *Server) RateClip(w http.ResponseWriter, r *http.Request, clipID gen.ClipId, _ gen.RateClipParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	rater, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	var in gen.ClipRatingCreate
	if !decodeJSON(w, r, &in, false) {
		return
	}
	if in.Version < 1 {
		validation(w, r, "/version", "required")
		return
	}
	var taskID *uuid.UUID
	if in.ReviewTaskId != nil {
		u, err := ids.Decode(ids.ReviewTask, *in.ReviewTaskId)
		if err != nil {
			validation(w, r, "/review_task_id", "invalid")
			return
		}
		taskID = &u
	}
	c, ok := s.clipsCurrent(w, r, svc, clipID, in.Version)
	if !ok {
		return
	}
	res, err := svc.SubmitRating(r.Context(), rater, c.ClipID, c.Version, clips.SubmitRatingInput{Decision: string(in.Decision),
		Marks: clipsMarksIn(in.Marks), ReviewTaskID: taskID})
	if err != nil {
		s.clipsError(w, r, err)
		return
	}
	if res.Task != nil && len(res.Task.ResumeURLSealed) > 0 {
		s.clipsResumeW08(r.Context(), c.Tenant, res.Task.Stage, res.Task.ResumeURLSealed, rater.Pseudonym, res.Decision, res.Rating.Submission.Marks)
	}
	rt := res.Rating
	writeJSON(w, http.StatusCreated, clipsRatingOut{RatingID: clipsRatingID(rt.ClipID, rt.Version, rt.Rater), ClipID: rt.ClipID,
		Version: rt.Version, Rater: rt.Rater, Decision: res.Decision, Marks: clipsMarksOut(rt.Submission.Marks), SubmittedAt: rt.SavedAt.UTC()})
}

// RecordClipBlurAudit is POST /v1/admin/clips/{clipId}/blur-audit. A failing audit is stored
// too (201, blur_audit.passed false) and blocks publishing until a re-blur and a new audit.
func (s *Server) RecordClipBlurAudit(w http.ResponseWriter, r *http.Request, clipID gen.ClipId, _ gen.RecordClipBlurAuditParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	auditor, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	var in gen.ClipBlurAuditCreate
	if !decodeJSON(w, r, &in, false) {
		return
	}
	if in.Version < 1 {
		validation(w, r, "/version", "required")
		return
	}
	if len(in.MissFrames) > 500 {
		validation(w, r, "/miss_frames", "too_many")
		return
	}
	c, ok := s.clipsCurrent(w, r, svc, clipID, in.Version)
	if !ok {
		return
	}
	misses := make([]clips.BlurAuditMiss, 0, len(in.MissFrames))
	for i, m := range in.MissFrames {
		k := string(m.Kind)
		if k != "face" && k != "plate" && k != "other_pii" {
			validation(w, r, fmt.Sprintf("/miss_frames/%d/kind", i), "invalid_enum")
			return
		}
		mf := clips.BlurAuditMiss{Frame: m.Frame, Kind: k}
		if m.Note != nil {
			mf.Note = *m.Note
		}
		misses = append(misses, mf)
	}
	if _, err := svc.SubmitBlurAudit(r.Context(), auditor, c.ClipID, c.Version, clips.BlurAuditInput{RenditionSHA256: in.RenditionSha256,
		FramesTotal: in.FramesTotal, FramesChecked: in.FramesChecked, Misses: in.Misses, MissFrames: misses}); err != nil {
		s.clipsError(w, r, err)
		return
	}
	c, ok = s.clipsCurrent(w, r, svc, clipID, 0)
	if !ok {
		return
	}
	s.clipsWriteView(w, r, svc, auditor, c, http.StatusCreated)
}

// AdjudicateClip is POST /v1/admin/clips/{clipId}/adjudication (a third person, never a rater).
func (s *Server) AdjudicateClip(w http.ResponseWriter, r *http.Request, clipID gen.ClipId, _ gen.AdjudicateClipParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	adjudicator, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	var in gen.ClipAdjudicationCreate
	if !decodeJSON(w, r, &in, false) {
		return
	}
	if in.Version < 1 {
		validation(w, r, "/version", "required")
		return
	}
	if len(in.Decisions) > 20 {
		validation(w, r, "/decisions", "too_many")
		return
	}
	c, ok := s.clipsCurrent(w, r, svc, clipID, in.Version)
	if !ok {
		return
	}
	adj := clips.AdjudicationInput{ReasonCode: string(in.ReasonCode), Decisions: make([]clips.AdjudicationDecision, 0, len(in.Decisions))}
	for _, d := range in.Decisions {
		ad := clips.AdjudicationDecision{ClusterID: d.ClusterId, Verdict: string(d.Verdict)}
		if d.Mark != nil {
			m := clipsMarksIn([]gen.ClipMark{*d.Mark})[0]
			ad.Mark = &m
		}
		adj.Decisions = append(adj.Decisions, ad)
	}
	if _, err := svc.Adjudicate(r.Context(), adjudicator, c.ClipID, c.Version, adj); err != nil {
		s.clipsError(w, r, err)
		return
	}
	c, ok = s.clipsCurrent(w, r, svc, clipID, 0)
	if !ok {
		return
	}
	s.clipsWriteView(w, r, svc, adjudicator, c, http.StatusOK)
}

// clipsCueTextsIn is ClipCueTextsSet plus the curator difficulty the web sends with it
// (difficulty_curator, 1–5): nothing else in the API sets it and publish requires it.
type clipsCueTextsIn struct {
	Version int `json:"version"`
	Cues    map[string]struct {
		En string `json:"en"`
		Hi string `json:"hi"`
	} `json:"cues"`
	DifficultyCurator *int `json:"difficulty_curator"`
}

// SetClipCueTexts is PUT /v1/admin/clips/{clipId}/cue-texts (rated clips only).
func (s *Server) SetClipCueTexts(w http.ResponseWriter, r *http.Request, clipID gen.ClipId, _ gen.SetClipCueTextsParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	curator, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	var in clipsCueTextsIn
	if !decodeJSON(w, r, &in, false) {
		return
	}
	if in.Version < 1 {
		validation(w, r, "/version", "required")
		return
	}
	if in.Cues == nil {
		validation(w, r, "/cues", "required")
		return
	}
	if len(in.Cues) > 2 {
		validation(w, r, "/cues", "too_many")
		return
	}
	c, ok := s.clipsCurrent(w, r, svc, clipID, in.Version)
	if !ok {
		return
	}
	cues := make(map[string]clips.CueText, len(in.Cues))
	for id, ct := range in.Cues {
		cues[id] = clips.CueText{En: strings.TrimSpace(ct.En), Hi: strings.TrimSpace(ct.Hi)}
	}
	c, err := svc.SetCueTexts(r.Context(), curator, c.ClipID, c.Version, cues)
	if err == nil && in.DifficultyCurator != nil {
		c, err = svc.SetCuratorDifficulty(r.Context(), curator, c.ClipID, c.Version, *in.DifficultyCurator)
	}
	if err != nil {
		s.clipsError(w, r, err)
		return
	}
	s.clipsWriteView(w, r, svc, curator, c, http.StatusOK)
}

// PublishClip is POST /v1/admin/clips/{clipId}/publish. Unmet preconditions: see
// clipsPublishBlocked.
func (s *Server) PublishClip(w http.ResponseWriter, r *http.Request, clipID gen.ClipId, _ gen.PublishClipParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	curator, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	c, ok := s.clipsCurrent(w, r, svc, clipID, 0)
	if !ok {
		return
	}
	c, err := svc.Publish(r.Context(), curator, c.ClipID, c.Version)
	if err != nil {
		s.clipsError(w, r, err)
		return
	}
	s.clipsWriteView(w, r, svc, curator, c, http.StatusOK)
}

// ---- AI-generated clips (ADR-0013) ---------------------------------------------------------

// GenerateClip is POST /v1/admin/clips/generate: starts the clip_generate workflow for one
// scene revision and batch (its clip.register_generated step creates the clip). 202 with the
// run, plus the clip on a repeat after the task registered it.
func (s *Server) GenerateClip(w http.ResponseWriter, r *http.Request, _ gen.GenerateClipParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	curator, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	var in gen.ClipGenerate
	if !decodeJSON(w, r, &in, false) {
		return
	}
	res, err := svc.Generate(r.Context(), curator, in.SceneId, in.Version, in.BatchId)
	if err != nil {
		s.clipsError(w, r, err)
		return
	}
	out := struct {
		SceneID       string     `json:"scene_id"`
		Version       int        `json:"version"`
		BatchID       string     `json:"batch_id"`
		Origin        string     `json:"origin"`
		GenerationKey string     `json:"generation_key"`
		WorkflowRun   gen.JobRun `json:"workflow_run"`
		Clip          *clipsOut  `json:"clip,omitempty"`
	}{SceneID: res.SceneID, Version: res.Revision, BatchID: res.BatchID, Origin: clips.OriginAIGenerated, GenerationKey: res.GenerationKey,
		WorkflowRun: gen.JobRun{Job: gen.JobRunJobClipGenerate, RunId: res.RunID, Runner: gen.Inline, Status: gen.JobRunStatusStarted}}
	if runs, err := store.ClipJobRuns(r.Context(), s.deps.DB, []string{res.RunID}); err == nil && len(runs) == 1 {
		out.WorkflowRun.Runner = gen.JobRunRunner(runs[0].Runner)
		if st, ok := clipsJobStatus[runs[0].Status]; ok {
			out.WorkflowRun.Status = st
		}
	}
	if res.Clip != nil {
		if out.Clip, err = s.clipsView(r.Context(), svc, curator, res.Clip); err != nil {
			s.clipsError(w, r, err)
			return
		}
	}
	writeJSON(w, http.StatusAccepted, out)
}

// SetClipSyntheticReview is POST /v1/admin/clips/{clipId}/synthetic-review: the curator's
// synthetic-content review of an AI clip (stored with passed false when any check fails).
func (s *Server) SetClipSyntheticReview(w http.ResponseWriter, r *http.Request, clipID gen.ClipId, _ gen.SetClipSyntheticReviewParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	reviewer, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	var in gen.ClipSyntheticReviewCreate
	if !decodeJSON(w, r, &in, false) {
		return
	}
	if in.Version < 1 {
		validation(w, r, "/version", "required")
		return
	}
	c, ok := s.clipsCurrent(w, r, svc, clipID, in.Version)
	if !ok {
		return
	}
	note := ""
	if in.Note != nil {
		note = *in.Note
	}
	ch := in.Checks
	c, err := svc.SubmitSyntheticReview(r.Context(), reviewer, c.ClipID, c.Version, clips.SyntheticChecks{
		NoRealPersonLikeness: ch.NoRealLikeness, NoReadablePlates: ch.NoReadablePlates, NoRealBrands: ch.NoRealBrands,
		NoCollisionOrInjury: ch.NoCollisionOrInjury, HazardVisible: ch.HazardVisible}, note)
	if err != nil {
		s.clipsError(w, r, err)
		return
	}
	s.clipsWriteView(w, r, svc, reviewer, c, http.StatusCreated)
}

// ---- W08 internal --------------------------------------------------------------------------

// CreateClipReviewTask is POST /internal/clips/{clipId}/review-tasks (n8n W08, bearer + HMAC).
// The resume URL is sealed with the privacy vault before it is stored.
func (s *Server) CreateClipReviewTask(w http.ResponseWriter, r *http.Request, clipID gen.ClipId, _ gen.CreateClipReviewTaskParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	var in gen.ClipReviewTaskCreate
	if !decodeJSON(w, r, &in, false) {
		return
	}
	u, err := url.Parse(in.ResumeUrl)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || len(in.ResumeUrl) > 512 {
		validation(w, r, "/resume_url", "invalid")
		return
	}
	c, ok := s.clipsCurrent(w, r, svc, clipID, 0)
	if !ok {
		return
	}
	var sealed []byte
	if s.deps.Vault != nil {
		if sealed, err = s.deps.Vault.EncryptString(c.Tenant, clipsResumeURLField, in.ResumeUrl); err != nil {
			s.deps.Log.ErrorContext(r.Context(), "resume url seal failed", "err", err)
			internalError(w, r)
			return
		}
	}
	ti := clips.ReviewTaskInput{Stage: string(in.Stage), ResumeURLSealed: sealed, ExecutionID: in.N8nExecutionId}
	if in.DueInHours != nil {
		if *in.DueInHours < 1 {
			validation(w, r, "/due_in_hours", "out_of_range")
			return
		}
		ti.DueInHours = *in.DueInHours
	}
	if in.ExcludeRaterId != nil {
		ti.ExcludeRater = *in.ExcludeRaterId
	}
	t, created, err := svc.CreateReviewTask(r.Context(), clipID, ti)
	if err != nil {
		s.clipsError(w, r, err)
		return
	}
	if err := s.auditInternal(r, tenantFrom(r.Context()).TenantID, "internal.clip_review_task", c.Ref(),
		map[string]any{"stage": t.Stage, "execution": in.N8nExecutionId, "replay": !created}); err != nil {
		internalError(w, r)
		return
	}
	writeJSON(w, http.StatusCreated, clipsTaskWire(t))
}

// SetClipReviewOutcome is POST /internal/clips/{clipId}/status (n8n W08): rejected retires the
// version; review_timeout leaves it proposed with the stage's open task timed out.
func (s *Server) SetClipReviewOutcome(w http.ResponseWriter, r *http.Request, clipID gen.ClipId, _ gen.SetClipReviewOutcomeParams) {
	svc, ok := s.clipsService(w, r)
	if !ok {
		return
	}
	var in gen.ClipReviewOutcome
	if !decodeJSON(w, r, &in, false) {
		return
	}
	if in.N8nExecutionId == "" || len(in.N8nExecutionId) > 64 {
		validation(w, r, "/n8n_execution_id", "invalid")
		return
	}
	c, open, err := svc.RecordReviewOutcome(r.Context(), clipID, string(in.Status), string(in.Stage))
	if err != nil {
		s.clipsError(w, r, err)
		return
	}
	if err := s.auditInternal(r, tenantFrom(r.Context()).TenantID, "internal.clip_review_outcome", c.Ref(),
		map[string]any{"status": string(in.Status), "stage": string(in.Stage), "execution": in.N8nExecutionId}); err != nil {
		internalError(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clip_id": c.ClipID, "version": c.Version, "status": string(c.Status), "open_tasks": open})
}
