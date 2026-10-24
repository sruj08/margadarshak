package ports

import (
	"encoding/json"
)

// Ops of POST /clip/agreement.
const (
	OpAgreement   = "agreement"
	OpAdjudicate  = "adjudicate"
	OpFinalWindow = "final_window"
	OpScoringClip = "scoring_clip"
)

// RaterMark is one hazard mark of a blind rating (clip-pipeline RaterMarkSchema).
type RaterMark struct {
	HazardType string `json:"hazardType"`
	AMs        int    `json:"aMs"`
	BMs        int    `json:"bMs"`
	Cue        string `json:"cue,omitempty"`
	Occlusion  *bool  `json:"occlusion,omitempty"`
}

// RaterSubmission is one rater's blind submission (pseudonymous rater ID, never a name).
type RaterSubmission struct {
	Rater       string      `json:"rater"` // e.g. "rater-07"
	ClipID      string      `json:"clipId"`
	Version     int         `json:"version"`
	Marks       []RaterMark `json:"marks"`
	SubmittedAt string      `json:"submittedAt"` // RFC 3339
}

// ProposedWindow is an M-06 proposal shown after both raters submitted.
type ProposedWindow struct {
	AMs        int    `json:"aMs"`
	BMs        int    `json:"bMs"`
	HazardType string `json:"hazardType"`
	Why        string `json:"why"`
}

// AdjudicationDecision is the third person's verdict on one cluster.
type AdjudicationDecision struct {
	ClusterID string     `json:"clusterId"` // "c1"
	Verdict   string     `json:"verdict"`   // hazard | not_hazard
	Mark      *RaterMark `json:"mark,omitempty"`
}

// AdjudicationInput is clip-pipeline's AdjudicationInputSchema.
type AdjudicationInput struct {
	Adjudicator string                 `json:"adjudicator"`
	DecidedAt   string                 `json:"decidedAt"`
	ReasonCode  string                 `json:"reasonCode"`
	Decisions   []AdjudicationDecision `json:"decisions"`
}

// WindowMark is one {aMs, bMs} mark for final_window.
type WindowMark struct {
	AMs int `json:"aMs"`
	BMs int `json:"bMs"`
}

// ClipAgreementRequest is the discriminated union of POST /clip/agreement. Set Op and the fields
// that op takes (see the constructors); the others must stay empty.
type ClipAgreementRequest struct {
	Op           string             `json:"op"`
	Now          int64              `json:"now"`
	RaterA       *RaterSubmission   `json:"raterA,omitempty"`       // agreement, adjudicate
	RaterB       *RaterSubmission   `json:"raterB,omitempty"`       // agreement, adjudicate
	DurationMs   *int               `json:"durationMs,omitempty"`   // agreement, adjudicate
	Proposals    []ProposedWindow   `json:"proposals,omitempty"`    // agreement, adjudicate
	Adjudication *AdjudicationInput `json:"adjudication,omitempty"` // adjudicate
	Marks        []WindowMark       `json:"marks,omitempty"`        // final_window: 2 or 3
	Clip         json.RawMessage    `json:"clip,omitempty"`         // scoring_clip: clip.json
}

// AgreementOp builds an "agreement" request.
func AgreementOp(a, b RaterSubmission) ClipAgreementRequest {
	return ClipAgreementRequest{Op: OpAgreement, RaterA: &a, RaterB: &b}
}

// AdjudicateOp builds an "adjudicate" request.
func AdjudicateOp(a, b RaterSubmission, adj AdjudicationInput) ClipAgreementRequest {
	return ClipAgreementRequest{Op: OpAdjudicate, RaterA: &a, RaterB: &b, Adjudication: &adj}
}

// FinalWindowOp builds a "final_window" request.
func FinalWindowOp(marks ...WindowMark) ClipAgreementRequest {
	return ClipAgreementRequest{Op: OpFinalWindow, Marks: marks}
}

// ScoringClipOp builds a "scoring_clip" request from a stored clip.json.
func ScoringClipOp(clip json.RawMessage) ClipAgreementRequest {
	return ClipAgreementRequest{Op: OpScoringClip, Clip: clip}
}

// Window is a final hazard window (ms; frame-snapped at 30 fps).
type Window struct {
	AMs float64 `json:"aMs"`
	BMs float64 `json:"bMs"`
}

// FinalHazard is one agreed hazard.
type FinalHazard struct {
	HazardID     string   `json:"hazardId"`
	HazardType   string   `json:"hazardType"`
	Window       Window   `json:"window"`
	RaterCount   float64  `json:"raterCount"`
	DeltaOnsetMs float64  `json:"deltaOnsetMs"`
	DeltaEndMs   float64  `json:"deltaEndMs"`
	Adjudicated  bool     `json:"adjudicated"`
	Occlusion    bool     `json:"occlusion"`
	Cues         []string `json:"cues"`
}

