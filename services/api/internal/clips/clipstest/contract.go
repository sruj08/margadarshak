// Package clipstest is the clips.Store contract: one behaviour suite that runs on clips.MemStore
// (the reference semantics) and on the pgx store (internal/store.ClipsStore), so the two cannot
// drift.
package clipstest

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/clips"
)

// Fixture is one fresh, empty store plus what a valid clip row needs.
type Fixture struct {
	Store clips.Store
	// ConsentID is an existing clip_contribution consent artefact ID (a uuid string); the pgx
	// store has a foreign key to privacy.consent_artefacts.
	ConsentID string
}

var t0 = time.Date(2026, 10, 24, 6, 0, 0, 0, time.UTC)

func ctx() context.Context { return context.Background() }

func ptr[T any](v T) *T { return &v }

// NewClip returns a valid raw clip id@v (it satisfies every content.clips CHECK).
func NewClip(id string, v int, consentID string) *clips.Clip {
	speed := 40.0
	d := clips.Doc{ClipID: id, Version: v, Status: clips.StatusRaw, TenantTags: []string{"JK"}, City: "Jammu",
		RoadType: "urban_arterial", TimeOfDay: "day", Weather: "clear", POV: "2W", CapturedMonth: "2026-10",
		SpeedKmhEst: &speed, SpeedSource: "rider_log", DurationMs: 38000,
		Hazards: []clips.DocHazard{}, QuietSegments: []clips.QuietSegment{{FromMs: 0, ToMs: 9000}},
		Difficulty: clips.Difficulty{Curator: ptr(3)}, Modules: []string{"M18"}, Licence: clips.Licence,
		Attribution: clips.Attribution, Media: []clips.MediaEntry{}}
	return &clips.Clip{ClipID: id, Version: v, Status: clips.StatusRaw, Doc: d, Tenant: "JK",
		RawObjectKey: "raw/" + id + ".mp4", FilmedBy: "passenger", ContributorConsentID: consentID,
		RegisteredBy: "curator-01", RegisteredAt: t0, CueTexts: map[string]clips.CueText{}, UpdatedAt: t0}
}

// NewAIClip returns a valid raw ai_generated clip id@v (ADR-0013): no contributor, filming or
// raw object yet, a generation record and its generation key.
func NewAIClip(id string, v int, batch string) *clips.Clip {
	speed := 30.0
	d := clips.Doc{ClipID: id, Version: v, Status: clips.StatusRaw, TenantTags: []string{"JK", "KL"}, City: "Indian metro",
		RoadType: "urban_arterial", TimeOfDay: "day", Weather: "clear", POV: "2W", CapturedMonth: "2026-10",
		SpeedKmhEst: &speed, SpeedSource: clips.SpeedSourceSceneSpec, DurationMs: 30000, Hazards: []clips.DocHazard{},
		QuietSegments: []clips.QuietSegment{}, Modules: []string{"M18"}, Licence: clips.Licence, Attribution: clips.Attribution,
		Media: []clips.MediaEntry{}, Origin: clips.OriginAIGenerated,
		Generation: &clips.Generation{Model: clips.DefaultVideoModel, SceneID: "SCN-001", PromptVersion: "1.0.0", SeedOrBatchID: batch,
			GeneratedAt: "2026-10", DurationMs: 30000, Extensions: 3, SynthID: true, Disclosure: clips.OriginAIGenerated}}
	return &clips.Clip{ClipID: id, Version: v, Status: clips.StatusRaw, Doc: d, Tenant: "JK", RegisteredBy: "curator-01",
		RegisteredAt: t0, CueTexts: map[string]clips.CueText{}, UpdatedAt: t0, GenerationKey: clips.GenerationKey("SCN-001", 1, batch),
		OnsetHint: json.RawMessage(`{"approxOnsetMs":16000,"toleranceMs":3000,"authoritative":false,"basis":"nominal"}`)}
}

