package ports

import (
	"encoding/json"
	"fmt"
)

// Analysis kinds for VerifyRequest.Analysis (Nazar only).
const (
	AnalysisNazarClips       = "nazar_clips"        // product rule, kerala_5band
	AnalysisNazarClipsLinear = "nazar_clips_linear" // field-study rule, field_kit_linear
)

// VerifyRequest mirrors the strict Zod `VerifyRequest` in services/score-verifier/src/verify.ts.
type VerifyRequest struct {
	SID              string          `json:"sid"`
	GameID           string          `json:"gameId"`
	GameVersion      string          `json:"gameVersion"`
	ScoringVersion   string          `json:"scoringVersion"`
	Mode             string          `json:"mode"`
	Difficulty       int             `json:"difficulty"`
	Seed             uint32          `json:"seed"`
	SeedOrigin       string          `json:"seedOrigin"`
	Items            []SessionItem   `json:"items"`
	Tenant           string          `json:"tenant"`
	RulePackVersion  string          `json:"rulePackVersion"`
	TelemetryVersion int             `json:"telemetryVersion,omitempty"` // 1 (the default when omitted)
	Encoding         string          `json:"encoding,omitempty"`         // "mdr1" (default) | "mdr1+gzip"
	Inputs           string          `json:"inputs"`                     // base64 replay, ≤ 524288 chars
	Digest           string          `json:"digest"`                     // sha256:<hex> of the canonical events
	EventCount       int             `json:"eventCount"`
	Context          *VerifyContext  `json:"context,omitempty"`
	ClientResult     json.RawMessage `json:"clientResult,omitempty"` // needs score.pct and findings[].findingId
	Hints            *VerifyHints    `json:"hints,omitempty"`
	Content          *InlineContent  `json:"content,omitempty"`
	Analysis         []string        `json:"analysis,omitempty"`
}

// SessionItem is game-core's SessionItem.
type SessionItem struct {
	Ref            string `json:"ref"`
	ContentVersion string `json:"contentVersion"`
	SHA256         string `json:"sha256,omitempty"`
}

// VerifyContext is the optional non-scoring context (defaults apply to omitted fields).
type VerifyContext struct {
	UserBand       string   `json:"userBand,omitempty"`
	Locale         string   `json:"locale,omitempty"`
	A11yModes      []string `json:"a11yModes,omitempty"`
	DeviceClass    string   `json:"deviceClass,omitempty"`
	Offline        *bool    `json:"offline,omitempty"`
	ServerStartISO *string  `json:"serverStartIso,omitempty"`
}

// VerifyHints is knowledge only the API has (GAME_SDK §6.5).
type VerifyHints struct {
	SeenClip       *bool `json:"seenClip,omitempty"`
	SessionExpired *bool `json:"sessionExpired,omitempty"`
}

// InlineContent carries 1–48 scoring documents (clip documents for Nazar). Go stores and
// forwards them; each must identify itself (clipId+version, trackId+version, qref, rule_id or
// a {ref, doc} envelope).
type InlineContent struct {
	Items []json.RawMessage `json:"items"`
}

// VerifyResponse is the 200 body of POST /verify. Result is stored and forwarded verbatim;
// Summary is the typed view of the fields Go reads.
type VerifyResponse struct {
	Result        json.RawMessage          `json:"result"`
	Digest        string                   `json:"digest"`
	EventsDigest  string                   `json:"eventsDigest"`
	Comparison    *Comparison              `json:"comparison"`
	ServerChecked bool                     `json:"serverChecked"`
	Analysis      map[string]NazarAnalysis `json:"analysis,omitempty"`

	Summary ResultSummary `json:"-"`
}

// Comparison is game-core's ComparisonResult (client preview vs server result).
type Comparison struct {
	Match           bool    `json:"match"`
	ClientPct       float64 `json:"clientPct"`
	ServerPct       float64 `json:"serverPct"`
	DeltaPct        float64 `json:"deltaPct"`
	FindingIDsMatch bool    `json:"findingIdsMatch"`
}

// ResultSummary is the subset of SessionResult (GAME_SDK §10) Go reads. Unknown fields are
// ignored here on purpose: the full result travels as json.RawMessage.
type ResultSummary struct {
	SID            string `json:"sid"`
	GameID         string `json:"gameId"`
	GameVersion    string `json:"gameVersion"`
	ScoringVersion string `json:"scoringVersion"`
	SeedOrigin     string `json:"seedOrigin"`
	Mode           string `json:"mode"`
	Difficulty     int    `json:"difficulty"`
	Score          struct {
		Raw        float64 `json:"raw"`
		Max        float64 `json:"max"`
		Pct        float64 `json:"pct"`
		Passed     *bool   `json:"passed"`
		CapApplied *string `json:"capApplied"`
	} `json:"score"`
	Findings  []FindingSummary `json:"findings"`
	Integrity Integrity        `json:"integrity"`
}

// FindingSummary is the part of a Finding Go reads.
type FindingSummary struct {
	FindingID string `json:"findingId"`
	Critical  bool   `json:"critical"`
	ItemRef   string `json:"itemRef,omitempty"`
}

// Integrity is SessionResult.integrity.
type Integrity struct {
	Flags       []string `json:"flags"`
	Trust       float64  `json:"trust"`
	TimingMode  string   `json:"timingMode"`
	Provisional bool     `json:"provisional"`
}

// HasFlag reports whether the integrity flags contain f.
func (i Integrity) HasFlag(f string) bool {
	for _, x := range i.Flags {
		if x == f {
			return true
		}
	}
	return false
}

// ParseResult reads the typed summary of a SessionResult document.
func ParseResult(raw json.RawMessage) (ResultSummary, error) {
	var s ResultSummary
	if err := json.Unmarshal(raw, &s); err != nil {
		return s, err
	}
	if s.GameID == "" || s.Integrity.TimingMode == "" {
		return s, fmt.Errorf("compute: result lacks gameId or integrity")
	}
	return s, nil
}

// NazarAnalysis is one requested analysis kind (verify.ts NazarAnalysis).
type NazarAnalysis struct {
	Rule  string         `json:"rule"` // "kerala_5band" | "field_kit_linear"
	Clips []ClipAnalysis `json:"clips"`
}

// ClipAnalysis is one clip's analysis (verify.ts ClipAnalysisJson).
type ClipAnalysis struct {
	Ordinal         int              `json:"ordinal"`
	Ref             string           `json:"ref"`
	Voided          *string          `json:"voided"` // "pattern" | "INT_TAB_HIDDEN" | "INT_CLOCK_DRIFT" | null
	Taps            int              `json:"taps"`
	MaxTapsInWindow int              `json:"maxTapsInWindow"`
	EarlyTaps       int              `json:"earlyTaps"`
	FalseAlarms     int              `json:"falseAlarms"`
	Marks           float64          `json:"marks"`
	Hazards         []HazardAnalysis `json:"hazards"`
}

// HazardAnalysis is one hazard of one clip (verify.ts HazardAnalysis). Windows are never echoed.
type HazardAnalysis struct {
	HazardID   string   `json:"hazardId"`
	HazardType string   `json:"hazardType"`
	Credit     float64  `json:"credit"`
	Band       *int     `json:"band"`
	TapMt      *float64 `json:"tapMt"`
	LateS      *float64 `json:"lateS"`
	Metres     *float64 `json:"metres"`
	Prediction *string  `json:"prediction"`
}