// AgreementMetrics are the inter-rater metrics (D-22).
type AgreementMetrics struct {
	Matched            float64  `json:"matched"`
	MedianDeltaOnsetMs *float64 `json:"medianDeltaOnsetMs"`
	MedianDeltaEndMs   *float64 `json:"medianDeltaEndMs"`
	MeanIoU            *float64 `json:"meanIoU"`
	KappaPerSecond     *float64 `json:"kappaPerSecond"`
}

// ClipAgreement is clip-pipeline's ClipAgreement. The curator-UI detail (pairs, clusters, ...) is
// kept raw for storage; the decision fields are typed.
type ClipAgreement struct {
	ClipID               string           `json:"clipId"`
	Version              int              `json:"version"`
	Raters               []string         `json:"raters"`
	Pairs                json.RawMessage  `json:"pairs"`
	OnlyA                json.RawMessage  `json:"onlyA"`
	OnlyB                json.RawMessage  `json:"onlyB"`
	UnconfirmedProposals json.RawMessage  `json:"unconfirmedProposals"`
	Clusters             json.RawMessage  `json:"clusters"`
	Metrics              AgreementMetrics `json:"metrics"`
	Reasons              []string         `json:"reasons"`
	Accepted             bool             `json:"accepted"`
	NeedsThirdRater      bool             `json:"needsThirdRater"`
	FinalHazards         []FinalHazard    `json:"finalHazards"`
	Options              json.RawMessage  `json:"options"`
}

// AdjudicationResult is the outcome of the third person's decisions.
type AdjudicationResult struct {
	Resolved bool          `json:"resolved"`
	Hazards  []FinalHazard `json:"hazards"`
	Dropped  []string      `json:"dropped"`
	Issues   []string      `json:"issues"`
}

// ClipAgreementResponse is the union answer; the fields of Op are set.
type ClipAgreementResponse struct {
	Op           string              `json:"op"`
	Agreement    *ClipAgreement      `json:"agreement,omitempty"`
	Adjudication *AdjudicationResult `json:"adjudication,omitempty"`
	Window       *Window             `json:"window,omitempty"`
	ScoringClip  json.RawMessage     `json:"scoringClip,omitempty"` // game-core NazarClip, sent inline to /verify
}

// ClipManifestsRequest is POST /clip/manifests.
type ClipManifestsRequest struct {
	Now          int64             `json:"now"`
	Clips        []json.RawMessage `json:"clips"` // ≤ 200 clip.json
	FlashPassed  map[string]bool   `json:"flashPassed,omitempty"`
	Tenant       string            `json:"tenant,omitempty"`
	Resolution   string            `json:"resolution,omitempty"` // 360p | 480p
	MediaBaseURL string            `json:"mediaBaseUrl,omitempty"`
	Include      []string          `json:"include,omitempty"` // bank, client
}

// ClientMedia is one rendition of a client manifest entry.
type ClientMedia struct {
	Res    string  `json:"res"`
	Bytes  float64 `json:"bytes"`
	SHA256 string  `json:"sha256"`
	URL    string  `json:"url"` // bare object key when no mediaBaseUrl was given
}

// ClientEntry is an API-37 entry: an allowlist with no hazard information at all.
type ClientEntry struct {
	Ref               string        `json:"ref"`
	ClipID            string        `json:"clipId"`
	Version           int           `json:"version"`
	DurationMs        float64       `json:"durationMs"`
	TenantTags        []string      `json:"tenantTags"`
	City              string        `json:"city"`
	RoadType          string        `json:"roadType"`
	TimeOfDay         string        `json:"timeOfDay"`
	Weather           string        `json:"weather"`
	Pov               string        `json:"pov"`
	Modules           []string      `json:"modules"`
	Licence           string        `json:"licence"`
	Attribution       string        `json:"attribution"`
	Media             []ClientMedia `json:"media"`
	TotalBytes        float64       `json:"totalBytes"`
	MockEligible      bool          `json:"mockEligible"`
	CuratorDifficulty *float64      `json:"curatorDifficulty,omitempty"`
}

// ClientManifest is the API-37 manifest.
type ClientManifest struct {
	Schema      string             `json:"schema"`
	GeneratedAt string             `json:"generatedAt"`
	Licence     string             `json:"licence"`
	Attribution string             `json:"attribution"`
	TotalBytes  map[string]float64 `json:"totalBytes"`
	Digest      string             `json:"digest"`
	Clips       []ClientEntry      `json:"clips"`
}

// Eligibility is the Kerala-mock eligibility of one clip ref ("JMU-0012@3").
type Eligibility struct {
	Eligible bool     `json:"eligible"`
	Reasons  []string `json:"reasons"`
}

// ClipManifestsResponse is the 200 body of /clip/manifests. Bank (the CC-BY record with final
// windows) is published as a file, so it stays raw; it is JSON null when not requested.
type ClipManifestsResponse struct {
	GeneratedAt     string                 `json:"generatedAt"`
	Bank            json.RawMessage        `json:"bank"`
	Client          *ClientManifest        `json:"client"`
	MockEligibility map[string]Eligibility `json:"mockEligibility"`
}