// setStatus moves the record and its doc to st.
func setStatus(c *clips.Clip, st clips.Status) { c.Status, c.Doc.Status = st, st }

// fullClip returns a published clip with every field set.
func fullClip(id string, consentID string) *clips.Clip {
	c := NewClip(id, 2, consentID)
	setStatus(c, clips.StatusPublished)
	c.Doc.TenantTags = []string{"JK", "KL"}
	c.Doc.Media = []clips.MediaEntry{{Res: "360p", Bytes: 1840000, SHA256: strings.Repeat("a", 64)},
		{Res: "480p", Bytes: 2900000, SHA256: strings.Repeat("b", 64)}}
	c.Doc.Hazards = []clips.DocHazard{{HazardID: "h1", HazardType: "bus_stop_pedestrian", Window: clips.Window{AMs: 12267, BMs: 16767},
		RaterCount: 2, DeltaOnsetMs: 500, DeltaEndMs: 500, CueText: clips.CueText{En: "Feet at the bus front", Hi: "बस के आगे पैर"}}}
	c.Doc.BlurAudit = &clips.DocBlurAudit{Auditor: "auditor-01", FramesChecked: 1140, Misses: 0, AuditedAt: "2026-10-24T07:00:00.000Z"}
	c.IntermediateKeys = []string{"private/" + id + "/v2/mezzanine.mp4"}
	c.FilmedOn = "2026-10-01"
	c.FlashPassed = ptr(true)
	c.Proposals = []clips.Proposal{{AMs: 11000, BMs: 15000, HazardType: "bus_stop_pedestrian", Why: "bus stopping"}}
	c.BlurRegions = json.RawMessage(`{"faces":[{"frame":1,"box":[1,2,3,4]}]}`)
	c.ReviewEventID = id + ":open_review:2"
	c.AdjudicationEventID = id + ":request_adjudication:2"
	c.Agreement = json.RawMessage(`{"accepted":true,"clipId":"` + id + `","pairs":[]}`)
	c.AgreementAccepted = true
	c.NeedsThirdRater = true
	c.FinalHazards = []clips.FinalHazard{{HazardID: "h1", HazardType: "bus_stop_pedestrian", Window: clips.FWindow{AMs: 12267, BMs: 16767},
		RaterCount: 2, DeltaOnsetMs: 500, DeltaEndMs: 500, Cues: []string{"feet at bus front"}}}
	c.Adjudication = &clips.Adjudication{Adjudicator: "rater-03", Input: json.RawMessage(`{"reasonCode":"onset","decisions":[]}`),
		Resolved: true, Hazards: c.FinalHazards, Dropped: []string{"c2"}, Issues: []string{}, At: t0.Add(time.Hour)}
	c.CueTexts = map[string]clips.CueText{"h1": {En: "Feet at the bus front", Hi: "बस के आगे पैर"}}
	c.AuditPassedAt = ptr(t0.Add(time.Hour))
	c.RawDeletedAt = ptr(t0.Add(2 * time.Hour))
	c.PublishedAt = ptr(t0.Add(3 * time.Hour))
	c.MockEligible = true
	c.MockReasons = []string{"ok"}
	c.WorkflowRuns = []string{"run_1", "run_2"}
	c.Round = 2
	c.UpdatedAt = t0.Add(3 * time.Hour)
	return c
}

// canon renders v as JSON with object keys sorted and nil/empty collections and JSON null
// treated alike, so MemStore copies and Postgres round trips compare equal when they mean the
// same thing (jsonb reorders keys; text[] reads back empty, not nil).
func canon(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	require.NoError(t, err)
	var x any
	require.NoError(t, json.Unmarshal(raw, &x))
	out, err := json.Marshal(prune(x))
	require.NoError(t, err)
	return string(out)
}

