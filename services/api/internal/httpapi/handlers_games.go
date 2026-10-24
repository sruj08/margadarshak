package httpapi

// Game sessions (API-34 start, API-35 complete, the replay endpoint) and the Nazar clip manifest
// (API-37). The envelopes are snake_case; ctx (SessionContext), replay (ReplayPackage) and
// result (SessionResult) keep game-core's camelCase (decision D-02). Hazard windows reach a
// client only as learn/practice `reveal` (D-05) or through the replay endpoint after completion.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/games"
	"github.com/sruj08/margadarshak/services/api/internal/gamify"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/learner"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/study"
)

func init() {
	problemTitles["SESSION_VOIDED"] = "This session could not be checked"
	problemTitles["STUDY_UNAVAILABLE"] = "This study session is not available"
	problemTitles["POOL_TOO_SMALL"] = "Not enough items for this session"
}

// ---- Request bodies ---------------------------------------------------------------------------

// gamesStartIn is GameSessionCreate (additionalProperties: false; decodeJSON is strict).
type gamesStartIn struct {
	Mode             string        `json:"mode"`
	FamilyMemberID   *string       `json:"family_member_id,omitempty"`
	Difficulty       *int          `json:"difficulty,omitempty"`
	DrillID          *string       `json:"drill_id,omitempty"`
	Study            *gamesStudyIn `json:"study,omitempty"`
	PairSessionID    *string       `json:"pair_session_id,omitempty"`
	A11yModes        []string      `json:"a11y_modes,omitempty"`
	TextScale        *float64      `json:"text_scale,omitempty"`
	Haptics          *bool         `json:"haptics,omitempty"`
	Locale           *string       `json:"locale,omitempty"`
	DeviceClass      *string       `json:"device_class,omitempty"`
	OfflineStartedAt *string       `json:"offline_started_at,omitempty"`
	OfflineSeed      *int64        `json:"offline_seed,omitempty"`
	OfflineItems     []string      `json:"offline_items,omitempty"`
}

type gamesStudyIn struct {
	ParticipantCode string `json:"participant_code"`
	Phase           string `json:"phase"`
}

// gamesCompleteIn is GameSessionComplete. client_result stays raw (the games package compares
// it and keeps it as the provisional preview); replay is the camelCase ReplayPackage.
type gamesCompleteIn struct {
	ClientResult json.RawMessage `json:"client_result"`
	Replay       *gamesReplayIn  `json:"replay"`
	Commentary   json.RawMessage `json:"commentary,omitempty"`
}

type gamesReplayIn struct {
	TelemetryVersion int    `json:"telemetryVersion"`
	Encoding         string `json:"encoding"`
	Seed             *int64 `json:"seed,omitempty"`
	Inputs           string `json:"inputs"`
	Digest           string `json:"digest"`
	EventCount       int    `json:"eventCount"`
}

var (
	gamesMemberRe      = regexp.MustCompile(`^fam_[0-9A-Z]{6,26}$`)
	gamesDrillRe       = regexp.MustCompile(`^DR-[A-Z]{2,3}-[A-Z0-9_-]+$`)
	gamesParticipantRe = regexp.MustCompile(`^P-\d{3,4}$`)
	gamesGameIDs       = []string{"nazar", "junction_scan", "stopping_distance", "blind_spot", "track_twin", "night_glare",
		"hill_road", "helmet_fit", "golden_hour", "ll_sim"}
	gamesA11yModes = []string{"no_audio", "colour_safe", "one_hand", "reduced_motion", "tap_only", "screen_reader_alt",
		"large_text", "safe_luminance"}
)

// gamesValidateStart checks GameSessionCreate; it returns the failing pointer and code.
func gamesValidateStart(in *gamesStartIn) (string, string) {
	switch {
	case !slices.Contains([]string{games.ModeLearn, games.ModePractice, games.ModeMock, games.ModePair}, in.Mode):
		return "/mode", "invalid_enum"
	case in.FamilyMemberID != nil && !gamesMemberRe.MatchString(*in.FamilyMemberID):
		return "/family_member_id", "invalid_pattern"
	case in.Difficulty != nil && (*in.Difficulty < 1 || *in.Difficulty > 5):
		return "/difficulty", "out_of_range"
	case in.DrillID != nil && (len(*in.DrillID) > 48 || !gamesDrillRe.MatchString(*in.DrillID)):
		return "/drill_id", "invalid_pattern"
	case in.PairSessionID != nil && uuid.Validate(*in.PairSessionID) != nil:
		return "/pair_session_id", "invalid_format"
	case len(in.A11yModes) > 8:
		return "/a11y_modes", "too_many"
	case in.TextScale != nil && (*in.TextScale < 1 || *in.TextScale > 2):
		return "/text_scale", "out_of_range"
	case in.Locale != nil && *in.Locale != "en" && *in.Locale != "hi":
		return "/locale", "invalid_enum"
	case in.DeviceClass != nil && !slices.Contains([]string{"low", "mid", "high"}, *in.DeviceClass):
		return "/device_class", "invalid_enum"
	case in.OfflineStartedAt != nil || in.OfflineSeed != nil || len(in.OfflineItems) > 0:
		// The games package cannot register a session played offline yet (D-29 is P2 contract only).
		return "/offline_started_at", "offline_registration_unavailable"
	}
	seen := map[string]bool{}
	for i, m := range in.A11yModes {
		if !slices.Contains(gamesA11yModes, m) {
			return fmt.Sprintf("/a11y_modes/%d", i), "invalid_enum"
		}
		if seen[m] {
			return fmt.Sprintf("/a11y_modes/%d", i), "duplicate"
		}
		seen[m] = true
	}
	if st := in.Study; st != nil {
		switch {
		case !gamesParticipantRe.MatchString(st.ParticipantCode):
			return "/study/participant_code", "invalid_pattern"
		case !slices.Contains([]string{"ll_mock", "test", "fresh"}, st.Phase):
			return "/study/phase", "invalid_enum"
		case in.FamilyMemberID != nil:
			return "/study", "not_for_family_member"
		}
	}
	return "", ""
}

