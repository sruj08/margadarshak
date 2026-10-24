package clips

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	adnotify "github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
)

// ---- Records --------------------------------------------------------------------------------

// Proposal is an M-06 window proposal (proposals.ts ProposedWindow). Never a final window; P2
// produces none (clip.propose_windows is a stub, decision D8).
type Proposal struct {
	AMs        int    `json:"aMs"`
	BMs        int    `json:"bMs"`
	HazardType string `json:"hazardType"`
	Why        string `json:"why"`
}

// FinalHazard is clip-pipeline FinalHazard as returned by /clip/agreement.
type FinalHazard struct {
	HazardID     string   `json:"hazardId"`
	HazardType   string   `json:"hazardType"`
	Window       FWindow  `json:"window"`
	RaterCount   int      `json:"raterCount"`
	DeltaOnsetMs float64  `json:"deltaOnsetMs"`
	DeltaEndMs   float64  `json:"deltaEndMs"`
	Adjudicated  bool     `json:"adjudicated"`
	Occlusion    bool     `json:"occlusion"`
	Cues         []string `json:"cues"`
}

// FWindow is a window as the compute service sends it (numbers; frame-snapped integer ms).
type FWindow struct {
	AMs float64 `json:"aMs"`
	BMs float64 `json:"bMs"`
}

// Adjudication is a third person's ruling and its result.
type Adjudication struct {
	Adjudicator string          `json:"adjudicator"`
	Input       json.RawMessage `json:"input"` // clip-pipeline AdjudicationInput, forwarded verbatim
	Resolved    bool            `json:"resolved"`
	Hazards     []FinalHazard   `json:"hazards"`
	Dropped     []string        `json:"dropped"`
	Issues      []string        `json:"issues"`
	At          time.Time       `json:"at"`
}

// Clip is one clip version as the API stores it (content.clips; non-personal data, no RLS).
type Clip struct {
	ClipID               string
	Version              int
	Status               Status
	Doc                  Doc
	Tenant               string
	RawObjectKey         string
	IntermediateKeys     []string // mezzanine and unblurred intermediates (deleted with the raw)
	FilmedBy             string   // passenger | fixed_mount (never the rider)
	FilmedOn             string
	ContributorConsentID string
	RegisteredBy         string
	RegisteredAt         time.Time
	FlashPassed          *bool
	Proposals            []Proposal
	BlurRegions          json.RawMessage
	ReviewEventID        string
	AdjudicationEventID  string
	Agreement            json.RawMessage // last ClipAgreement (verbatim from compute)
	AgreementAccepted    bool
	NeedsThirdRater      bool
	FinalHazards         []FinalHazard
	Adjudication         *Adjudication
	CueTexts             map[string]CueText
	AuditPassedAt        *time.Time
	RawDeletedAt         *time.Time
	PublishedAt          *time.Time
	MockEligible         bool
	MockReasons          []string
	WorkflowRuns         []string
	Round                int
	UpdatedAt            time.Time
	// GenerationKey is `sceneId:revision:batchId` for an ai_generated clip (one clip per scene
	// revision and batch; clip_generate re-runs dedupe on it), "" for filmed clips.
	GenerationKey string
	// SyntheticReview is the latest curator review of an ai_generated clip, passing or not
	// (clip.json carries only a passing one).
	SyntheticReview *SyntheticReviewRecord
	// OnsetHint is the raters' approximate cue time of an ai_generated clip (an OnsetHint):
	// admin view only, never in clip.json, the scoring documents or any learner response.
	OnsetHint json.RawMessage
}

// SyntheticChecks are the five synthetic-content checks (clip-pipeline SyntheticReviewSchema).
type SyntheticChecks struct {
	NoRealPersonLikeness bool `json:"noRealPersonLikeness"`
	NoReadablePlates     bool `json:"noReadablePlates"`
	NoRealBrands         bool `json:"noRealBrands"`
	NoCollisionOrInjury  bool `json:"noCollisionOrInjury"`
	HazardVisible        bool `json:"hazardVisible"`
}

