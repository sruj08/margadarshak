package seed

// Sample Nazar clips for dev and demo (cmd/seed, the full-stack e2e API). Without published clips
// a Nazar mock answers 409 NO_UNSEEN_CLIPS, so the seed publishes the game-core fixture bank
// (packages/game-core/src/fixtures/nazar.ts: the ten Kerala-format clips KL-0001..KL-0010 and the
// quiet clip) with the same windows, speeds and durations, so a seeded session scores exactly
// like the golden vectors.
//
// They are labelled as samples everywhere a person or a program can look, and never pass for
// real generations:
//   - origin ai_generated (ADR-0013: the product's clips are AI-generated), with a generation
//     record that says what they are: model "sample-fixture-not-generated", scene "SCN-000"
//     (no such scene), prompt version 0.0.0, batch "sample-game-core-fixture", generation key
//     "SCN-000:0:sample-<clip>" (real scene revisions start at 1);
//   - city "Sample fixture", registered, synthetic-reviewed and rated by seed pseudonyms
//     (seed-curator, seed-rater1, seed-rater2), two agreeing ratings per clip;
//   - media: both renditions point at the mock object store's placeholder (96 KiB of zero bytes,
//     the same body the web's mock-mode clip route serves), so the player preloads them like a
//     real MP4 and then shows its labelled placeholder timeline.
//
// Mock eligibility follows clip-pipeline mockEligibility (status.ts), so a manifest rebuild
// (clip.publish_manifest, run whenever a curator publishes) gives every sample the same answer:
// the ten hazard clips are eligible; the quiet clip, KL-0011 here (the fixture's "KL-Q001" does
// not match CLIP_ID_RE ^[A-Z]{2,4}-\d{4,6}$, the content.clips CHECK), is published but never
// mock-eligible ("quiet clip (no hazard to score)"), and practice draws from the eligible pool,
// so it is not dealt either. The stored flash result is "passed": the placeholder body is a
// constant run of zero bytes with no frames that could flash (no real video exists to check).
//
// Idempotent: existing clip versions are left as they are (the placeholder object is rewritten,
// which is a no-op for identical bytes). P1 personas and their counts are untouched.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// Sample clip constants.
const (
	SampleClipPlaceholderBytes = 96 * 1024 // apps/web PLACEHOLDER_CLIP_BYTES
	SampleCurator              = "seed-curator"
	SampleModel                = "sample-fixture-not-generated"
	SampleSceneID              = "SCN-000"
	SampleBatchID              = "sample-game-core-fixture"
	SampleCity                 = "Sample fixture"
	samplePrefix               = "KL"
)

// SampleRaters are the two seed raters whose ratings agree on every sample clip.
var SampleRaters = [2]string{"seed-rater1", "seed-rater2"}

type sampleHazard struct {
	id, kind string
	a, b     int
}

type sampleClip struct {
	id         string
	speed      float64
	durationMs int
	hazards    []sampleHazard
	difficulty int
}

// sampleBank is game-core NAZAR_CLIPS plus NAZAR_QUIET_CLIP (renumbered KL-0011), with curator
// difficulties 2–4 (the Kerala mock mix: three at 2, three at 3, four at 4) that pass the
// clip-pipeline curator rubric: a two-hazard clip is never level 2, two hazards under 3 s apart
// (KL-0008) are level 4.
var sampleBank = []sampleClip{
	{"KL-0001", 40, 45000, []sampleHazard{{"h1", "bus_stop_pedestrian", 12000, 16500}}, 2},
	{"KL-0002", 30, 40000, []sampleHazard{{"h1", "door_opening", 8000, 12000}}, 3},
	{"KL-0003", 35, 50000, []sampleHazard{{"h1", "auto_cut_in", 20000, 25000}}, 4},
	{"KL-0004", 30, 55000, []sampleHazard{{"h1", "cattle_animal", 10000, 14000}, {"h2", "wrong_side_2w", 30000, 35000}}, 3},
	{"KL-0005", 25, 45000, []sampleHazard{{"h1", "child_school", 15000, 20000}}, 3},
	{"KL-0006", 35, 40000, []sampleHazard{{"h1", "vehicle_pulling_out", 9000, 13500}}, 4},
	{"KL-0007", 30, 45000, []sampleHazard{{"h1", "truck_left_turn", 18000, 22500}}, 2},
	{"KL-0008", 30, 50000, []sampleHazard{{"h1", "pedestrian_median", 11000, 16000}, {"h2", "parked_vehicle_hidden", 13000, 18000}}, 4},
	{"KL-0009", 40, 40000, []sampleHazard{{"h1", "junction_emerging", 7000, 11000}}, 2},
	{"KL-0010", 40, 50000, []sampleHazard{{"h1", "bus_stop_pedestrian", 25000, 30000}}, 2},
	{"KL-0011", 30, 30000, nil, 2},
}