// ---- Response bodies --------------------------------------------------------------------------

type gamesCue struct {
	En string `json:"en,omitempty"`
	Hi string `json:"hi,omitempty"`
}

// gamesHazardWindow is HazardWindow.
type gamesHazardWindow struct {
	HazardID         string    `json:"hazard_id"`
	HazardType       string    `json:"hazard_type"`
	AMs              int       `json:"a_ms"`
	BMs              int       `json:"b_ms"`
	FullMarksUntilMs int       `json:"full_marks_until_ms"`
	Occlusion        bool      `json:"occlusion"`
	Cue              *gamesCue `json:"cue,omitempty"`
}

// gamesReveal is ItemReveal.
type gamesReveal struct {
	SpeedKmhEst *float64            `json:"speed_kmh_est,omitempty"`
	Hazards     []gamesHazardWindow `json:"hazards"`
}

// gamesItemOut is GameSessionItem.
type gamesItemOut struct {
	ItemRef        string       `json:"item_ref"`
	Kind           string       `json:"kind"`
	ContentVersion string       `json:"content_version"`
	AssetURL       string       `json:"asset_url,omitempty"`
	SHA256         string       `json:"sha256,omitempty"`
	Bytes          *int64       `json:"bytes,omitempty"`
	Reveal         *gamesReveal `json:"reveal,omitempty"`
	Origin         string       `json:"origin,omitempty"` // clips: filmed | ai_generated (ADR-0013)
}

type gamesStudyOut struct {
	ParticipantCode string `json:"participant_code"`
	Phase           string `json:"phase"`
	Form            string `json:"form,omitempty"`
}

// gamesStartOut is GameSessionStart.
type gamesStartOut struct {
	SessionID       string               `json:"session_id"`
	GameID          string               `json:"game_id"`
	ManifestVersion string               `json:"manifest_version"`
	ScoringVersion  string               `json:"scoring_version"`
	ContentVersion  string               `json:"content_version,omitempty"`
	Seed            uint32               `json:"seed"`
	SeedOrigin      string               `json:"seed_origin"`
	Difficulty      int                  `json:"difficulty"`
	Mode            string               `json:"mode"`
	Items           []gamesItemOut       `json:"items"`
	Ctx             games.SessionContext `json:"ctx"`
	Study           *gamesStudyOut       `json:"study,omitempty"`
	LabelKey        string               `json:"label_key"`
	ExpiresAt       string               `json:"expires_at"`
}

type gamesPassRule struct {
	Source string `json:"source"`
	Ref    string `json:"ref"`
}

type gamesComponent struct {
	ID         string  `json:"id"`
	Value      float64 `json:"value"`
	Max        float64 `json:"max"`
	Weight     float64 `json:"weight"`
	ExplainKey string  `json:"explainKey"`
}

// gamesScoreOut is SessionScore (camelCase, strict).
type gamesScoreOut struct {
	Raw        float64          `json:"raw"`
	Max        float64          `json:"max"`
	Pct        float64          `json:"pct"`
	Passed     *bool            `json:"passed"`
	PassRule   *gamesPassRule   `json:"passRule"`
	Components []gamesComponent `json:"components"`
	CapApplied *string          `json:"capApplied"`
}

// gamesFinding is Finding (camelCase, strict).
type gamesFinding struct {
	FindingID string         `json:"findingId"`
	Severity  float64        `json:"severity"`
	Critical  bool           `json:"critical"`
	RuleIDs   []string       `json:"ruleIds"`
	SkillID   string         `json:"skillId"`
	DrillIDs  []string       `json:"drillIds"`
	Facts     map[string]any `json:"facts"`
	ItemRef   string         `json:"itemRef,omitempty"`
}

// gamesIntegrity is IntegrityReport (camelCase, strict).
type gamesIntegrity struct {
	Flags       []string `json:"flags"`
	Trust       float64  `json:"trust"`
	TimingMode  string   `json:"timingMode"`
	Provisional bool     `json:"provisional"`
}

type gamesHazardAnalysisOut struct {
	HazardID   string   `json:"hazard_id"`
	HazardType string   `json:"hazard_type"`
	Credit     float64  `json:"credit"`
	Band       *int     `json:"band"`
	TapMt      *int64   `json:"tap_mt"`
	LateS      *float64 `json:"late_s"`
	Metres     *float64 `json:"metres"`
}

// gamesClipAnalysisOut is NazarClipAnalysis (snake_case of the verifier's analysis).
type gamesClipAnalysisOut struct {
	Ordinal         int                      `json:"ordinal"`
	ItemRef         string                   `json:"item_ref"`
	Voided          *string                  `json:"voided"`
	Taps            int                      `json:"taps"`
	MaxTapsInWindow int                      `json:"max_taps_in_window"`
	EarlyTaps       int                      `json:"early_taps"`
	FalseAlarms     int                      `json:"false_alarms"`
	Marks           float64                  `json:"marks"`
	Hazards         []gamesHazardAnalysisOut `json:"hazards"`
}

