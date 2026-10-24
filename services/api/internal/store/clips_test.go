package store_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	adnotify "github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/clips/clipstest"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/testdb"
)

var clipsT0 = time.Date(2026, 10, 24, 6, 0, 0, 0, time.UTC)

// clipsConsent inserts a JK applicant and an active clip_contribution consent artefact.
func clipsConsent(t *testing.T, db *store.DB) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	app := &store.Applicant{ID: ids.New(), TenantID: "JK", Kind: "device"}
	consent := &store.Consent{ID: ids.New(), TenantID: "JK", ApplicantID: app.ID, Purpose: "clip_contribution",
		DataCategories: []string{"dashcam_footage"}, NoticeVersion: "2026.10", GrantedAt: clipsT0}
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		if err := store.InsertApplicant(ctx, tx, app); err != nil {
			return err
		}
		return store.InsertConsent(ctx, tx, consent)
	}))
	return consent.ID
}

func clipsFixture(t *testing.T) (*store.ClipsStore, *store.DB, uuid.UUID) {
	t.Helper()
	db := testdb.Open(t)
	return store.NewClipsStore(db), db, clipsConsent(t, db)
}

func TestClipsStoreContract(t *testing.T) {
	clipstest.RunStoreContract(t, func(t *testing.T) clipstest.Fixture {
		s, _, consent := clipsFixture(t)
		return clipstest.Fixture{Store: s, ConsentID: consent.String()}
	})
}

