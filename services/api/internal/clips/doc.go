package clips

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// Constants from packages/clip-pipeline src/schema.ts.
const (
	Licence           = "CC-BY-4.0"
	Attribution       = "Margdarshak clip bank, team Chanakya (Nestiq Private Limited), 2026"
	DeliveryFPS       = 30
	MaxHazardsPerClip = 2
	// PublishMinMs and PublishMaxMs are PUBLISH_DURATION_MS (status.ts).
	PublishMinMs = 20_000
	PublishMaxMs = 60_000
)

// HazardTypes is clip-pipeline HAZARD_TYPES (NAZAR §3.3, 15 values, table order).
var HazardTypes = []string{
	"bus_stop_pedestrian", "door_opening", "auto_cut_in", "wrong_side_2w", "cattle_animal",
	"child_school", "pedestrian_median", "vehicle_pulling_out", "truck_left_turn",
	"junction_emerging", "overtaking_oncoming", "parked_vehicle_hidden", "cyclist",
	"surface_hazard", "other",
}

// HazardModules is clip-pipeline HAZARD_MODULES (NAZAR §3.3 "Module" column).
var HazardModules = map[string][]string{
	"bus_stop_pedestrian": {"M18"}, "door_opening": {"M5", "M17"}, "auto_cut_in": {"M5"}, "wrong_side_2w": {"M9"},
	"cattle_animal": {"M18"}, "child_school": {"M18"}, "pedestrian_median": {"M18"}, "vehicle_pulling_out": {"M6"},
	"truck_left_turn": {"M4"}, "junction_emerging": {"M6"}, "overtaking_oncoming": {"M7"},
	"parked_vehicle_hidden": {"M6", "M18"}, "cyclist": {"M18"}, "surface_hazard": {"M17"}, "other": {},
}

// Clip origins (clip-pipeline CLIP_ORIGINS, ADR-0013). Older clip.json files have no origin and
// read as filmed.
const (
	OriginFilmed      = "filmed"
	OriginAIGenerated = "ai_generated"
	// SpeedSourceSceneSpec is the speed source of every ai_generated clip (the scene's speed).
	SpeedSourceSceneSpec = "scene_spec"
)

// Renditions is clip-pipeline RENDITIONS.
var Renditions = []string{"360p", "480p"}