// gamesNazarOut is NazarSessionFacts.
type gamesNazarOut struct {
	Rule              string                 `json:"rule"`
	Analysis          []gamesClipAnalysisOut `json:"analysis"`
	ScoreEligible     bool                   `json:"score_eligible"`
	IneligibleReasons []string               `json:"ineligible_reasons"`
}

type gamesNazarScoreOut struct {
	Score        *float64 `json:"score"`
	MocksCounted int      `json:"mocks_counted"`
}

// gamesCheckedOut is CheckedSessionResult.
type gamesCheckedOut struct {
	SessionID      string              `json:"session_id"`
	GameID         string              `json:"game_id"`
	ServerChecked  bool                `json:"server_checked"`
	Provisional    bool                `json:"provisional"`
	ClientScorePct *float64            `json:"client_score_pct,omitempty"`
	ServerScorePct *float64            `json:"server_score_pct"`
	Mismatch       bool                `json:"mismatch"`
	Score          gamesScoreOut       `json:"score"`
	Findings       []gamesFinding      `json:"findings"`
	Integrity      gamesIntegrity      `json:"integrity"`
	Result         json.RawMessage     `json:"result,omitempty"`
	Nazar          *gamesNazarOut      `json:"nazar,omitempty"`
	XPAwarded      *int                `json:"xp_awarded"`
	BadgesAwarded  []string            `json:"badges_awarded"`
	NazarScore     *gamesNazarScoreOut `json:"nazar_score,omitempty"`
}

type gamesReplayClipOut struct {
	Ordinal     int                   `json:"ordinal"`
	ItemRef     string                `json:"item_ref"`
	Origin      string                `json:"origin,omitempty"`
	AssetURL    string                `json:"asset_url,omitempty"`
	DurationMs  int                   `json:"duration_ms"`
	SpeedKmhEst *float64              `json:"speed_kmh_est,omitempty"`
	Windows     []gamesHazardWindow   `json:"windows"`
	Analysis    *gamesClipAnalysisOut `json:"analysis,omitempty"`
}

// gamesReplayOut is GameSessionReplay.
type gamesReplayOut struct {
	SessionID string               `json:"session_id"`
	GameID    string               `json:"game_id"`
	Status    string               `json:"status"`
	Rule      string               `json:"rule"`
	Clips     []gamesReplayClipOut `json:"clips"`
}