// The blur_audit column follows the record, so the table's published CHECK always holds.
func TestClipsBlurAuditColumnDerived(t *testing.T) {
	s, db, consent := clipsFixture(t)
	ctx := context.Background()
	col := func() string {
		var v string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT blur_audit FROM content.clips WHERE clip_id = 'JK-0001'`).Scan(&v))
		return v
	}
	c := clipstest.NewClip("JK-0001", 1, consent.String())
	c.Status, c.Doc.Status = clips.StatusRated, clips.StatusRated
	require.NoError(t, s.InsertClip(ctx, c))
	require.Equal(t, "pending", col())
	c.Doc.BlurAudit = &clips.DocBlurAudit{Auditor: "auditor-01", FramesChecked: 1000, AuditedAt: "2026-10-24T06:00:00.000Z"}
	require.NoError(t, s.UpdateClip(ctx, c))
	require.Equal(t, "failed", col())
	at := clipsT0.Add(time.Hour)
	c.AuditPassedAt = &at
	require.NoError(t, s.UpdateClip(ctx, c))
	require.Equal(t, "passed", col())

	// Publishing without a passed audit violates the table CHECK (MemStore would accept it; the
	// service never does it: publishViolations requires the audit).
	c2 := clipstest.NewClip("JK-0002", 1, consent.String())
	c2.Status, c2.Doc.Status = clips.StatusPublished, clips.StatusPublished
	c2.PublishedAt = &at
	require.Error(t, s.InsertClip(ctx, c2))
}

func TestClipsColumnsAndErrors(t *testing.T) {
	s, db, consent := clipsFixture(t)
	ctx := context.Background()

	// filmed_on is a date; "" is NULL.
	c := clipstest.NewClip("JK-0001", 1, consent.String())
	c.FilmedOn = "2026-10-01"
	require.NoError(t, s.InsertClip(ctx, c))
	var filmed *time.Time
	var tags []string
	var tenant string
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT filmed_on, tenant_tags, tenant FROM content.clips WHERE clip_id = 'JK-0001'`).
		Scan(&filmed, &tags, &tenant))
	require.NotNil(t, filmed)
	require.Equal(t, "2026-10-01", filmed.Format("2006-01-02"))
	require.Equal(t, []string{"JK"}, tags)
	require.Equal(t, "JK", tenant)
	c.FilmedOn = ""
	require.NoError(t, s.UpdateClip(ctx, c))
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT filmed_on FROM content.clips WHERE clip_id = 'JK-0001'`).Scan(&filmed))
	require.Nil(t, filmed)

	// Consent IDs: not a uuid → validation error; unknown artefact → consent required.
	bad := clipstest.NewClip("JK-0002", 1, "cns_x")
	var ve *clips.ValidationError
	require.ErrorAs(t, s.InsertClip(ctx, bad), &ve)
	require.Equal(t, "/contributor_consent_id", ve.Pointer)
	unknown := clipstest.NewClip("JK-0002", 1, uuid.NewString())
	require.ErrorIs(t, s.InsertClip(ctx, unknown), clips.ErrConsentRequired)

	// A duplicate insert is a conflict.
	require.ErrorIs(t, s.InsertClip(ctx, clipstest.NewClip("JK-0001", 1, consent.String())), store.ErrConflict)

	// clip.json must agree with the record (also a table CHECK).
	mismatch := clipstest.NewClip("JK-0003", 1, consent.String())
	mismatch.Doc.Status = clips.StatusProposed
	require.Error(t, s.InsertClip(ctx, mismatch))
}

// The raw-deletion log is append-only even for mg_jobs (REVOKE UPDATE, DELETE).
func TestClipsRawDeletionAppendOnly(t *testing.T) {
	s, db, consent := clipsFixture(t)
	ctx := context.Background()
	require.NoError(t, s.InsertClip(ctx, clipstest.NewClip("JK-0001", 1, consent.String())))
	require.NoError(t, s.InsertRawDeletion(ctx, &clips.RawDeletion{ClipID: "JK-0001", Version: 1, ObjectKeys: []string{"raw/JK-0001.mp4"},
		Reason: "retention_limit", UploadedAt: clipsT0, DeletedAt: clipsT0.Add(time.Hour), DeletedBy: "clip_finalize",
		Deadline: clipsT0.Add(7 * 24 * time.Hour), OnTime: true}))
	for _, q := range []string{`UPDATE content.clip_raw_deletions SET reason = 'takedown'`, `DELETE FROM content.clip_raw_deletions`} {
		require.Error(t, db.System(ctx, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, q); return err }), q)
		require.Error(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error { _, err := tx.Exec(ctx, q); return err }), q)
	}
	// URLs never enter the log.
	err := s.InsertRawDeletion(ctx, &clips.RawDeletion{ClipID: "JK-0001", Version: 1, ObjectKeys: []string{"https://x/raw.mp4"},
		Reason: "takedown", UploadedAt: clipsT0, DeletedAt: clipsT0, DeletedBy: "clip_finalize", Deadline: clipsT0})
	require.Error(t, err)
}

// Calls made inside a carried transaction (ContextWithTx) commit or roll back with it.
func TestClipsCarriedTransaction(t *testing.T) {
	s, db, _ := clipsFixture(t)
	ctx := context.Background()
	boom := errors.New("boom")
	err := db.System(ctx, func(tx pgx.Tx) error {
		n, err := s.NextClipNumber(store.ContextWithTx(ctx, tx), "JK")
		require.NoError(t, err)
		require.Equal(t, 1, n)
		return boom
	})
	require.ErrorIs(t, err, boom)
	n, err := s.NextClipNumber(ctx, "JK")
	require.NoError(t, err)
	require.Equal(t, 1, n, "the rolled-back increment is gone")
}

// ---- clips.Service on the pgx store (fakes copied from internal/clips/clips_test.go) ---------

type clipsFakeCompute struct {
	accept    bool
	manifests int
}

func (f *clipsFakeCompute) Agreement(_ context.Context, req clips.AgreementRequest) (*clips.AgreementResponse, error) {
	g := clips.AgreementResult{ClipID: req.RaterA.ClipID, Version: req.RaterA.Version, Raters: []string{req.RaterA.Rater, req.RaterB.Rater},
		Accepted: f.accept, NeedsThirdRater: !f.accept, Reasons: []string{},
		Pairs: []clips.AgreementPair{{A: req.RaterA.Marks[0], B: req.RaterB.Marks[0], DeltaOnsetMs: 500, Accepted: f.accept}}}
	if f.accept {
		g.FinalHazards = []clips.FinalHazard{{HazardID: "h1", HazardType: "bus_stop_pedestrian", Window: clips.FWindow{AMs: 12267, BMs: 16767},
			RaterCount: 2, DeltaOnsetMs: 500, DeltaEndMs: 500, Cues: []string{"feet at bus front"}}}
	} else {
		g.Reasons = []string{"onset_delta"}
	}
	raw, err := json.Marshal(g)
	if err != nil {
		return nil, err
	}
	return &clips.AgreementResponse{Op: req.Op, Agreement: &g, Raw: raw}, nil
}

func (f *clipsFakeCompute) Manifests(_ context.Context, req clips.ManifestsRequest) (*clips.ManifestsResponse, error) {
	f.manifests++
	elig := map[string]clips.Eligibility{}
	for _, raw := range req.Clips {
		var d clips.Doc
		_ = json.Unmarshal(raw, &d)
		elig[d.Ref()] = clips.Eligibility{Eligible: d.Status == clips.StatusPublished, Reasons: []string{}}
	}
	return &clips.ManifestsResponse{GeneratedAt: time.UnixMilli(req.Now).UTC().Format(time.RFC3339Nano),
		Bank: json.RawMessage(`{"digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbb"}`), Client: json.RawMessage(`{"digest":"sha256:cccccccccccccccccccccccc"}`),
		MockEligibility: elig}, nil
}

type clipsFakeObjects struct{ deleted []string }

func (f *clipsFakeObjects) Delete(_ context.Context, key string) error {
	f.deleted = append(f.deleted, key)
	return nil
}

func (f *clipsFakeObjects) PresignGet(_ context.Context, key string, _ time.Duration) (string, error) {
	return "https://media.example/" + key + "?sig=x", nil
}

func (f *clipsFakeObjects) Put(context.Context, string, []byte, string) error { return nil }

type clipsFakeWebhooks struct{ posts int }

func (f *clipsFakeWebhooks) PostEnvelope(context.Context, string, adnotify.Envelope) error {
	f.posts++
	return nil
}

type clipsFakeJobs struct{ started []string }

func (f *clipsFakeJobs) StartJob(_ context.Context, _ *string, job string, _ []any, idem string) (string, error) {
	f.started = append(f.started, job+"|"+idem)
	return "run_" + idem, nil
}

const clipsMetadata = `{"tenantTags":["JK"],"city":"Jammu","roadType":"urban_arterial","timeOfDay":"day","weather":"clear","pov":"2W",
"capturedMonth":"2026-10","speedKmhEst":40,"speedSource":"rider_log","durationMs":38000,"quietSegments":[{"fromMs":0,"toMs":9000}],
"difficulty":{"curator":3,"empirical":null,"irt":null,"nTakers":0},"modules":["M18"]}`

// The publish flow (register → open review → rate ×2 → agreement → cues → blur audit → publish
// → manifest) and raw deletion, end to end on Postgres; mirrors
// TestPublish_RequiresTwoRatingsAnd100PctBlurAudit and TestRawDeletion_Logged.
func TestClipsServicePublishFlow(t *testing.T) {
	st, db, consent := clipsFixture(t)
	ctx := context.Background()
	clock := servertime.NewFixed(clipsT0)
	compute := &clipsFakeCompute{accept: true}
	objects := &clipsFakeObjects{}
	hooks := &clipsFakeWebhooks{}
	jobs := &clipsFakeJobs{}
	svc := &clips.Service{Store: st, Compute: compute, Objects: objects, Webhooks: hooks, Jobs: jobs, Clock: clock,
		HMACSecret: []byte("test-secret"), ClipReadyPath: "/webhook/md/clip-ready"}
	curator, raterA, raterB, auditor := clips.Actor{Pseudonym: "curator-01"}, clips.Actor{Pseudonym: "rater-01"},
		clips.Actor{Pseudonym: "rater-02"}, clips.Actor{Pseudonym: "auditor-01"}
	sha360, sha480 := strings.Repeat("a", 64), strings.Repeat("b", 64)

	c, err := svc.Register(ctx, curator, clips.RegisterInput{RawObjectKey: "raw/upload-1.mp4", State: "JK", FilmedBy: "passenger",
		FilmedOn: "2026-10-20", Licence: clips.Licence, ContributorConsentID: consent.String(), Metadata: json.RawMessage(clipsMetadata)})
	require.NoError(t, err)
	require.Equal(t, "JK-0001", c.ClipID)
	require.Equal(t, []string{"clip_ingest|JK-0001:ingest:1"}, jobs.started)

	_, err = svc.Steps()["clip.open_review"](ctx, map[string]any{"clip_id": c.ClipID, "version": 1,
		"idempotency_key": "JK-0001:open_review:1", "flash_passed": true,
		"intermediate_keys": []any{"private/JK-0001/v1/mezzanine.mp4"},
		"media": []any{map[string]any{"res": "360p", "bytes": 1840000, "sha256": sha360},
			map[string]any{"res": "480p", "bytes": 2900000, "sha256": sha480}}})
	require.NoError(t, err)
	require.Equal(t, 1, hooks.posts)

	mark := func(a, b int) []clips.RaterMark {
		return []clips.RaterMark{{HazardType: "bus_stop_pedestrian", AMs: a, BMs: b}}
	}
	_, err = svc.Rate(ctx, raterA, c.ClipID, 1, mark(12000, 16500))
	require.NoError(t, err)
	_, err = svc.Rate(ctx, raterA, c.ClipID, 1, mark(12100, 16600)) // re-save before the second rater
	require.NoError(t, err)
	res, err := svc.Rate(ctx, raterB, c.ClipID, 1, mark(12500, 17000))
	require.NoError(t, err)
	require.True(t, res.BothSaved)
	_, err = svc.Rate(ctx, raterA, c.ClipID, 1, mark(1, 2))
	require.ErrorIs(t, err, clips.ErrRatingsFrozen)
	_, err = svc.Rate(ctx, clips.Actor{Pseudonym: "rater-03"}, c.ClipID, 1, mark(1, 2))
	require.ErrorIs(t, err, clips.ErrTooManyRaters)
	ratings, err := st.Ratings(ctx, c.ClipID, 1)
	require.NoError(t, err)
	require.Equal(t, "rater-01", ratings[0].Rater)
	require.Equal(t, 12100, ratings[0].Submission.Marks[0].AMs)

	out, err := svc.Steps()["clip.agreement"](ctx, map[string]any{"clip_id": c.ClipID, "version": 1})
	require.NoError(t, err)
	require.Equal(t, true, out["accepted"])
	_, err = svc.SetCueTexts(ctx, curator, c.ClipID, 1, map[string]clips.CueText{"h1": {En: "Feet at the bus front", Hi: "बस के आगे पैर"}})
	require.NoError(t, err)

	full := clips.ExpectedFrameCount(38000, clips.DeliveryFPS)
	audit := func(checked, misses int) *clips.BlurAuditResult {
		miss := make([]clips.BlurAuditMiss, misses)
		for i := range miss {
			miss[i] = clips.BlurAuditMiss{Frame: 100 + i, Kind: "plate"}
		}
		r, err := svc.SubmitBlurAudit(ctx, auditor, c.ClipID, 1, clips.BlurAuditInput{RenditionSHA256: sha480,
			FramesTotal: full, FramesChecked: checked, Misses: misses, MissFrames: miss})
		require.NoError(t, err)
		return r
	}
	require.False(t, audit(full-12, 0).Passed)
	_, err = svc.Publish(ctx, curator, c.ClipID, 1)
	var pb *clips.PublishBlockedError
	require.ErrorAs(t, err, &pb)
	require.Equal(t, "blur_audit", pb.Violations[0].Code)
	require.False(t, audit(full, 1).Passed)
	var col string
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT blur_audit FROM content.clips WHERE clip_id = 'JK-0001'`).Scan(&col))
	require.Equal(t, "failed", col)
	require.True(t, audit(full, 0).Passed)

	// A malformed audit is refused before it reaches the audit log's CHECKs.
	_, err = svc.SubmitBlurAudit(ctx, auditor, c.ClipID, 1, clips.BlurAuditInput{RenditionSHA256: sha480, FramesTotal: full,
		FramesChecked: full, Misses: 1})
	var ve *clips.ValidationError
	require.ErrorAs(t, err, &ve)

	clock.Advance(time.Hour)
	got, err := svc.Publish(ctx, curator, c.ClipID, 1)
	require.NoError(t, err)
	require.Equal(t, clips.StatusPublished, got.Status)
	require.Equal(t, 1, compute.manifests)

	stored, err := st.GetClip(ctx, c.ClipID, 0)
	require.NoError(t, err)
	require.Equal(t, clips.StatusPublished, stored.Status)
	require.True(t, stored.MockEligible, "mock eligibility from /clip/manifests")
	require.NotNil(t, stored.PublishedAt)
	require.True(t, stored.PublishedAt.Equal(clipsT0.Add(time.Hour)))
	require.True(t, stored.UpdatedAt.Equal(clipsT0.Add(time.Hour)))
	require.Equal(t, "2026-10-20", stored.FilmedOn)
	require.Equal(t, "JK", stored.Tenant)
	require.Len(t, stored.Doc.Hazards, 1)
	require.NoError(t, clips.ValidateDocStruct(&stored.Doc))
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT blur_audit FROM content.clips WHERE clip_id = 'JK-0001'`).Scan(&col))
	require.Equal(t, "passed", col)
	m, err := st.LatestManifest(ctx)
	require.NoError(t, err)
	require.Equal(t, "cccccccccccccccc", m.Version)

	// Scoring and API-37 read the published clip back.
	docs, err := svc.ScoringDocs(ctx, []string{"clip:JK-0001@1"})
	require.NoError(t, err)
	require.Len(t, docs, 1)
	page, err := svc.ListNazarClips(ctx, clips.ClipQuery{State: "JK"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, "cccccccccccccccc", page.ManifestVersion)
	items, err := svc.MockEligible(ctx, "JK", nil, 1)
	require.NoError(t, err)
	require.Equal(t, "clip:JK-0001@1", items[0].Ref)

	// Raw deletion after the passing audit: logged once, idempotent.
	del := svc.Steps()["clip.delete_raw"]
	out, err = del(ctx, map[string]any{"clip_id": c.ClipID, "version": 1})
	require.NoError(t, err)
	require.Equal(t, true, out["deleted"])
	require.Equal(t, "audit_passed", out["reason"])
	require.Equal(t, []string{"raw/upload-1.mp4", "private/JK-0001/v1/mezzanine.mp4"}, objects.deleted)
	out, err = del(ctx, map[string]any{"clip_id": c.ClipID, "version": 1})
	require.NoError(t, err)
	require.Equal(t, true, out["replayed"])
	rec, err := st.RawDeletion(ctx, c.ClipID, 1)
	require.NoError(t, err)
	require.Equal(t, "clip_finalize", rec.DeletedBy)
	stored, err = st.GetClip(ctx, c.ClipID, 1)
	require.NoError(t, err)
	require.NotNil(t, stored.RawDeletedAt)

	// The clip number counter continues.
	c2, err := svc.Register(ctx, curator, clips.RegisterInput{RawObjectKey: "raw/upload-2.mp4", State: "JK", FilmedBy: "fixed_mount",
		Licence: clips.Licence, ContributorConsentID: consent.String(), Metadata: json.RawMessage(clipsMetadata)})
	require.NoError(t, err)
	require.Equal(t, "JK-0002", c2.ClipID)
	_, err = svc.Register(ctx, curator, clips.RegisterInput{RawObjectKey: "raw/upload-3.mp4", State: "JK", Prefix: "jk", FilmedBy: "passenger",
		Licence: clips.Licence, ContributorConsentID: consent.String(), Metadata: json.RawMessage(clipsMetadata)})
	require.ErrorAs(t, err, &ve)
}

// The adjudication path: disagreement → adjudication → resolved → rated, on Postgres.
func TestClipsServiceAdjudicationFlow(t *testing.T) {
	st, _, consent := clipsFixture(t)
	ctx := context.Background()
	compute := &clipsFakeCompute{accept: false}
	adjCompute := &clipsAdjCompute{clipsFakeCompute: compute}
	svc := &clips.Service{Store: st, Compute: adjCompute, Objects: &clipsFakeObjects{}, Webhooks: &clipsFakeWebhooks{},
		Clock: servertime.NewFixed(clipsT0), ClipReadyPath: "/webhook/md/clip-ready"}
	curator := clips.Actor{Pseudonym: "curator-01"}
	c, err := svc.Register(ctx, curator, clips.RegisterInput{RawObjectKey: "raw/u.mp4", State: "JK", FilmedBy: "passenger",
		Licence: clips.Licence, ContributorConsentID: consent.String(), Metadata: json.RawMessage(clipsMetadata)})
	require.NoError(t, err)
	_, err = svc.Steps()["clip.open_review"](ctx, map[string]any{"clip_id": c.ClipID, "version": 1,
		"media": []any{map[string]any{"res": "360p", "bytes": 1, "sha256": strings.Repeat("a", 64)},
			map[string]any{"res": "480p", "bytes": 2, "sha256": strings.Repeat("b", 64)}}})
	require.NoError(t, err)
	for _, r := range []string{"rater-01", "rater-02"} {
		_, err = svc.Rate(ctx, clips.Actor{Pseudonym: r}, c.ClipID, 1, []clips.RaterMark{{HazardType: "cyclist", AMs: 1000, BMs: 4000}})
		require.NoError(t, err)
	}
	out, err := svc.Steps()["clip.agreement"](ctx, map[string]any{"clip_id": c.ClipID, "version": 1})
	require.NoError(t, err)
	require.Equal(t, "clip.request_adjudication", out["next"])
	_, err = svc.Steps()["clip.request_adjudication"](ctx, map[string]any{"clip_id": c.ClipID, "version": 1})
	require.NoError(t, err)
	_, err = svc.Adjudicate(ctx, clips.Actor{Pseudonym: "rater-01"}, c.ClipID, 1, clips.AdjudicationInput{ReasonCode: "x"})
	require.ErrorIs(t, err, clips.ErrAdjudicatorIsRater)
	adj, err := svc.Adjudicate(ctx, clips.Actor{Pseudonym: "rater-09"}, c.ClipID, 1, clips.AdjudicationInput{ReasonCode: "onset"})
	require.NoError(t, err)
	require.True(t, adj.Resolved)
	got, err := st.GetClip(ctx, c.ClipID, 1)
	require.NoError(t, err)
	require.Equal(t, clips.StatusRated, got.Status)
	require.NotNil(t, got.Adjudication)
	require.Equal(t, "rater-09", got.Adjudication.Adjudicator)
	require.True(t, got.Adjudication.At.Equal(clipsT0))
	require.JSONEq(t, string(adj.Input), string(got.Adjudication.Input))
	require.NotEmpty(t, got.AdjudicationEventID)
}

// clipsAdjCompute answers op=adjudicate with a resolved ruling.
type clipsAdjCompute struct{ *clipsFakeCompute }

func (f *clipsAdjCompute) Agreement(ctx context.Context, req clips.AgreementRequest) (*clips.AgreementResponse, error) {
	resp, err := f.clipsFakeCompute.Agreement(ctx, req)
	if err != nil || req.Op != "adjudicate" {
		return resp, err
	}
	hs := []clips.FinalHazard{{HazardID: "h1", HazardType: "cyclist", Window: clips.FWindow{AMs: 1000, BMs: 4000}, RaterCount: 3,
		Adjudicated: true, Cues: []string{}}}
	resp.Adjudication = &clips.AdjudicationResult{Resolved: true, Hazards: hs, Dropped: []string{}, Issues: []string{}}
	return resp, nil
}