// All reports whether every check passed.
func (c SyntheticChecks) All() bool {
	return c.NoRealPersonLikeness && c.NoReadablePlates && c.NoRealBrands && c.NoCollisionOrInjury && c.HazardVisible
}

// SyntheticReviewRecord is one curator review of an ai_generated clip.
type SyntheticReviewRecord struct {
	Reviewer   string          `json:"reviewer"`
	ReviewedAt time.Time       `json:"reviewedAt"`
	Checks     SyntheticChecks `json:"checks"`
	Passed     bool            `json:"passed"`
	Note       string          `json:"note,omitempty"`
}

// Ref is `JMU-0012@3`.
func (c *Clip) Ref() string { return c.Doc.Ref() }

// RaterMark is one hazard a rater marked (clip-pipeline RaterMarkSchema).
type RaterMark struct {
	HazardType string  `json:"hazardType"`
	AMs        int     `json:"aMs"`
	BMs        int     `json:"bMs"`
	Cue        *string `json:"cue,omitempty"`
	Occlusion  *bool   `json:"occlusion,omitempty"`
}

// RaterSubmission is one rater's blind submission (clip-pipeline RaterSubmissionSchema, E-21).
type RaterSubmission struct {
	Rater       string      `json:"rater"`
	ClipID      string      `json:"clipId"`
	Version     int         `json:"version"`
	Marks       []RaterMark `json:"marks"`
	SubmittedAt string      `json:"submittedAt"`
}

// Rating is a stored rating (content.clip_ratings, UNIQUE (clip_id, version, rater)).
type Rating struct {
	ClipID     string
	Version    int
	Rater      string
	Submission RaterSubmission
	SavedAt    time.Time
}

// BlurAuditMiss is a frame where a face, plate or other PII was still visible.
type BlurAuditMiss struct {
	Frame int    `json:"frame"`
	Kind  string `json:"kind"` // face | plate | other_pii
	Note  string `json:"note,omitempty"`
}

// BlurAudit is the full audit record (clip-pipeline BlurAuditRecord; content.clip_blur_audits).
type BlurAudit struct {
	ClipID          string
	Version         int
	Auditor         string
	RenditionSHA256 string
	FramesTotal     int
	FramesChecked   int
	Misses          int
	MissFrames      []BlurAuditMiss
	AuditedAt       time.Time
}

// RawDeletion is the raw-footage deletion log (clip-pipeline RawDeletionRecord; MD-218).
type RawDeletion struct {
	ClipID        string
	Version       int
	ObjectKeys    []string // object keys, never URLs
	Reason        string   // audit_passed | retention_limit | takedown
	UploadedAt    time.Time
	AuditPassedAt *time.Time
	DeletedAt     time.Time
	DeletedBy     string // clip_finalize or a pseudonym
	Deadline      time.Time
	OnTime        bool
}

// Manifest is one published manifest version (content.clip_manifests).
type Manifest struct {
	Version         string // client manifest digest
	GeneratedAt     time.Time
	Bank            json.RawMessage
	Client          json.RawMessage
	MockEligibility map[string]Eligibility
}

// Eligibility is Kerala-mock eligibility of one clip ref.
type Eligibility struct {
	Eligible bool     `json:"eligible"`
	Reasons  []string `json:"reasons"`
}

// ListFilter selects clips.
type ListFilter struct {
	Status []Status
	Tenant string // tenant tag
}

// ---- Ports ----------------------------------------------------------------------------------