type gamesClipMedia struct {
	Res    string `json:"res"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
	URL    string `json:"url"`
}

// gamesClipManifestItem is ClipManifestItem: an allowlist with no window, hazard, cue or speed field.
type gamesClipManifestItem struct {
	ItemRef           string           `json:"item_ref"`
	ClipID            string           `json:"clip_id"`
	Version           int              `json:"version"`
	DurationMs        int              `json:"duration_ms"`
	TenantTags        []string         `json:"tenant_tags"`
	RoadType          string           `json:"road_type,omitempty"`
	TimeOfDay         string           `json:"time_of_day,omitempty"`
	Weather           string           `json:"weather,omitempty"`
	POV               string           `json:"pov,omitempty"`
	Licence           string           `json:"licence"`
	Attribution       string           `json:"attribution"`
	Media             []gamesClipMedia `json:"media"`
	TotalBytes        int64            `json:"total_bytes"`
	MockEligible      bool             `json:"mock_eligible"`
	CuratorDifficulty *int             `json:"curator_difficulty,omitempty"`
	PosterURL         string           `json:"poster_url,omitempty"`
}

type gamesClipPageOut struct {
	ManifestVersion string                  `json:"manifest_version"`
	Licence         string                  `json:"licence"`
	Attribution     string                  `json:"attribution"`
	TotalBytes      int64                   `json:"total_bytes"`
	Items           []gamesClipManifestItem `json:"items"`
	NextCursor      *string                 `json:"next_cursor"`
}

// ---- Errors -----------------------------------------------------------------------------------

// gamesError maps games-package errors to problems; internal text never reaches the client.
func (s *Server) gamesError(w http.ResponseWriter, r *http.Request, err error) {
	var rej *games.RejectedError
	switch {
	case errors.As(err, &rej):
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "REPLAY_REJECTED",
			Detail: "the score verifier rejected this replay (" + rej.ProblemType + "); the session counts for nothing"})
	case errors.Is(err, games.ErrNotFound):
		notFound(w, r)
	case errors.Is(err, games.ErrUnsupportedGame):
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Detail: "this game is not available",
			Errors: []FieldError{{Pointer: "/gameId", Code: "unsupported_game"}}})
	case errors.Is(err, games.ErrUnsupportedMode):
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Detail: "this mode is not available for this game",
			Errors: []FieldError{{Pointer: "/mode", Code: "unsupported_mode"}}})
	case errors.Is(err, games.ErrNoUnseenClips):
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "NO_UNSEEN_CLIPS",
			Detail: "Every mock-eligible clip has been seen; practice mode still works"})
	case errors.Is(err, games.ErrPoolTooSmall):
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "POOL_TOO_SMALL", Detail: "not enough items for this session yet"})
	case errors.Is(err, games.ErrDigestConflict):
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "SESSION_ALREADY_COMPLETED",
			Detail: "this session was already submitted with a different replay"})
	case errors.Is(err, games.ErrReplayTooLarge):
		writeProblem(w, r, Problem{Status: http.StatusRequestEntityTooLarge, Code: "PAYLOAD_TOO_LARGE", Detail: "the replay is larger than 512 KB"})
	case errors.Is(err, games.ErrInvalidReplay):
		ptr := "/replay"
		if _, field, ok := strings.Cut(err.Error(), games.ErrInvalidReplay.Error()+": "); ok {
			if field == "clientResult" {
				ptr = "/client_result"
			} else {
				ptr += "/" + field
			}
		}
		validation(w, r, ptr, "invalid")
	case errors.Is(err, games.ErrSessionVoided):
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "SESSION_VOIDED", Detail: "this session's replay was rejected earlier"})
	case errors.Is(err, games.ErrStudyUnavailable):
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "STUDY_UNAVAILABLE",
			Detail: "this study phase is not available for the participant"})
	case ports.IsComputeUnavailable(err):
		computeUnavailable(w, r)
	default:
		s.deps.Log.ErrorContext(r.Context(), "game session error", "err", err)
		internalError(w, r)
	}
}

// ---- API-34 -----------------------------------------------------------------------------------

// StartGameSession is API-34: server seed, items, versions and the game's SessionContext.
func (s *Server) StartGameSession(w http.ResponseWriter, r *http.Request, gameId gen.GameId, params gen.StartGameSessionParams) {
	if s.deps.Games == nil {
		serviceMissing(w, r)
		return
	}
	if !slices.Contains(gamesGameIDs, string(gameId)) {
		notFound(w, r)
		return
	}
	var in gamesStartIn
	if !decodeJSON(w, r, &in, false) {
		return
	}
	if ptr, code := gamesValidateStart(&in); ptr != "" {
		validation(w, r, ptr, code)
		return
	}
	member := ""
	if in.FamilyMemberID != nil {
		member = *in.FamilyMemberID
	}
	subj, ok := s.learnerFor(w, r, member)
	if !ok {
		return
	}
	// Pair mode for a minor needs the parent's pair_mode extra (D-06, D-09). The games package
	// refuses pair mode until squads share a seed, so a permitted request still ends in 422.
	if in.Mode == games.ModePair && subj.Minor && !s.requireExtra(w, r, subj, learner.ExtraPairMode) {
		return
	}
	req := games.StartRequest{Subject: subj, GameID: string(gameId), Mode: in.Mode, A11yModes: in.A11yModes}
	req.Locale = gamesLocale(in.Locale, params.AcceptLanguage)
	if in.TextScale != nil {
		req.TextScale = *in.TextScale
	}
	if in.Haptics != nil {
		req.Haptics = *in.Haptics
	}
	if in.DeviceClass != nil {
		req.DeviceClass = *in.DeviceClass
	}
	var studyOut *gamesStudyOut
	if in.Study != nil {
		form, ok := s.gamesStudyParticipant(w, r, subj, in.Study.ParticipantCode)
		if !ok {
			return
		}
		req.Study = &games.StudyRef{Participant: in.Study.ParticipantCode, Phase: in.Study.Phase}
		studyOut = &gamesStudyOut{ParticipantCode: in.Study.ParticipantCode, Phase: in.Study.Phase, Form: form}
	}
	started, err := s.deps.Games.Start(r.Context(), req)
	if err != nil {
		s.gamesError(w, r, err)
		return
	}
	out, err := s.gamesStartOut(r.Context(), started)
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "game session start: response", "err", err)
		internalError(w, r)
		return
	}
	out.Study = studyOut
	writeJSON(w, http.StatusCreated, out)
}

// gamesLocale is the request locale, else Accept-Language (hi…), else en.
func gamesLocale(locale *string, accept *gen.AcceptLanguage) string {
	if locale != nil {
		return *locale
	}
	if accept != nil && strings.HasPrefix(strings.ToLower(strings.TrimSpace(*accept)), "hi") {
		return "hi"
	}
	return "en"
}

// gamesStudyParticipant checks that the participant was enrolled by the caller's own session and
// has not withdrawn; it returns the participant's form.
func (s *Server) gamesStudyParticipant(w http.ResponseWriter, r *http.Request, subj learner.Subject, code string) (string, bool) {
	if s.deps.StudyStore == nil {
		serviceMissing(w, r)
		return "", false
	}
	p, err := s.deps.StudyStore.GetParticipant(r.Context(), subj.Tenant, code)
	switch {
	case errors.Is(err, study.ErrNotFound):
		writeProblem(w, r, Problem{Status: http.StatusNotFound, Code: "NOT_FOUND", Detail: "unknown study participant"})
		return "", false
	case err != nil:
		s.deps.Log.ErrorContext(r.Context(), "study participant lookup failed", "err", err)
		internalError(w, r)
		return "", false
	case p.ApplicantID != subj.ApplicantID || subj.MemberID != nil:
		// Never reveal that another session's participant code exists.
		writeProblem(w, r, Problem{Status: http.StatusNotFound, Code: "NOT_FOUND", Detail: "unknown study participant"})
		return "", false
	case p.WithdrawnAt != nil:
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "STUDY_UNAVAILABLE", Detail: "this participant has withdrawn"})
		return "", false
	}
	return p.Form, true
}

// gamesStartOut builds GameSessionStart: items in snake_case, `reveal` windows for learn and
// practice clips only (never mock, pair or study; D-05), ctx verbatim.
func (s *Server) gamesStartOut(ctx context.Context, st *games.Started) (*gamesStartOut, error) {
	sess := st.Session
	out := &gamesStartOut{SessionID: sess.ID.String(), GameID: sess.GameID, ManifestVersion: sess.GameVersion,
		ScoringVersion: sess.ScoringVersion, Seed: sess.Seed, SeedOrigin: sess.SeedOrigin, Difficulty: sess.Difficulty,
		Mode: sess.Mode, Items: make([]gamesItemOut, 0, len(st.Items)), Ctx: st.Context, LabelKey: st.LabelKey,
		ExpiresAt: sess.ExpiresAt.UTC().Format(time.RFC3339)}
	if s.deps.Games.Catalog != nil {
		out.ContentVersion = s.deps.Games.Catalog.ContentVersion
	}
	reveal := (sess.Mode == games.ModeLearn || sess.Mode == games.ModePractice) && sess.Cohort == ""
	var info map[string]gamesClipInfo
	if reveal {
		var refs []string
		for _, it := range st.Items {
			if it.Kind == "clip" {
				refs = append(refs, it.Ref)
			}
		}
		if len(refs) > 0 {
			var err error
			if info, err = s.gamesClipInfos(ctx, refs); err != nil {
				return nil, err
			}
		}
	}
	for _, it := range st.Items {
		o := gamesItemOut{ItemRef: it.Ref, Kind: it.Kind, ContentVersion: it.ContentVersion}
		if it.AssetURL != "" {
			n := it.Bytes
			o.AssetURL, o.SHA256, o.Bytes = it.AssetURL, it.SHA256, &n
		}
		if ci, ok := info[it.Ref]; ok && reveal && it.Kind == "clip" {
			o.Reveal = &gamesReveal{SpeedKmhEst: ci.Speed, Hazards: ci.Windows}
		}
		if it.Kind == "clip" {
			o.Origin = s.gamesClipOrigin(ctx, it.Ref)
		}
		out.Items = append(out.Items, o)
	}
	return out, nil
}

// gamesClipOrigin is filmed | ai_generated for a clip ref ("" when the clip cannot be read: the
// field is optional, and a session never fails over a disclosure lookup).
func (s *Server) gamesClipOrigin(ctx context.Context, ref string) string {
	o, err := s.deps.Clips.Origin(ctx, ref)
	if err != nil {
		return ""
	}
	return o
}

// gamesClipInfo is what a client may see of a clip once its windows are revealed.
type gamesClipInfo struct {
	DurationMs int
	Speed      *float64
	Windows    []gamesHazardWindow
}

// gamesClipInfos reads the final windows of clip refs from their scoring documents
// (Clips.ScoringDocs), adding the curator's occlusion flag and cue text from clip.json.
func (s *Server) gamesClipInfos(ctx context.Context, refs []string) (map[string]gamesClipInfo, error) {
	if s.deps.Clips == nil {
		return nil, errors.New("httpapi: games: no clip service")
	}
	docs, err := s.deps.Clips.ScoringDocs(ctx, refs)
	if err != nil {
		return nil, fmt.Errorf("httpapi: games: scoring documents: %w", err)
	}
	if len(docs) != len(refs) {
		return nil, fmt.Errorf("httpapi: games: %d scoring documents for %d clips", len(docs), len(refs))
	}
	out := make(map[string]gamesClipInfo, len(refs))
	for i, raw := range docs {
		var sc clips.ScoringClip
		if err := json.Unmarshal(raw, &sc); err != nil {
			return nil, fmt.Errorf("httpapi: games: scoring document: %w", err)
		}
		extra := map[string]clips.DocHazard{}
		if c, err := s.deps.Clips.Store.GetClip(ctx, sc.ClipID, sc.Version); err == nil {
			for _, h := range c.Doc.Hazards {
				extra[h.HazardID] = h
			}
		}
		ci := gamesClipInfo{DurationMs: sc.DurationMs, Windows: make([]gamesHazardWindow, 0, len(sc.Hazards))}
		if sc.SpeedKmhEst > 0 && sc.SpeedKmhEst <= 150 {
			v := sc.SpeedKmhEst
			ci.Speed = &v
		}
		for _, h := range sc.Hazards {
			hw := gamesHazardWindow{HazardID: h.HazardID, HazardType: h.HazardType, AMs: h.Window.AMs, BMs: h.Window.BMs,
				FullMarksUntilMs: h.Window.AMs + (h.Window.BMs-h.Window.AMs)/5}
			if d, ok := extra[h.HazardID]; ok {
				hw.Occlusion = d.Occlusion
				if d.CueText.En != "" || d.CueText.Hi != "" {
					hw.Cue = &gamesCue{En: d.CueText.En, Hi: d.CueText.Hi}
				}
			}
			ci.Windows = append(ci.Windows, hw)
		}
		out[refs[i]] = ci
	}
	return out, nil
}

// ---- API-35 -----------------------------------------------------------------------------------

// gamesOwnSession reads a session the caller may act on: the caller's own, or a family member's
// inside the caller's account (consent re-checked). Anything else is 404.
func (s *Server) gamesOwnSession(w http.ResponseWriter, r *http.Request, id uuid.UUID) (*games.Session, learner.Subject, bool) {
	p := principalFrom(r.Context())
	if p == nil {
		writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED"})
		return nil, learner.Subject{}, false
	}
	sess, err := s.deps.Games.Session(r.Context(), p.Tenant, id)
	if errors.Is(err, games.ErrNotFound) {
		notFound(w, r)
		return nil, learner.Subject{}, false
	}
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "game session read failed", "err", err)
		internalError(w, r)
		return nil, learner.Subject{}, false
	}
	if sess.Subject.Tenant != p.Tenant || sess.Subject.ApplicantID != p.ApplicantID {
		notFound(w, r)
		return nil, learner.Subject{}, false
	}
	subj, ok := s.learnerFor(w, r, sess.Subject.MemberRef())
	if !ok {
		return nil, learner.Subject{}, false
	}
	return sess, subj, true
}

// CompleteGameSession is API-35: the verifier's replay result overwrites the client preview.
func (s *Server) CompleteGameSession(w http.ResponseWriter, r *http.Request, sessionId gen.SessionId, _ gen.CompleteGameSessionParams) {
	if s.deps.Games == nil {
		serviceMissing(w, r)
		return
	}
	var in gamesCompleteIn
	if !decodeJSON(w, r, &in, false) {
		return
	}
	if len(in.ClientResult) == 0 || string(in.ClientResult) == "null" || in.ClientResult[0] != '{' {
		validation(w, r, "/client_result", "required")
		return
	}
	if in.Replay == nil {
		validation(w, r, "/replay", "required")
		return
	}
	sess, subj, ok := s.gamesOwnSession(w, r, sessionId)
	if !ok {
		return
	}
	if in.Replay.Seed != nil && *in.Replay.Seed != int64(sess.Seed) {
		validation(w, r, "/replay/seed", "seed_mismatch")
		return
	}
	done, err := s.deps.Games.Complete(r.Context(), games.CompleteRequest{Subject: subj, SessionID: sess.ID, ClientResult: in.ClientResult,
		Replay: games.Replay{TelemetryVersion: in.Replay.TelemetryVersion, Encoding: in.Replay.Encoding, Inputs: in.Replay.Inputs,
			Digest: in.Replay.Digest, EventCount: in.Replay.EventCount}})
	if err != nil {
		s.gamesError(w, r, err)
		return
	}
	hints := sess.Hints
	if sess.GameID == games.GameNazar {
		// The seen-clip hint is decided inside Complete; read it back for ineligible_reasons.
		if after, err := s.deps.Games.Session(r.Context(), subj.Tenant, sess.ID); err == nil {
			hints = after.Hints
		}
	}
	writeJSON(w, http.StatusOK, gamesChecked(sess, subj, done, hints))
}

// gamesChecked builds CheckedSessionResult from the outcome.
func gamesChecked(sess *games.Session, subj learner.Subject, done *games.Completed, hints games.Hints) gamesCheckedOut {
	score, findings, integ := gamesResultParts(done.Result, done.Provisional)
	out := gamesCheckedOut{SessionID: done.SessionID.String(), GameID: sess.GameID, ServerChecked: done.ServerChecked,
		Provisional: done.Provisional, ClientScorePct: done.ClientPct, Score: score, Findings: findings, Integrity: integ,
		BadgesAwarded: []string{}}
	if done.ServerChecked {
		out.ServerScorePct = done.ServerPct
		out.Result = done.Result
	}
	out.Mismatch = slices.Contains(integ.Flags, "INT_REPLAY_MISMATCH") || (done.Comparison != nil && !done.Comparison.Match)
	if done.ServerChecked && subj.Account {
		if done.Awards != nil {
			xp := max(0, done.Awards.XPAwarded)
			out.XPAwarded = &xp
		}
	}
	if done.Awards != nil {
		for _, b := range done.Awards.BadgesAwarded {
			if name, ok := gamify.BadgeNames[b]; ok {
				out.BadgesAwarded = append(out.BadgesAwarded, name)
			}
		}
	}
	if sess.GameID != games.GameNazar {
		return out
	}
	eligible := done.ServerChecked && done.Eligible[games.EligibleNazarScore]
	nz := &gamesNazarOut{Rule: "kerala_5band", Analysis: gamesAnalysis(done.Analysis, ports.AnalysisNazarClips),
		ScoreEligible: eligible, IneligibleReasons: []string{}}
	if !eligible {
		add := func(cond bool, reason string) {
			if cond {
				nz.IneligibleReasons = append(nz.IneligibleReasons, reason)
			}
		}
		add(sess.Mode != games.ModeMock, "not_mock")
		add(sess.SeedOrigin != games.SeedOriginServer || slices.Contains(integ.Flags, "INT_OFFLINE_SEED"), "offline_seed")
		add(hints.SeenClip || slices.Contains(integ.Flags, "INT_SEEN_CLIP"), "seen_clip")
		add(done.Trust != nil && *done.Trust < games.TrustThreshold, "low_trust")
		add(done.ServerChecked && done.TimingMode != "rvfc", "timing_fallback")
		add(done.Provisional, "provisional")
	}
	out.Nazar = nz
	if done.ServerChecked && sess.Mode == games.ModeMock {
		out.NazarScore = &gamesNazarScoreOut{Score: done.NazarScore, MocksCounted: done.NazarScoreN}
	}
	return out
}

// gamesResultParts reads score, findings and integrity from a SessionResult (the server's, or the
// client preview while provisional) into the strict SessionScore, Finding and IntegrityReport
// shapes: unknown keys are dropped, absent required keys get their empty values.
func gamesResultParts(raw json.RawMessage, provisional bool) (gamesScoreOut, []gamesFinding, gamesIntegrity) {
	var doc struct {
		Score struct {
			Raw        float64          `json:"raw"`
			Max        float64          `json:"max"`
			Pct        float64          `json:"pct"`
			Passed     *bool            `json:"passed"`
			PassRule   *gamesPassRule   `json:"passRule"`
			Components []gamesComponent `json:"components"`
			CapApplied *string          `json:"capApplied"`
		} `json:"score"`
		Findings  []gamesFinding `json:"findings"`
		Integrity struct {
			Flags      []string `json:"flags"`
			Trust      *float64 `json:"trust"`
			TimingMode string   `json:"timingMode"`
		} `json:"integrity"`
	}
	_ = json.Unmarshal(raw, &doc) // a malformed preview leaves zero values
	sc := gamesScoreOut{Raw: doc.Score.Raw, Max: doc.Score.Max, Pct: math.Min(100, math.Max(0, doc.Score.Pct)),
		Passed: doc.Score.Passed, Components: []gamesComponent{}, CapApplied: doc.Score.CapApplied}
	if pr := doc.Score.PassRule; pr != nil && (pr.Source == "rule_pack" || pr.Source == "design") {
		sc.PassRule = pr
	}
	for _, c := range doc.Score.Components {
		if c.ID != "" && len(sc.Components) < 64 {
			sc.Components = append(sc.Components, c)
		}
	}
	findings := []gamesFinding{}
	for _, f := range doc.Findings {
		if f.FindingID == "" || len(findings) == 12 {
			continue
		}
		f.Severity = math.Min(1, math.Max(0, f.Severity))
		if f.RuleIDs == nil {
			f.RuleIDs = []string{}
		}
		if f.DrillIDs == nil {
			f.DrillIDs = []string{}
		}
		if f.Facts == nil {
			f.Facts = map[string]any{}
		}
		findings = append(findings, f)
	}
	integ := gamesIntegrity{Flags: doc.Integrity.Flags, Trust: 1, TimingMode: doc.Integrity.TimingMode, Provisional: provisional}
	if integ.Flags == nil {
		integ.Flags = []string{}
	}
	if doc.Integrity.Trust != nil {
		integ.Trust = math.Min(1, math.Max(0, *doc.Integrity.Trust))
	}
	if !slices.Contains([]string{"rvfc", "fallback", "sim", "none"}, integ.TimingMode) {
		integ.TimingMode = "none"
	}
	return sc, findings, integ
}

// gamesAnalysis maps the stored verifier analysis of one kind to NazarClipAnalysis.
func gamesAnalysis(raw json.RawMessage, kind string) []gamesClipAnalysisOut {
	out := []gamesClipAnalysisOut{}
	if len(raw) == 0 {
		return out
	}
	var byKind map[string]ports.NazarAnalysis
	if json.Unmarshal(raw, &byKind) != nil {
		return out
	}
	for _, c := range byKind[kind].Clips {
		o := gamesClipAnalysisOut{Ordinal: c.Ordinal, ItemRef: c.Ref, Voided: c.Voided, Taps: c.Taps, MaxTapsInWindow: c.MaxTapsInWindow,
			EarlyTaps: c.EarlyTaps, FalseAlarms: c.FalseAlarms, Marks: c.Marks, Hazards: []gamesHazardAnalysisOut{}}
		for _, h := range c.Hazards {
			ho := gamesHazardAnalysisOut{HazardID: h.HazardID, HazardType: h.HazardType, Credit: h.Credit, Band: h.Band,
				LateS: h.LateS, Metres: h.Metres}
			if h.TapMt != nil {
				t := int64(math.Round(*h.TapMt))
				ho.TapMt = &t
			}
			o.Hazards = append(o.Hazards, ho)
		}
		out = append(out, o)
	}
	return out
}

// ---- Replay endpoint --------------------------------------------------------------------------

// GetGameSessionReplay returns the final windows of a completed Nazar session's clips with the
// analysed facts (NAZAR §3.2). Viewing records a replay exposure for those clips.
func (s *Server) GetGameSessionReplay(w http.ResponseWriter, r *http.Request, sessionId gen.SessionId, _ gen.GetGameSessionReplayParams) {
	if s.deps.Games == nil {
		serviceMissing(w, r)
		return
	}
	sess, _, ok := s.gamesOwnSession(w, r, sessionId)
	if !ok {
		return
	}
	if sess.GameID != games.GameNazar {
		notFound(w, r)
		return
	}
	status := ""
	switch sess.Status {
	case games.StatusChecked:
		status = "verified"
	case games.StatusPendingVerification:
		status = "pending_verification"
	case games.StatusVoided:
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "SESSION_VOIDED", Detail: "this session's replay was rejected"})
		return
	default:
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "SESSION_NOT_COMPLETED", Detail: "finish the session first"})
		return
	}
	var refs []string
	for _, it := range sess.Items {
		if it.Kind == "clip" {
			refs = append(refs, it.Ref)
		}
	}
	info := map[string]gamesClipInfo{}
	if len(refs) > 0 {
		var err error
		if info, err = s.gamesClipInfos(r.Context(), refs); err != nil {
			s.deps.Log.ErrorContext(r.Context(), "game replay: clip windows", "err", err)
			internalError(w, r)
			return
		}
	}
	analysis := map[int]gamesClipAnalysisOut{}
	if status == "verified" {
		for _, a := range gamesAnalysis(sess.Analysis, ports.AnalysisNazarClips) {
			analysis[a.Ordinal] = a
		}
	}
	out := gamesReplayOut{SessionID: sess.ID.String(), GameID: sess.GameID, Status: status, Rule: "kerala_5band", Clips: []gamesReplayClipOut{}}
	for _, it := range sess.Items {
		if it.Kind != "clip" {
			continue
		}
		ci := info[it.Ref]
		c := gamesReplayClipOut{Ordinal: it.Ordinal, ItemRef: it.Ref, Origin: s.gamesClipOrigin(r.Context(), it.Ref), DurationMs: ci.DurationMs,
			SpeedKmhEst: ci.Speed, Windows: ci.Windows}
		if c.Windows == nil {
			c.Windows = []gamesHazardWindow{}
		}
		if u, _, _, err := s.deps.Clips.AssetURL(r.Context(), it.Ref, sess.ID); err == nil {
			c.AssetURL = u
		}
		if a, ok := analysis[it.Ordinal]; ok && a.ItemRef == it.Ref {
			c.Analysis = &a
		}
		out.Clips = append(out.Clips, c)
	}
	if err := s.deps.Games.RecordReplay(r.Context(), sess); err != nil {
		s.deps.Log.ErrorContext(r.Context(), "game replay: exposures", "err", err)
		internalError(w, r)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- API-37 -----------------------------------------------------------------------------------

// ListNazarClips is API-37: the published clip manifest, never with window or hazard data.
func (s *Server) ListNazarClips(w http.ResponseWriter, r *http.Request, params gen.ListNazarClipsParams) {
	if s.deps.Clips == nil {
		serviceMissing(w, r)
		return
	}
	q := clips.ClipQuery{}
	if params.State != nil {
		q.State = strings.ToUpper(*params.State)
	} else if t := tenantFrom(r.Context()); t != nil {
		q.State = t.TenantID
	}
	if params.Resolution != nil {
		q.Resolution = string(*params.Resolution)
	}
	if params.Cursor != nil {
		q.Cursor = *params.Cursor
	}
	if params.Limit != nil {
		q.Limit = *params.Limit
	}
	private := false
	if params.ExcludeSeen != nil && *params.ExcludeSeen && principalFrom(r.Context()) != nil {
		subj, ok := s.learnerFor(w, r, memberRef(params.FamilyMemberId))
		if !ok {
			return
		}
		seen, err := s.gamesSeenRefs(r.Context(), subj)
		if err != nil {
			s.deps.Log.ErrorContext(r.Context(), "nazar clips: seen clips", "err", err)
			internalError(w, r)
			return
		}
		q.Seen, private = seen, true
	}
	page, err := s.deps.Clips.ListNazarClips(r.Context(), q)
	var ve *clips.ValidationError
	switch {
	case errors.As(err, &ve):
		validation(w, r, "/resolution", "invalid_enum")
		return
	case err != nil:
		s.deps.Log.ErrorContext(r.Context(), "nazar clips list failed", "err", err)
		internalError(w, r)
		return
	}
	res := q.Resolution
	if res == "" {
		res = "360p"
	}
	out := gamesClipPageOut{ManifestVersion: page.ManifestVersion, Licence: clips.Licence, Attribution: clips.Attribution,
		Items: make([]gamesClipManifestItem, 0, len(page.Items)), NextCursor: page.NextCursor}
	for _, it := range page.Items {
		m := gamesClipManifestItem{ItemRef: "clip:" + it.Ref, ClipID: it.ClipID, Version: it.Version, DurationMs: it.DurationMs,
			TenantTags: it.TenantTags, RoadType: it.RoadType, TimeOfDay: it.TimeOfDay, Weather: it.Weather, POV: it.POV,
			Licence: it.Licence, Attribution: it.Attribution, Media: []gamesClipMedia{}, MockEligible: it.MockEligible,
			PosterURL: it.PosterURL}
		u := it.URL360p
		if res == "480p" {
			u = it.URL480p
		}
		if u != "" && it.Bytes > 0 && it.SHA256 != "" {
			m.Media = append(m.Media, gamesClipMedia{Res: res, Bytes: it.Bytes, SHA256: it.SHA256, URL: u})
			m.TotalBytes = it.Bytes
		}
		if !it.MockEligible {
			m.CuratorDifficulty = it.Difficulty
		}
		out.TotalBytes += m.TotalBytes
		out.Items = append(out.Items, m)
	}
	body, err := json.Marshal(out)
	if err != nil {
		internalError(w, r)
		return
	}
	sum := sha256.Sum256(body)
	w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:16])+`"`)
	if private {
		w.Header().Set("Cache-Control", "private, max-age=0")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Header().Set("Vary", "X-Tenant")
	}
	writeJSON(w, http.StatusOK, json.RawMessage(body))
}

// gamesSeenRefs returns the latest-version refs (KL-0001@2) of every clip the subject has seen:
// exposures are keyed by clip ID, the clip manifest excludes by ref.
func (s *Server) gamesSeenRefs(ctx context.Context, subj learner.Subject) ([]string, error) {
	var st games.Store = store.GamesStore{}
	if s.deps.Games != nil {
		st = s.deps.Games.Store
	}
	var ids []string
	err := s.deps.DB.Tenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		var err error
		ids, err = st.SeenClipIDs(ctx, tx, subj)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("httpapi: games: seen clips: %w", err)
	}
	refs := make([]string, 0, len(ids))
	for _, id := range ids {
		c, err := s.deps.Clips.Store.GetClip(ctx, id, 0)
		if errors.Is(err, clips.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("httpapi: games: seen clip: %w", err)
		}
		refs = append(refs, c.Ref())
	}
	return refs, nil
}
