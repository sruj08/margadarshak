package clips

// W08 blind review tasks (API-55 internal endpoints), the rating decision relayed to W08, and
// small exported helpers the HTTP layer needs (media URLs, the audit verdict). Review tasks live
// behind ReviewStore, an optional extension of Store (internal/store.ClipsStore implements it;
// MemStore does not, and the operations then answer ErrReviewTasksUnsupported).

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Review task stages and statuses (api/openapi.yaml ClipReviewTask).
const (
	StageRater1 = "rater_1"
	StageRater2 = "rater_2"

	TaskOpen      = "open"
	TaskSubmitted = "submitted"
	TaskRejected  = "rejected"
	TaskTimedOut  = "timed_out"
	TaskCancelled = "cancelled"

	DecisionWindowsSet = "windows_set"
	DecisionReject     = "reject"
)

// ReviewTask is one W08 rater task (content.clip_review_tasks).
type ReviewTask struct {
	ID           uuid.UUID
	ClipID       string
	Version      int
	Stage        string
	Status       string
	Assignee     string // "" while unassigned; set when a rater claims the task by saving
	ExcludeRater string
	ExecutionID  string
	// ResumeURLSealed is the W08 Wait-node resume URL, sealed by the caller (privacy vault).
	ResumeURLSealed []byte
	DueAt           time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// ReviewStore persists review tasks and rating decisions.
type ReviewStore interface {
	// InsertReviewTask stores t unless a task for (clip, version, stage) exists; it returns the
	// stored task and whether it was created.
	InsertReviewTask(ctx context.Context, t *ReviewTask) (*ReviewTask, bool, error)
	ReviewTasks(ctx context.Context, clipID string, version int) ([]*ReviewTask, error)
	UpdateReviewTask(ctx context.Context, t *ReviewTask) error
	SetRatingDecision(ctx context.Context, clipID string, version int, rater, decision string) error
	RatingDecisions(ctx context.Context, clipID string, version int) (map[string]string, error)
}

var (
	// ErrReviewTasksUnsupported means the configured Store has no review-task storage.
	ErrReviewTasksUnsupported = errors.New("clips: the clip store has no review-task storage")
	// ErrAlreadyRated is a second submission by the same rater (API-55: a rater rates once).
	ErrAlreadyRated = errors.New("clips: this rater has already rated this clip version")
	// ErrUnknownReviewTask is a review_task_id that is not an open task of this clip version.
	ErrUnknownReviewTask = errors.New("clips: unknown or closed review task")
)

func (s *Service) reviewStore() (ReviewStore, error) {
	rs, ok := s.Store.(ReviewStore)
	if !ok {
		return nil, ErrReviewTasksUnsupported
	}
	return rs, nil
}

// ReviewTaskInput is the W08 review-task request (field names as W08 sends them).
type ReviewTaskInput struct {
	Stage           string
	ResumeURLSealed []byte
	ExecutionID     string
	DueInHours      int // 0 means 48
	ExcludeRater    string
}

// CreateReviewTask opens a blind rater task for the clip's current version, which must be
// awaiting ratings (status proposed). It is idempotent on (clip, version, stage): a replay
// returns the stored task (created=false), whatever the clip status is now.
func (s *Service) CreateReviewTask(ctx context.Context, clipID string, in ReviewTaskInput) (*ReviewTask, bool, error) {
	rs, err := s.reviewStore()
	if err != nil {
		return nil, false, err
	}
	switch {
	case in.Stage != StageRater1 && in.Stage != StageRater2:
		return nil, false, &ValidationError{"/stage", "invalid_enum"}
	case in.ExecutionID == "" || len(in.ExecutionID) > 64:
		return nil, false, &ValidationError{"/n8n_execution_id", "invalid"}
	case in.DueInHours < 0 || in.DueInHours > 168:
		return nil, false, &ValidationError{"/due_in_hours", "out_of_range"}
	case in.ExcludeRater != "" && !ValidPseudonym(in.ExcludeRater):
		return nil, false, &ValidationError{"/exclude_rater_id", "invalid"}
	}
	c, err := s.Store.GetClip(ctx, clipID, 0)
	if err != nil {
		return nil, false, err
	}
	existing, err := rs.ReviewTasks(ctx, c.ClipID, c.Version)
	if err != nil {
		return nil, false, err
	}
	for _, t := range existing {
		if t.Stage == in.Stage {
			return t, false, nil
		}
	}
	if c.Status != StatusProposed {
		return nil, false, ErrWrongStatus
	}
	hours := in.DueInHours
	if hours == 0 {
		hours = 48
	}
	now := s.now()
	t := &ReviewTask{ID: uuid.Must(uuid.NewV7()), ClipID: c.ClipID, Version: c.Version, Stage: in.Stage, Status: TaskOpen,
		ExcludeRater: in.ExcludeRater, ExecutionID: in.ExecutionID, ResumeURLSealed: in.ResumeURLSealed,
		DueAt: now.Add(time.Duration(hours) * time.Hour), CreatedAt: now, UpdatedAt: now}
	return rs.InsertReviewTask(ctx, t)
}

// ReviewTasks lists the review tasks of a clip version (stage order).
func (s *Service) ReviewTasks(ctx context.Context, clipID string, version int) ([]*ReviewTask, error) {
	rs, err := s.reviewStore()
	if err != nil {
		return nil, err
	}
	return rs.ReviewTasks(ctx, clipID, version)
}

// RatingDecisions returns rater → decision for a clip version (empty without review storage).
func (s *Service) RatingDecisions(ctx context.Context, clipID string, version int) (map[string]string, error) {
	rs, err := s.reviewStore()
	if errors.Is(err, ErrReviewTasksUnsupported) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	return rs.RatingDecisions(ctx, clipID, version)
}

// SubmitRatingInput is one API-55 rating.
type SubmitRatingInput struct {
	Decision     string
	Marks        []RaterMark
	ReviewTaskID *uuid.UUID
}

// SubmitRatingResult is the saved rating, its decision and the review task it answered (nil
// when no task was open for this rater).
type SubmitRatingResult struct {
	*RateResult
	Decision string
	Task     *ReviewTask
}

// SubmitRating saves a rater's blind rating once (a second submission by the same rater is
// ErrAlreadyRated, a third rater ErrTooManyRaters), records the decision and claims the review
// task it answers: the named one, or else the first open task the rater is not excluded from.
// A reject decision carries no marks.
func (s *Service) SubmitRating(ctx context.Context, rater Actor, clipID string, version int, in SubmitRatingInput) (*SubmitRatingResult, error) {
	if err := requireActor(rater); err != nil {
		return nil, err
	}
	switch in.Decision {
	case DecisionWindowsSet:
	case DecisionReject:
		if len(in.Marks) > 0 {
			return nil, &ValidationError{"/marks", "must_be_empty_for_reject"}
		}
	default:
		return nil, &ValidationError{"/decision", "invalid_enum"}
	}
	existing, err := s.Store.Ratings(ctx, clipID, version)
	if err != nil {
		return nil, err
	}
	for _, r := range existing {
		if r.Rater == rater.Pseudonym {
			return nil, ErrAlreadyRated
		}
	}
	rs, rsErr := s.reviewStore()
	var task *ReviewTask
	if rsErr == nil {
		tasks, err := rs.ReviewTasks(ctx, clipID, version)
		if err != nil {
			return nil, err
		}
		for _, t := range tasks {
			if in.ReviewTaskID != nil {
				if t.ID == *in.ReviewTaskID {
					if t.Status != TaskOpen || t.ExcludeRater == rater.Pseudonym {
						return nil, ErrUnknownReviewTask
					}
					task = t
				}
				continue
			}
			if task == nil && t.Status == TaskOpen && t.ExcludeRater != rater.Pseudonym {
				task = t
			}
		}
		if in.ReviewTaskID != nil && task == nil {
			return nil, ErrUnknownReviewTask
		}
	} else if in.ReviewTaskID != nil {
		return nil, ErrUnknownReviewTask
	}
	res, err := s.Rate(ctx, rater, clipID, version, in.Marks)
	if err != nil {
		return nil, err
	}
	out := &SubmitRatingResult{RateResult: res, Decision: in.Decision}
	if rsErr != nil {
		return out, nil
	}
	if err := rs.SetRatingDecision(ctx, clipID, version, rater.Pseudonym, in.Decision); err != nil {
		return nil, err
	}
	if task != nil {
		task.Assignee, task.Status, task.UpdatedAt = rater.Pseudonym, TaskSubmitted, s.now()
		if in.Decision == DecisionReject {
			task.Status = TaskRejected
		}
		if err := rs.UpdateReviewTask(ctx, task); err != nil {
			return nil, err
		}
		out.Task = task
	}
	return out, nil
}

// Review outcomes W08 reports (api/openapi.yaml ClipReviewOutcome).
const (
	OutcomeRejected      = "rejected"
	OutcomeReviewTimeout = "review_timeout"
)

// RecordReviewOutcome applies a W08 outcome to the clip's current version. rejected retires the
// version (any status may move to retired) and closes its open tasks (the stage's task becomes
// rejected, the others cancelled); review_timeout leaves the clip as it is and marks the
// stage's open task (every open task for stage "unknown") timed_out. Idempotent. It returns the
// clip and the number of tasks still open.
func (s *Service) RecordReviewOutcome(ctx context.Context, clipID, status, stage string) (*Clip, int, error) {
	rs, err := s.reviewStore()
	if err != nil {
		return nil, 0, err
	}
	if status != OutcomeRejected && status != OutcomeReviewTimeout {
		return nil, 0, &ValidationError{"/status", "invalid_enum"}
	}
	if stage != StageRater1 && stage != StageRater2 && stage != "unknown" {
		return nil, 0, &ValidationError{"/stage", "invalid_enum"}
	}
	c, err := s.Store.GetClip(ctx, clipID, 0)
	if err != nil {
		return nil, 0, err
	}
	tasks, err := rs.ReviewTasks(ctx, c.ClipID, c.Version)
	if err != nil {
		return nil, 0, err
	}
	now := s.now()
	if status == OutcomeRejected && c.Status != StatusRetired {
		if _, err := checkPath(c.Doc.Origin, c.Status, StatusRetired); err != nil {
			return nil, 0, err
		}
		c.Status, c.Doc.Status, c.UpdatedAt = StatusRetired, StatusRetired, now
		if err := s.Store.UpdateClip(ctx, c); err != nil {
			return nil, 0, err
		}
	}
	open := 0
	for _, t := range tasks {
		if t.Status != TaskOpen {
			continue
		}
		match := stage == "unknown" || t.Stage == stage
		next := ""
		switch {
		case status == OutcomeRejected && match:
			next = TaskRejected
		case status == OutcomeRejected:
			next = TaskCancelled
		case match:
			next = TaskTimedOut
		}
		if next == "" {
			open++
			continue
		}
		t.Status, t.UpdatedAt = next, now
		if err := rs.UpdateReviewTask(ctx, t); err != nil {
			return nil, 0, err
		}
	}
	return c, open, nil
}

// MediaURL is the playback URL of a rendition (MEDIA_PUBLIC_BASE_URL or a presigned URL).
func (s *Service) MediaURL(ctx context.Context, clipID string, version int, res string) (string, error) {
	return s.mediaURL(ctx, MediaObjectKey(clipID, version, res))
}

// BlurAuditPassed reports whether audit passes for the clip document (every frame, 0 misses,
// on the current bytes): clip-pipeline blurAuditIssues is empty.
func BlurAuditPassed(a *BlurAudit, d *Doc) bool { return blurAuditPasses(a, d) }

// SetCuratorDifficulty sets the curator difficulty (1–5, NAZAR §7.1) of a clip awaiting its
// cue texts (status rated); publish requires it.
func (s *Service) SetCuratorDifficulty(ctx context.Context, curator Actor, clipID string, version, level int) (*Clip, error) {
	if err := requireActor(curator); err != nil {
		return nil, err
	}
	if level < 1 || level > 5 {
		return nil, &ValidationError{"/difficulty_curator", "out_of_range"}
	}
	c, err := s.Store.GetClip(ctx, clipID, version)
	if err != nil {
		return nil, err
	}
	if c.Status != StatusRated {
		return nil, ErrWrongStatus
	}
	c.Doc.Difficulty.Curator = &level
	c.UpdatedAt = s.now()
	if err := ValidateDocStruct(&c.Doc); err != nil {
		return nil, err
	}
	return c, s.Store.UpdateClip(ctx, c)
}