// sampleCues are the bilingual cue texts per hazard type (sample wording).
var sampleCues = map[string]clips.CueText{
	"bus_stop_pedestrian":   {En: "Sample clip: someone steps out from the front of the bus", Hi: "नमूना क्लिप: बस के आगे से कोई निकलता है"},
	"door_opening":          {En: "Sample clip: a parked car door starts to open", Hi: "नमूना क्लिप: खड़ी कार का दरवाज़ा खुलने लगता है"},
	"auto_cut_in":           {En: "Sample clip: an auto-rickshaw cuts across your lane", Hi: "नमूना क्लिप: ऑटो-रिक्शा आपकी लेन में घुसता है"},
	"cattle_animal":         {En: "Sample clip: an animal moves towards the road", Hi: "नमूना क्लिप: जानवर सड़क की ओर बढ़ता है"},
	"wrong_side_2w":         {En: "Sample clip: a two-wheeler comes on the wrong side", Hi: "नमूना क्लिप: दोपहिया गलत दिशा से आता है"},
	"child_school":          {En: "Sample clip: a child near the school gate starts to cross", Hi: "नमूना क्लिप: स्कूल के पास बच्चा सड़क पार करने लगता है"},
	"vehicle_pulling_out":   {En: "Sample clip: a vehicle starts to pull out", Hi: "नमूना क्लिप: एक वाहन बाहर निकलने लगता है"},
	"truck_left_turn":       {En: "Sample clip: the truck ahead starts turning left", Hi: "नमूना क्लिप: आगे का ट्रक बाईं ओर मुड़ने लगता है"},
	"pedestrian_median":     {En: "Sample clip: a pedestrian steps off the median", Hi: "नमूना क्लिप: डिवाइडर से पैदल यात्री उतरता है"},
	"parked_vehicle_hidden": {En: "Sample clip: someone appears from behind a parked vehicle", Hi: "नमूना क्लिप: खड़े वाहन के पीछे से कोई निकलता है"},
	"junction_emerging":     {En: "Sample clip: a vehicle emerges from the side road", Hi: "नमूना क्लिप: बगल की सड़क से वाहन निकलता है"},
}

// SampleClipIDs returns the sample clip IDs in bank order.
func SampleClipIDs() []string {
	out := make([]string, len(sampleBank))
	for i, c := range sampleBank {
		out[i] = c.id
	}
	return out
}

// ClipObjects is the object store slice the clip seed writes to (ports.ObjectStore).
type ClipObjects interface {
	Put(ctx context.Context, key string, body []byte, contentType string) error
}

// ClipDeps are what the clip seed needs. Objects nil skips the media upload (rows only).
type ClipDeps struct {
	DB      *store.DB
	Objects ClipObjects
	Now     time.Time
}

// ClipReport summarises the clip seed.
type ClipReport struct {
	Created, Existing int
	Refs              []string
}

// placeholderMedia is the placeholder body and its sha256.
func placeholderMedia() ([]byte, string) {
	b := make([]byte, SampleClipPlaceholderBytes)
	sum := sha256.Sum256(b)
	return b, hex.EncodeToString(sum[:])
}