var (
	clipIDRe     = regexp.MustCompile(`^[A-Z]{2,4}-\d{4,6}$`)
	clipPrefixRe = regexp.MustCompile(`^[A-Z]{2,4}$`)
	pseudonymRe  = regexp.MustCompile(`^[a-z][a-z0-9]*-[a-z0-9]{1,16}$`)
	sha256Re     = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// ValidPseudonym reports whether s is a pseudonymous person ID (clip-pipeline PSEUDONYM_RE),
// e.g. "rater-07". Names are never accepted.
func ValidPseudonym(s string) bool { return pseudonymRe.MatchString(s) }

// ValidClipID reports whether s matches CLIP_ID_RE (e.g. "JMU-0012").
func ValidClipID(s string) bool { return clipIDRe.MatchString(s) }

func validHazardType(t string) bool {
	for _, h := range HazardTypes {
		if h == t {
			return true
		}
	}
	return false
}

// Window is a hazard window in media milliseconds.
type Window struct {
	AMs int `json:"aMs"`
	BMs int `json:"bMs"`
}

// CueText is the bilingual cue a curator writes for a final hazard.
type CueText struct {
	En string `json:"en"`
	Hi string `json:"hi"`
}

// DocHazard is a final hazard in clip.json (ClipHazardSchema).
type DocHazard struct {
	HazardID     string  `json:"hazardId"`
	HazardType   string  `json:"hazardType"`
	Window       Window  `json:"window"`
	RaterCount   int     `json:"raterCount"`
	DeltaOnsetMs int     `json:"deltaOnsetMs"`
	DeltaEndMs   int     `json:"deltaEndMs"`
	Adjudicated  bool    `json:"adjudicated"`
	Occlusion    bool    `json:"occlusion"`
	CueText      CueText `json:"cueText"`
}

// QuietSegment is a stretch with no hazard.
type QuietSegment struct {
	FromMs int `json:"fromMs"`
	ToMs   int `json:"toMs"`
}

// Difficulty is the clip difficulty block.
type Difficulty struct {
	Curator   *int     `json:"curator"`
	Empirical *float64 `json:"empirical"`
	IRT       *float64 `json:"irt"`
	NTakers   int      `json:"nTakers"`
}

// DocBlurAudit is the four-field audit summary in clip.json.
type DocBlurAudit struct {
	Auditor       string `json:"auditor"`
	FramesChecked int    `json:"framesChecked"`
	Misses        int    `json:"misses"`
	AuditedAt     string `json:"auditedAt"`
}

// Generation is how an ai_generated clip was made (clip-pipeline GenerationSchema). No prompt
// text: the scene catalogue holds it, versioned by PromptVersion.
type Generation struct {
	Model         string `json:"model"`
	SceneID       string `json:"sceneId"`
	PromptVersion string `json:"promptVersion"`
	SeedOrBatchID string `json:"seedOrBatchId,omitempty"`
	GeneratedAt   string `json:"generatedAt"` // YYYY-MM
	DurationMs    int    `json:"durationMs"`
	Extensions    int    `json:"extensions"`
	SynthID       bool   `json:"synthId"`    // always true
	Disclosure    string `json:"disclosure"` // always "ai_generated"
}

// SyntheticReview is the passing curator review of an ai_generated clip in clip.json
// (clip-pipeline SyntheticReviewSchema: every check is a literal true). It replaces the blur
// audit; a failing review never enters clip.json (Clip.SyntheticReview keeps the record).
type SyntheticReview struct {
	Reviewer             string `json:"reviewer"`
	CheckedAt            string `json:"checkedAt"`
	NoRealPersonLikeness bool   `json:"noRealPersonLikeness"`
	NoReadablePlates     bool   `json:"noReadablePlates"`
	NoRealBrands         bool   `json:"noRealBrands"`
	NoCollisionOrInjury  bool   `json:"noCollisionOrInjury"`
	HazardVisible        bool   `json:"hazardVisible"`
}

// MediaEntry is one delivery rendition.
type MediaEntry struct {
	Res    string `json:"res"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

// Doc is clip.json (E-20), field for field as clip-pipeline ClipSchema. Every object in the
// schema is strict, so this struct round-trips a valid document exactly.
type Doc struct {
	ClipID        string         `json:"clipId"`
	Version       int            `json:"version"`
	Status        Status         `json:"status"`
	TenantTags    []string       `json:"tenantTags"`
	City          string         `json:"city"`
	RoadType      string         `json:"roadType"`
	TimeOfDay     string         `json:"timeOfDay"`
	Weather       string         `json:"weather"`
	POV           string         `json:"pov"`
	CapturedMonth string         `json:"capturedMonth"`
	SpeedKmhEst   *float64       `json:"speedKmhEst"`
	SpeedSource   string         `json:"speedSource"`
	DurationMs    int            `json:"durationMs"`
	Hazards       []DocHazard    `json:"hazards"`
	QuietSegments []QuietSegment `json:"quietSegments"`
	Difficulty    Difficulty     `json:"difficulty"`
	Modules       []string       `json:"modules"`
	Licence       string         `json:"licence"`
	Attribution   string         `json:"attribution"`
	BlurAudit     *DocBlurAudit  `json:"blurAudit"`
	Media         []MediaEntry   `json:"media"`
	// Origin is "" or filmed (the default; "" keeps pre-ADR-0013 documents byte-identical) or
	// ai_generated (ADR-0013).
	Origin          string           `json:"origin,omitempty"`
	Generation      *Generation      `json:"generation,omitempty"`
	SyntheticReview *SyntheticReview `json:"syntheticReview,omitempty"`
}

// IsAI reports whether the clip is AI-generated.
func (d *Doc) IsAI() bool { return d.Origin == OriginAIGenerated }

// OriginOrDefault is the clip's origin, filmed when unset.
func (d *Doc) OriginOrDefault() string {
	if d.Origin == "" {
		return OriginFilmed
	}
	return d.Origin
}

// Ref is the versioned clip reference `JMU-0012@3` (clipRef).
func (d *Doc) Ref() string { return fmt.Sprintf("%s@%d", d.ClipID, d.Version) }

// normalize makes nil slices empty so the document marshals as the schema expects.
func (d *Doc) normalize() {
	if d.TenantTags == nil {
		d.TenantTags = []string{}
	}
	if d.Hazards == nil {
		d.Hazards = []DocHazard{}
	}
	if d.QuietSegments == nil {
		d.QuietSegments = []QuietSegment{}
	}
	if d.Modules == nil {
		d.Modules = []string{}
	}
	if d.Media == nil {
		d.Media = []MediaEntry{}
	}
}

// JSON returns the canonical document bytes.
func (d *Doc) JSON() ([]byte, error) {
	cp := *d
	cp.normalize()
	return json.Marshal(&cp)
}

// MediaFor returns the rendition entry for res.
func (d *Doc) MediaFor(res string) (MediaEntry, bool) {
	for _, m := range d.Media {
		if m.Res == res {
			return m, true
		}
	}
	return MediaEntry{}, false
}

// ExpectedFrameCount is floor(durationMs × fps / 1000): the frames a full blur audit checks.
func ExpectedFrameCount(durationMs, fps int) int {
	return int((int64(durationMs) * int64(fps)) / 1000)
}

// ---- JSON Schema validation (packages/clip-pipeline/schema/clip.schema.json) ---------------

// clipSchemaJSON is a byte copy of packages/clip-pipeline/schema/clip.schema.json (go:embed cannot
// reach outside the module). TestSchema_NoDrift fails when the two differ.
//
//go:embed clip.schema.json
var clipSchemaJSON []byte

const clipSchemaURL = "https://margdarshak.example/schema/clip.schema.json"

var (
	schemaOnce sync.Once
	schemaVal  *jsonschema.Schema
	schemaErr  error
)

func clipSchema() (*jsonschema.Schema, error) {
	schemaOnce.Do(func() {
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(clipSchemaJSON))
		if err != nil {
			schemaErr = fmt.Errorf("clips: parse clip.schema.json: %w", err)
			return
		}
		c := jsonschema.NewCompiler()
		if err := c.AddResource(clipSchemaURL, doc); err != nil {
			schemaErr = fmt.Errorf("clips: add clip.schema.json: %w", err)
			return
		}
		schemaVal, schemaErr = c.Compile(clipSchemaURL)
	})
	return schemaVal, schemaErr
}

// DocError lists why a clip document is invalid. Messages never echo field values.
type DocError struct{ Issues []string }

func (e *DocError) Error() string {
	return fmt.Sprintf("clips: invalid clip.json (%d issues): %v", len(e.Issues), e.Issues)
}

// ErrInvalidDoc matches every *DocError via errors.Is.
var ErrInvalidDoc = errors.New("clips: invalid clip.json")

// Is makes errors.Is(err, ErrInvalidDoc) true.
func (e *DocError) Is(target error) bool { return target == ErrInvalidDoc }

// ValidateDoc checks raw clip.json against clip.schema.json (draft 2020-12) and then the
// cross-field rules the schema cannot express (clip-pipeline ClipSchema superRefine): unique
// hazard IDs, windows inside the clip, three marks only after adjudication, quiet segments
// inside the clip, not overlapping each other or a hazard, unique renditions, and speedKmhEst
// null exactly when speedSource is "not_logged".
func ValidateDoc(raw []byte) (*Doc, error) {
	sch, err := clipSchema()
	if err != nil {
		return nil, err
	}
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, &DocError{Issues: []string{"not JSON"}}
	}
	if err := sch.Validate(inst); err != nil {
		var ve *jsonschema.ValidationError
		if errors.As(err, &ve) {
			return nil, &DocError{Issues: schemaIssues(ve)}
		}
		return nil, &DocError{Issues: []string{"schema"}}
	}
	var d Doc
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return nil, &DocError{Issues: []string{"decode"}}
	}
	if issues := crossFieldIssues(&d); len(issues) > 0 {
		return nil, &DocError{Issues: issues}
	}
	d.normalize()
	return &d, nil
}

// ValidateDocStruct validates a Doc built in Go (marshal, then ValidateDoc).
func ValidateDocStruct(d *Doc) error {
	raw, err := d.JSON()
	if err != nil {
		return err
	}
	_, err = ValidateDoc(raw)
	return err
}

// schemaIssues flattens a validation error into instance locations (no values).
func schemaIssues(ve *jsonschema.ValidationError) []string {
	var out []string
	var walk func(e *jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		if len(e.Causes) == 0 {
			loc := "/"
			for i, p := range e.InstanceLocation {
				if i == 0 {
					loc = ""
				}
				loc += "/" + p
			}
			out = append(out, "schema at "+loc)
			return
		}
		for _, c := range e.Causes {
			walk(c)
		}
	}
	walk(ve)
	sort.Strings(out)
	return dedupe(out)
}

func dedupe(xs []string) []string {
	out := xs[:0]
	for i, x := range xs {
		if i == 0 || xs[i-1] != x {
			out = append(out, x)
		}
	}
	return out
}

func crossFieldIssues(d *Doc) []string {
	var out []string
	ids := map[string]bool{}
	for i, h := range d.Hazards {
		if ids[h.HazardID] {
			out = append(out, fmt.Sprintf("hazards/%d/hazardId duplicate", i))
		}
		ids[h.HazardID] = true
		if h.Window.AMs >= h.Window.BMs {
			out = append(out, fmt.Sprintf("hazards/%d/window aMs must be < bMs", i))
		}
		if h.Window.BMs > d.DurationMs {
			out = append(out, fmt.Sprintf("hazards/%d/window ends after the clip", i))
		}
		if h.RaterCount == 3 && !h.Adjudicated {
			out = append(out, fmt.Sprintf("hazards/%d three marks only exist after adjudication", i))
		}
	}
	quiet := append([]QuietSegment{}, d.QuietSegments...)
	sort.Slice(quiet, func(i, j int) bool { return quiet[i].FromMs < quiet[j].FromMs })
	for i, q := range quiet {
		if q.FromMs >= q.ToMs {
			out = append(out, "quietSegments fromMs must be < toMs")
		}
		if q.ToMs > d.DurationMs {
			out = append(out, "quietSegments ends after the clip")
		}
		if i > 0 && quiet[i-1].ToMs > q.FromMs {
			out = append(out, "quietSegments overlap")
		}
		for _, h := range d.Hazards {
			if q.FromMs < h.Window.BMs && h.Window.AMs < q.ToMs {
				out = append(out, "quietSegments overlap hazard "+h.HazardID)
			}
		}
	}
	res := map[string]bool{}
	for i, m := range d.Media {
		if res[m.Res] {
			out = append(out, fmt.Sprintf("media/%d duplicate rendition", i))
		}
		res[m.Res] = true
	}
	if (d.SpeedKmhEst == nil) != (d.SpeedSource == "not_logged") {
		out = append(out, `speedKmhEst is null exactly when speedSource is "not_logged"`)
	}
	return append(out, originIssues(d)...)
}

// originIssues is clip-pipeline originRules: the two kinds of clip never borrow each other's
// evidence.
func originIssues(d *Doc) []string {
	var out []string
	if !d.IsAI() {
		if d.Generation != nil {
			out = append(out, "generation is only for ai_generated clips")
		}
		if d.SyntheticReview != nil {
			out = append(out, "syntheticReview is only for ai_generated clips (filmed clips need the blur audit)")
		}
		if d.SpeedSource == SpeedSourceSceneSpec {
			out = append(out, `speedSource "scene_spec" is only for ai_generated clips`)
		}
		return out
	}
	if d.Generation == nil {
		out = append(out, "ai_generated clips need their generation record")
	} else if d.Generation.GeneratedAt != d.CapturedMonth {
		out = append(out, "capturedMonth of an ai_generated clip is its generation month")
	}
	if d.BlurAudit != nil {
		out = append(out, "ai_generated clips have no blur audit (syntheticReview replaces it)")
	}
	if d.SpeedSource != SpeedSourceSceneSpec {
		out = append(out, `ai_generated clips take their speed from the scene ("scene_spec")`)
	}
	return out
}