func prune(x any) any {
	switch v := x.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, e := range v {
			if p := prune(e); p != nil {
				out[k] = p
			}
		}
		if len(out) == 0 {
			return nil
		}
		return out
	case []any:
		if len(v) == 0 {
			return nil
		}
		out := make([]any, len(v))
		for i, e := range v {
			out[i] = prune(e)
		}
		return out
	default:
		return v
	}
}

func requireSame(t *testing.T, want, got any) {
	t.Helper()
	require.JSONEq(t, canon(t, want), canon(t, got))
}

func refs(cs []*clips.Clip) []string {
	out := make([]string, 0, len(cs))
	for _, c := range cs {
		out = append(out, c.Ref())
	}
	return out
}

// RunStoreContract runs the clips.Store behaviour suite; newFixture returns a fresh empty store.
func RunStoreContract(t *testing.T, newFixture func(t *testing.T) Fixture) {
	t.Run("NextClipNumberPerPrefix", func(t *testing.T) {
		f := newFixture(t)
		for i := 1; i <= 3; i++ {
			n, err := f.Store.NextClipNumber(ctx(), "JK")
			require.NoError(t, err)
			require.Equal(t, i, n)
		}
		n, err := f.Store.NextClipNumber(ctx(), "JMU")
		require.NoError(t, err)
		require.Equal(t, 1, n, "prefixes count independently")
	})

	t.Run("NextClipNumberAtomic", func(t *testing.T) {
		f := newFixture(t)
		const workers = 16
		got := make([]int, workers)
		var wg sync.WaitGroup
		errs := make(chan error, workers)
		for i := 0; i < workers; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				n, err := f.Store.NextClipNumber(ctx(), "KL")
				if err != nil {
					errs <- err
					return
				}
				got[i] = n
			}(i)
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			require.NoError(t, err)
		}
		sort.Ints(got)
		for i, n := range got {
			require.Equal(t, i+1, n, "numbers are unique and gapless: %v", got)
		}
	})

	t.Run("InsertGetRoundTrip", func(t *testing.T) {
		f := newFixture(t)
		raw := NewClip("JK-0001", 1, f.ConsentID)
		require.NoError(t, f.Store.InsertClip(ctx(), raw))
		got, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		requireSame(t, raw, got)
		require.Equal(t, "", got.FilmedOn)
		require.Nil(t, got.FlashPassed)
		require.Nil(t, got.AuditPassedAt)
		require.Nil(t, got.Adjudication)

		full := fullClip("JK-0002", f.ConsentID)
		require.NoError(t, f.Store.InsertClip(ctx(), full))
		got, err = f.Store.GetClip(ctx(), "JK-0002", 2)
		require.NoError(t, err)
		requireSame(t, full, got)
		require.Equal(t, "2026-10-01", got.FilmedOn)
		require.True(t, got.UpdatedAt.Equal(full.UpdatedAt), "updated_at is the caller's clock, not the database's")
		require.True(t, got.PublishedAt.Equal(*full.PublishedAt))
		require.Equal(t, f.ConsentID, got.ContributorConsentID)
	})

	t.Run("AIGeneratedLifecycle", func(t *testing.T) {
		f := newFixture(t)
		c := NewAIClip("JK-0001", 1, "b1")
		require.NoError(t, f.Store.InsertClip(ctx(), c))
		got, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		requireSame(t, c, got)
		require.Equal(t, "", got.ContributorConsentID)
		require.Equal(t, "", got.RawObjectKey)
		byKey, err := f.Store.ClipByGenerationKey(ctx(), c.GenerationKey)
		require.NoError(t, err)
		require.Equal(t, "JK-0001", byKey.ClipID)
		_, err = f.Store.ClipByGenerationKey(ctx(), clips.GenerationKey("SCN-001", 1, "other"))
		require.ErrorIs(t, err, clips.ErrNotFound)
		require.Error(t, f.Store.InsertClip(ctx(), NewAIClip("JK-0002", 1, "b1")), "one clip per scene revision and batch")

		// Generated, reviewed (a failing review first), rated and published without a blur audit.
		got.RawObjectKey = "generated/SCN-001/v1/b1/normalised.mp4"
		setStatus(got, clips.StatusRated)
		got.Doc.Media = []clips.MediaEntry{{Res: "360p", Bytes: 1, SHA256: strings.Repeat("a", 64)}, {Res: "480p", Bytes: 2, SHA256: strings.Repeat("b", 64)}}
		got.SyntheticReview = &clips.SyntheticReviewRecord{Reviewer: "curator-01", ReviewedAt: t0, Checks: clips.SyntheticChecks{NoRealPersonLikeness: true},
			Passed: false, Note: "a logo on the bus"}
		require.NoError(t, f.Store.UpdateClip(ctx(), got))
		failed, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		requireSame(t, got, failed)
		all := clips.SyntheticChecks{NoRealPersonLikeness: true, NoReadablePlates: true, NoRealBrands: true, NoCollisionOrInjury: true, HazardVisible: true}
		failed.SyntheticReview = &clips.SyntheticReviewRecord{Reviewer: "curator-01", ReviewedAt: t0.Add(time.Hour), Checks: all, Passed: true}
		failed.Doc.SyntheticReview = &clips.SyntheticReview{Reviewer: "curator-01", CheckedAt: "2026-10-24T07:00:00.000Z", NoRealPersonLikeness: true,
			NoReadablePlates: true, NoRealBrands: true, NoCollisionOrInjury: true, HazardVisible: true}
		require.NoError(t, f.Store.UpdateClip(ctx(), failed))
		setStatus(failed, clips.StatusPublished)
		failed.PublishedAt = ptr(t0.Add(2 * time.Hour))
		require.NoError(t, f.Store.UpdateClip(ctx(), failed))
		pub, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		requireSame(t, failed, pub)
		require.Nil(t, pub.AuditPassedAt)
	})

	t.Run("InsertDuplicateFails", func(t *testing.T) {
		f := newFixture(t)
		require.NoError(t, f.Store.InsertClip(ctx(), NewClip("JK-0001", 1, f.ConsentID)))
		require.Error(t, f.Store.InsertClip(ctx(), NewClip("JK-0001", 1, f.ConsentID)))
	})

	t.Run("GetNotFoundAndLatest", func(t *testing.T) {
		f := newFixture(t)
		_, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.ErrorIs(t, err, clips.ErrNotFound)
		_, err = f.Store.GetClip(ctx(), "JK-0001", 0)
		require.ErrorIs(t, err, clips.ErrNotFound)
		for _, v := range []int{1, 3, 2} {
			require.NoError(t, f.Store.InsertClip(ctx(), NewClip("JK-0001", v, f.ConsentID)))
		}
		require.NoError(t, f.Store.InsertClip(ctx(), NewClip("JK-0002", 7, f.ConsentID)))
		got, err := f.Store.GetClip(ctx(), "JK-0001", 0)
		require.NoError(t, err)
		require.Equal(t, 3, got.Version, "version 0 is the latest version")
		_, err = f.Store.GetClip(ctx(), "JK-0001", 4)
		require.ErrorIs(t, err, clips.ErrNotFound)
	})

	t.Run("UpdateReplacesRecord", func(t *testing.T) {
		f := newFixture(t)
		c := NewClip("JK-0001", 1, f.ConsentID)
		require.ErrorIs(t, f.Store.UpdateClip(ctx(), c), clips.ErrNotFound)
		require.NoError(t, f.Store.InsertClip(ctx(), c))

		c, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		setStatus(c, clips.StatusProposed)
		c.Doc.Media = []clips.MediaEntry{{Res: "360p", Bytes: 1, SHA256: strings.Repeat("a", 64)}}
		c.WorkflowRuns = append(c.WorkflowRuns, "run_x")
		c.FlashPassed = ptr(false)
		c.FilmedOn = "2026-09-30"
		c.BlurRegions = json.RawMessage(`{"plates":[]}`)
		c.UpdatedAt = t0.Add(time.Minute)
		require.NoError(t, f.Store.UpdateClip(ctx(), c))
		got, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		requireSame(t, c, got)

		// Clearing optional fields clears them.
		got.FilmedOn, got.FlashPassed, got.BlurRegions = "", nil, nil
		require.NoError(t, f.Store.UpdateClip(ctx(), got))
		again, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		require.Equal(t, "", again.FilmedOn)
		require.Nil(t, again.FlashPassed)
		require.Equal(t, canon(t, json.RawMessage(nil)), canon(t, again.BlurRegions))

		// Returned records are copies.
		again.WorkflowRuns[0] = "mutated"
		fresh, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		require.Equal(t, "run_x", fresh.WorkflowRuns[0])
	})

	t.Run("BlurAuditLifecycle", func(t *testing.T) {
		// pending → failed (summary, no pass) → passed → published, all stored and read back.
		f := newFixture(t)
		c := NewClip("JK-0001", 1, f.ConsentID)
		setStatus(c, clips.StatusRated)
		require.NoError(t, f.Store.InsertClip(ctx(), c))
		c.Doc.BlurAudit = &clips.DocBlurAudit{Auditor: "auditor-01", FramesChecked: 1000, Misses: 0, AuditedAt: "2026-10-24T06:00:00.000Z"}
		require.NoError(t, f.Store.UpdateClip(ctx(), c))
		got, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		require.Nil(t, got.AuditPassedAt)
		require.NotNil(t, got.Doc.BlurAudit)
		got.AuditPassedAt = ptr(t0.Add(time.Hour))
		require.NoError(t, f.Store.UpdateClip(ctx(), got))
		setStatus(got, clips.StatusPublished)
		got.PublishedAt = ptr(t0.Add(2 * time.Hour))
		require.NoError(t, f.Store.UpdateClip(ctx(), got))
		pub, err := f.Store.GetClip(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		requireSame(t, got, pub)
		// A failing re-audit of a rated clip clears the pass.
		c2 := NewClip("JK-0002", 1, f.ConsentID)
		setStatus(c2, clips.StatusRated)
		c2.AuditPassedAt = ptr(t0)
		c2.Doc.BlurAudit = &clips.DocBlurAudit{Auditor: "auditor-01", FramesChecked: 1140, AuditedAt: "2026-10-24T06:00:00.000Z"}
		require.NoError(t, f.Store.InsertClip(ctx(), c2))
		c2.AuditPassedAt = nil
		c2.Doc.BlurAudit.Misses = 1
		require.NoError(t, f.Store.UpdateClip(ctx(), c2))
		got2, err := f.Store.GetClip(ctx(), "JK-0002", 1)
		require.NoError(t, err)
		require.Nil(t, got2.AuditPassedAt)
		require.Equal(t, 1, got2.Doc.BlurAudit.Misses)
	})

	t.Run("ListFilterAndOrder", func(t *testing.T) {
		f := newFixture(t)
		empty, err := f.Store.ListClips(ctx(), clips.ListFilter{})
		require.NoError(t, err)
		require.Empty(t, empty)

		mk := func(id string, v int, st clips.Status, tags ...string) {
			c := NewClip(id, v, f.ConsentID)
			setStatus(c, st)
			if st == clips.StatusPublished {
				c.AuditPassedAt, c.PublishedAt = ptr(t0), ptr(t0)
			}
			c.Doc.TenantTags = tags
			require.NoError(t, f.Store.InsertClip(ctx(), c))
		}
		mk("KL-0002", 1, clips.StatusPublished, "KL")
		mk("JK-0001", 2, clips.StatusPublished, "JK", "KL")
		mk("JK-0001", 1, clips.StatusRetired, "JK")
		mk("JK-0003", 1, clips.StatusRaw, "JK")
		mk("AB-0009", 1, clips.StatusProposed, "AB")

		all, err := f.Store.ListClips(ctx(), clips.ListFilter{})
		require.NoError(t, err)
		require.Equal(t, []string{"AB-0009@1", "JK-0001@1", "JK-0001@2", "JK-0003@1", "KL-0002@1"}, refs(all))

		rel, err := f.Store.ListClips(ctx(), clips.ListFilter{Status: []clips.Status{clips.StatusPublished, clips.StatusRetired}})
		require.NoError(t, err)
		require.Equal(t, []string{"JK-0001@1", "JK-0001@2", "KL-0002@1"}, refs(rel))

		kl, err := f.Store.ListClips(ctx(), clips.ListFilter{Tenant: "KL"})
		require.NoError(t, err)
		require.Equal(t, []string{"JK-0001@2", "KL-0002@1"}, refs(kl), "tenant matches any tenant tag")

		both, err := f.Store.ListClips(ctx(), clips.ListFilter{Status: []clips.Status{clips.StatusPublished}, Tenant: "JK"})
		require.NoError(t, err)
		require.Equal(t, []string{"JK-0001@2"}, refs(both))

		none, err := f.Store.ListClips(ctx(), clips.ListFilter{Tenant: "MH"})
		require.NoError(t, err)
		require.Empty(t, none)
	})

	t.Run("RatingsUpsertAndOrder", func(t *testing.T) {
		f := newFixture(t)
		require.NoError(t, f.Store.InsertClip(ctx(), NewClip("JK-0001", 1, f.ConsentID)))
		require.NoError(t, f.Store.InsertClip(ctx(), NewClip("JK-0001", 2, f.ConsentID)))
		none, err := f.Store.Ratings(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		require.Empty(t, none)

		rating := func(rater string, a int, at time.Time) *clips.Rating {
			return &clips.Rating{ClipID: "JK-0001", Version: 1, Rater: rater, SavedAt: at,
				Submission: clips.RaterSubmission{Rater: rater, ClipID: "JK-0001", Version: 1, SubmittedAt: at.Format("2006-01-02T15:04:05.000Z"),
					Marks: []clips.RaterMark{{HazardType: "bus_stop_pedestrian", AMs: a, BMs: a + 4500, Cue: ptr("feet")}}}}
		}
		// Same save instant (a fixed clock): order is save order, not rater name.
		first := rating("rater-zz", 12000, t0)
		require.NoError(t, f.Store.UpsertRating(ctx(), first))
		require.NoError(t, f.Store.UpsertRating(ctx(), rating("rater-aa", 12500, t0)))
		// A re-save replaces the marks and keeps the rater's place.
		resaved := rating("rater-zz", 13000, t0.Add(time.Minute))
		require.NoError(t, f.Store.UpsertRating(ctx(), resaved))
		other := rating("rater-01", 1000, t0)
		other.Version, other.Submission.Version = 2, 2
		require.NoError(t, f.Store.UpsertRating(ctx(), other))

		got, err := f.Store.Ratings(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		require.Len(t, got, 2)
		require.Equal(t, "rater-zz", got[0].Rater)
		require.Equal(t, "rater-aa", got[1].Rater)
		requireSame(t, resaved, got[0])
		require.True(t, got[0].SavedAt.Equal(t0.Add(time.Minute)))
	})

	t.Run("BlurAuditsLatest", func(t *testing.T) {
		f := newFixture(t)
		require.NoError(t, f.Store.InsertClip(ctx(), NewClip("JK-0001", 1, f.ConsentID)))
		_, err := f.Store.LatestBlurAudit(ctx(), "JK-0001", 1)
		require.ErrorIs(t, err, clips.ErrNotFound)
		a1 := &clips.BlurAudit{ClipID: "JK-0001", Version: 1, Auditor: "auditor-01", RenditionSHA256: strings.Repeat("b", 64),
			FramesTotal: 1140, FramesChecked: 1140, Misses: 1, MissFrames: []clips.BlurAuditMiss{{Frame: 100, Kind: "plate", Note: "rear"}},
			AuditedAt: t0}
		a2 := &clips.BlurAudit{ClipID: "JK-0001", Version: 1, Auditor: "auditor-02", RenditionSHA256: strings.Repeat("b", 64),
			FramesTotal: 1140, FramesChecked: 1140, MissFrames: []clips.BlurAuditMiss{}, AuditedAt: t0}
		require.NoError(t, f.Store.InsertBlurAudit(ctx(), a1))
		require.NoError(t, f.Store.InsertBlurAudit(ctx(), a2))
		got, err := f.Store.LatestBlurAudit(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		requireSame(t, a2, got)
		_, err = f.Store.LatestBlurAudit(ctx(), "JK-0001", 2)
		require.ErrorIs(t, err, clips.ErrNotFound)
	})

	t.Run("RawDeletionOncePerVersion", func(t *testing.T) {
		f := newFixture(t)
		require.NoError(t, f.Store.InsertClip(ctx(), NewClip("JK-0001", 1, f.ConsentID)))
		_, err := f.Store.RawDeletion(ctx(), "JK-0001", 1)
		require.ErrorIs(t, err, clips.ErrNotFound)
		d := &clips.RawDeletion{ClipID: "JK-0001", Version: 1, ObjectKeys: []string{"raw/JK-0001.mp4", "private/JK-0001/v1/mezzanine.mp4"},
			Reason: "audit_passed", UploadedAt: t0, AuditPassedAt: ptr(t0.Add(time.Hour)), DeletedAt: t0.Add(2 * time.Hour),
			DeletedBy: "clip_finalize", Deadline: t0.Add(25 * time.Hour), OnTime: true}
		require.NoError(t, f.Store.InsertRawDeletion(ctx(), d))
		got, err := f.Store.RawDeletion(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		requireSame(t, d, got)
		require.Equal(t, d.ObjectKeys, got.ObjectKeys, "key order is kept")
		dup := *d
		dup.Reason = "takedown"
		require.Error(t, f.Store.InsertRawDeletion(ctx(), &dup))
		got, err = f.Store.RawDeletion(ctx(), "JK-0001", 1)
		require.NoError(t, err)
		require.Equal(t, "audit_passed", got.Reason)
	})

	t.Run("ManifestsLatestIsLastSaved", func(t *testing.T) {
		f := newFixture(t)
		_, err := f.Store.LatestManifest(ctx())
		require.ErrorIs(t, err, clips.ErrNotFound)
		man := func(v string, at time.Time) *clips.Manifest {
			return &clips.Manifest{Version: v, GeneratedAt: at, Bank: json.RawMessage(`{"digest":"sha256:` + v + `","clips":[]}`),
				Client: json.RawMessage(`{"digest":"sha256:` + v + `"}`),
				MockEligibility: map[string]clips.Eligibility{"JK-0001@1": {Eligible: true, Reasons: []string{}},
					"JK-0002@1": {Eligible: false, Reasons: []string{"flash"}}}}
		}
		// Same generatedAt (a fixed clock): the latest is the last saved.
		require.NoError(t, f.Store.SaveManifest(ctx(), man("aaaa", t0)))
		require.NoError(t, f.Store.SaveManifest(ctx(), man("bbbb", t0)))
		got, err := f.Store.LatestManifest(ctx())
		require.NoError(t, err)
		requireSame(t, man("bbbb", t0), got)
		// Saving an earlier version again makes it the latest.
		require.NoError(t, f.Store.SaveManifest(ctx(), man("aaaa", t0.Add(time.Minute))))
		got, err = f.Store.LatestManifest(ctx())
		require.NoError(t, err)
		require.Equal(t, "aaaa", got.Version)
		require.True(t, got.GeneratedAt.Equal(t0.Add(time.Minute)))
	})
}