// Store persists clips (internal/store/clips.go at handover, content schema).
type Store interface {
	NextClipNumber(ctx context.Context, prefix string) (int, error)
	InsertClip(ctx context.Context, c *Clip) error
	// GetClip returns one version; version 0 means the latest version. ErrNotFound if absent.
	GetClip(ctx context.Context, clipID string, version int) (*Clip, error)
	// ClipByGenerationKey returns the ai_generated clip with this generation key (ErrNotFound).
	ClipByGenerationKey(ctx context.Context, key string) (*Clip, error)
	UpdateClip(ctx context.Context, c *Clip) error
	ListClips(ctx context.Context, f ListFilter) ([]*Clip, error)
	UpsertRating(ctx context.Context, r *Rating) error
	Ratings(ctx context.Context, clipID string, version int) ([]*Rating, error)
	InsertBlurAudit(ctx context.Context, a *BlurAudit) error
	LatestBlurAudit(ctx context.Context, clipID string, version int) (*BlurAudit, error)
	InsertRawDeletion(ctx context.Context, d *RawDeletion) error
	RawDeletion(ctx context.Context, clipID string, version int) (*RawDeletion, error)
	SaveManifest(ctx context.Context, m *Manifest) error
	LatestManifest(ctx context.Context) (*Manifest, error)
}

// ClipCompute mirrors the compute service routes POST /clip/agreement and POST /clip/manifests
// (services/score-verifier/src/routes/clip.ts). The adapter (internal/adapters/compute) signs
// the request; it returns an error wrapping ErrComputeUnavailable when the service is down.
type ClipCompute interface {
	Agreement(ctx context.Context, req AgreementRequest) (*AgreementResponse, error)
	Manifests(ctx context.Context, req ManifestsRequest) (*ManifestsResponse, error)
}

// ObjectStore is the slice of ports.ObjectStore this package needs (D5: mock | r2).
type ObjectStore interface {
	// Delete removes key; a missing key is not an error.
	Delete(ctx context.Context, key string) error
	PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error)
	Put(ctx context.Context, key string, body []byte, contentType string) error
}

// WebhookPoster posts a signed envelope to an n8n webhook path (W08). At handover it is a small
// method on adnotify.N8n that posts a prebuilt envelope (same transport, token and errors).
type WebhookPoster interface {
	PostEnvelope(ctx context.Context, path string, env adnotify.Envelope) error
}

// JobStarter starts a Render Workflows task (jobs.Service.Start, adapted at handover).
type JobStarter interface {
	StartJob(ctx context.Context, tenant *string, job string, args []any, idemKey string) (runID string, err error)
}

// ConsentChecker confirms the contributor's clip_contribution consent artefact.
type ConsentChecker interface {
	ClipContributionActive(ctx context.Context, consentID string) (bool, error)
}

// TakerStats feeds clip.recompute_difficulty from verified sessions (games package): the mean
// points per hazard (0–5) over each taker's earliest eligible attempt, and the taker count.
type TakerStats interface {
	ClipTakerStats(ctx context.Context, ref string) (meanPoints float64, nTakers int, err error)
}

// ---- Errors ---------------------------------------------------------------------------------

var (
	ErrNotFound           = errors.New("clips: not found")
	ErrComputeUnavailable = errors.New("clips: compute service unavailable")
	ErrInvalidActor       = errors.New("clips: actor must be a pseudonym (e.g. rater-07)")
	ErrWrongStatus        = errors.New("clips: operation not allowed in the clip's status")
	ErrTooManyRaters      = errors.New("clips: two raters have already saved; use adjudication")
	ErrRatingsFrozen      = errors.New("clips: both ratings are saved and can no longer change")
	ErrAdjudicatorIsRater = errors.New("clips: the adjudicator must not be one of the two raters")
	ErrConsentRequired    = errors.New("clips: an active clip_contribution consent is required")
	ErrNotScorable        = errors.New("clips: clip is not published or has no speed estimate")
	ErrNotEnoughClips     = errors.New("clips: not enough unseen mock-eligible clips")
)

// ValidationError points at an invalid input field.
type ValidationError struct{ Pointer, Code string }

func (e *ValidationError) Error() string { return "clips: invalid " + e.Pointer + ": " + e.Code }

// Violation is one reason a clip cannot publish (mirrors clip-pipeline status.ts Violation).
type Violation struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// PublishBlockedError lists every unmet publish precondition.
type PublishBlockedError struct{ Violations []Violation }