// SampleClips publishes the sample clip bank (idempotent).
func SampleClips(ctx context.Context, d ClipDeps) (ClipReport, error) {
	var rep ClipReport
	now := d.Now.UTC().Truncate(time.Millisecond)
	body, sha := placeholderMedia()
	st := store.NewClipsStore(d.DB)
	for _, sc := range sampleBank {
		if d.Objects != nil {
			for _, res := range clips.Renditions {
				if err := d.Objects.Put(ctx, clips.MediaObjectKey(sc.id, 1, res), body, "video/mp4"); err != nil {
					return rep, fmt.Errorf("seed clips: media %s: %w", sc.id, err)
				}
			}
		}
		rep.Refs = append(rep.Refs, "clip:"+sc.id+"@1")
		if _, err := st.GetClip(ctx, sc.id, 1); err == nil {
			rep.Existing++
			continue
		} else if !errors.Is(err, clips.ErrNotFound) {
			return rep, err
		}
		c, ratings, err := sampleClipRecord(sc, now, sha)
		if err != nil {
			return rep, err
		}
		if err := st.InsertClip(ctx, c); err != nil {
			return rep, fmt.Errorf("seed clips: %s: %w", sc.id, err)
		}
		for _, r := range ratings {
			if err := st.UpsertRating(ctx, r); err != nil {
				return rep, fmt.Errorf("seed clips: rating %s: %w", sc.id, err)
			}
		}
		rep.Created++
	}
	// New KL registrations must not collide with the sample numbers.
	if err := d.DB.System(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO content.clip_id_counters (prefix, last) VALUES ($1, $2)
			ON CONFLICT (prefix) DO UPDATE SET last = GREATEST(content.clip_id_counters.last, EXCLUDED.last)`, samplePrefix, len(sampleBank))
		return err
	}); err != nil {
		return rep, fmt.Errorf("seed clips: counter: %w", err)
	}
	return rep, nil
}

// sampleClipRecord builds the published clip row and its two agreeing ratings.
func sampleClipRecord(sc sampleClip, now time.Time, mediaSHA string) (*clips.Clip, []*clips.Rating, error) {
	month := now.Format("2006-01")
	stamp := now.Format("2006-01-02T15:04:05.000Z")
	speed := sc.speed
	difficulty := sc.difficulty
	genMs := min(sc.durationMs, 41000) // GenerationSchema bound; there is no generated video behind a sample
	d := clips.Doc{ClipID: sc.id, Version: 1, Status: clips.StatusPublished, TenantTags: []string{samplePrefix, "JK"},
		City: SampleCity, RoadType: "urban_arterial", TimeOfDay: "day", Weather: "clear", POV: "2W", CapturedMonth: month,
		SpeedKmhEst: &speed, SpeedSource: clips.SpeedSourceSceneSpec, DurationMs: sc.durationMs,
		Difficulty: clips.Difficulty{Curator: &difficulty}, Licence: clips.Licence, Attribution: clips.Attribution,
		Media: []clips.MediaEntry{{Res: "360p", Bytes: SampleClipPlaceholderBytes, SHA256: mediaSHA},
			{Res: "480p", Bytes: SampleClipPlaceholderBytes, SHA256: mediaSHA}},
		Origin: clips.OriginAIGenerated,
		Generation: &clips.Generation{Model: SampleModel, SceneID: SampleSceneID, PromptVersion: "0.0.0", SeedOrBatchID: SampleBatchID,
			GeneratedAt: month, DurationMs: genMs, Extensions: 0, SynthID: true, Disclosure: clips.OriginAIGenerated},
		SyntheticReview: &clips.SyntheticReview{Reviewer: SampleCurator, CheckedAt: stamp, NoRealPersonLikeness: true, NoReadablePlates: true,
			NoRealBrands: true, NoCollisionOrInjury: true, HazardVisible: true}}
	cues := map[string]clips.CueText{}
	modules := map[string]bool{}
	var marksA, marksB []clips.RaterMark
	var pairs []clips.AgreementPair
	var finals []clips.FinalHazard
	if len(sc.hazards) == 0 {
		d.QuietSegments = []clips.QuietSegment{{FromMs: 0, ToMs: sc.durationMs}}
	} else {
		d.QuietSegments = []clips.QuietSegment{{FromMs: 0, ToMs: 5000}}
	}
	for _, h := range sc.hazards {
		cue := sampleCues[h.kind]
		cues[h.id] = cue
		d.Hazards = append(d.Hazards, clips.DocHazard{HazardID: h.id, HazardType: h.kind, Window: clips.Window{AMs: h.a, BMs: h.b},
			RaterCount: 2, DeltaOnsetMs: 200, DeltaEndMs: 200, CueText: cue})
		for _, m := range clips.HazardModules[h.kind] {
			if !modules[m] {
				modules[m] = true
				d.Modules = append(d.Modules, m)
			}
		}
		a := clips.RaterMark{HazardType: h.kind, AMs: h.a - 100, BMs: h.b - 100}
		b := clips.RaterMark{HazardType: h.kind, AMs: h.a + 100, BMs: h.b + 100}
		marksA, marksB = append(marksA, a), append(marksB, b)
		pairs = append(pairs, clips.AgreementPair{A: a, B: b, DeltaOnsetMs: 200, Accepted: true})
		finals = append(finals, clips.FinalHazard{HazardID: h.id, HazardType: h.kind, Window: clips.FWindow{AMs: float64(h.a), BMs: float64(h.b)},
			RaterCount: 2, DeltaOnsetMs: 200, DeltaEndMs: 200, Cues: []string{}})
	}
	if err := clips.ValidateDocStruct(&d); err != nil {
		return nil, nil, fmt.Errorf("seed clips: %s: %w", sc.id, err)
	}
	agreement := clips.AgreementResult{ClipID: sc.id, Version: 1, Raters: SampleRaters[:], Pairs: pairs, Reasons: []string{},
		Accepted: true, FinalHazards: finals}
	if agreement.Pairs == nil {
		agreement.Pairs, agreement.FinalHazards = []clips.AgreementPair{}, []clips.FinalHazard{}
	}
	agreement.Metrics.Matched = len(pairs)
	if len(pairs) > 0 {
		m := 200.0
		agreement.Metrics.MedianDeltaOnsetM = &m
	}
	eligible, reasons := true, []string{}
	if len(sc.hazards) == 0 {
		eligible, reasons = false, []string{"quiet clip (no hazard to score)"} // clip-pipeline mockEligibility
	}
	flash := true
	agRaw, err := json.Marshal(agreement)
	if err != nil {
		return nil, nil, err
	}
	c := &clips.Clip{ClipID: sc.id, Version: 1, Status: clips.StatusPublished, Doc: d, Tenant: samplePrefix,
		RegisteredBy: SampleCurator, RegisteredAt: now, CueTexts: cues, Agreement: agRaw, AgreementAccepted: true, FinalHazards: finals,
		PublishedAt: &now, MockEligible: eligible, MockReasons: reasons, FlashPassed: &flash, UpdatedAt: now,
		GenerationKey: clips.GenerationKey(SampleSceneID, 0, "sample-"+sc.id),
		SyntheticReview: &clips.SyntheticReviewRecord{Reviewer: SampleCurator, ReviewedAt: now, Passed: true,
			Checks: clips.SyntheticChecks{NoRealPersonLikeness: true, NoReadablePlates: true, NoRealBrands: true, NoCollisionOrInjury: true, HazardVisible: true},
			Note:   "sample clip seeded from the game-core fixture bank; not a real generation"}}
	ratings := []*clips.Rating{}
	for i, marks := range [][]clips.RaterMark{marksA, marksB} {
		if marks == nil {
			marks = []clips.RaterMark{}
		}
		ratings = append(ratings, &clips.Rating{ClipID: sc.id, Version: 1, Rater: SampleRaters[i], SavedAt: now,
			Submission: clips.RaterSubmission{Rater: SampleRaters[i], ClipID: sc.id, Version: 1, Marks: marks, SubmittedAt: stamp}})
	}
	return c, ratings, nil
}