func (e *PublishBlockedError) Error() string {
	return "clips: publish blocked: " + e.Violations[0].Code
}

// ---- Compute contract (score-verifier routes/clip.ts) ---------------------------------------

// AgreementRequest is the /clip/agreement body. Op is agreement | adjudicate | final_window |
// scoring_clip; fields not used by the op are omitted.
type AgreementRequest struct {
	Op           string           `json:"op"`
	Now          int64            `json:"now"`
	RaterA       *RaterSubmission `json:"raterA,omitempty"`
	RaterB       *RaterSubmission `json:"raterB,omitempty"`
	DurationMs   *int             `json:"durationMs,omitempty"`
	Proposals    []Proposal       `json:"proposals,omitempty"`
	Adjudication json.RawMessage  `json:"adjudication,omitempty"`
	Marks        []Window         `json:"marks,omitempty"`
	Clip         json.RawMessage  `json:"clip,omitempty"`
}

// AgreementResponse is the /clip/agreement response (the fields Go reads, plus the raw body).
type AgreementResponse struct {
	Op           string              `json:"op"`
	Agreement    *AgreementResult    `json:"agreement,omitempty"`
	Adjudication *AdjudicationResult `json:"adjudication,omitempty"`
	Window       *FWindow            `json:"window,omitempty"`
	ScoringClip  json.RawMessage     `json:"scoringClip,omitempty"`
	// Raw is the agreement object verbatim, stored for reproducibility (NAZAR §6.4).
	Raw json.RawMessage `json:"-"`
}

// AgreementResult is clip-pipeline ClipAgreement (fields Go reads).
type AgreementResult struct {
	ClipID          string          `json:"clipId"`
	Version         int             `json:"version"`
	Raters          []string        `json:"raters"`
	Pairs           []AgreementPair `json:"pairs"`
	Reasons         []string        `json:"reasons"`
	Accepted        bool            `json:"accepted"`
	NeedsThirdRater bool            `json:"needsThirdRater"`
	FinalHazards    []FinalHazard   `json:"finalHazards"`
	Metrics         struct {
		Matched           int      `json:"matched"`
		MedianDeltaOnsetM *float64 `json:"medianDeltaOnsetMs"`
	} `json:"metrics"`
}

// AgreementPair is a matched pair of marks.
type AgreementPair struct {
	A            RaterMark `json:"a"`
	B            RaterMark `json:"b"`
	DeltaOnsetMs float64   `json:"deltaOnsetMs"`
	Accepted     bool      `json:"accepted"`
}

// AdjudicationResult is clip-pipeline adjudicate() output.
type AdjudicationResult struct {
	Resolved bool          `json:"resolved"`
	Hazards  []FinalHazard `json:"hazards"`
	Dropped  []string      `json:"dropped"`
	Issues   []string      `json:"issues"`
}

// ManifestsRequest is the /clip/manifests body.
type ManifestsRequest struct {
	Now          int64             `json:"now"`
	Clips        []json.RawMessage `json:"clips"`
	FlashPassed  map[string]bool   `json:"flashPassed"`
	Tenant       string            `json:"tenant,omitempty"`
	Resolution   string            `json:"resolution,omitempty"`
	MediaBaseURL string            `json:"mediaBaseUrl,omitempty"`
	Include      []string          `json:"include,omitempty"`
}

// ManifestsResponse is the /clip/manifests response.
type ManifestsResponse struct {
	GeneratedAt     string                 `json:"generatedAt"`
	Bank            json.RawMessage        `json:"bank"`
	Client          json.RawMessage        `json:"client"`
	MockEligibility map[string]Eligibility `json:"mockEligibility"`
}

// StepFunc is a job step (the signature of jobs.StepFunc; this package does not import jobs, so
// internal/store can implement Store without an import cycle).
type StepFunc = func(ctx context.Context, args map[string]any) (map[string]any, error)
