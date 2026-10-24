package clips

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	adnotify "github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

// ---- helpers --------------------------------------------------------------------------------

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "pnpm-workspace.yaml")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Skip("repo root (pnpm-workspace.yaml) not found")
		}
		dir = parent
	}
}

var t0 = time.Date(2026, 10, 24, 6, 0, 0, 0, time.UTC)

type fakeCompute struct {
	accept     bool
	agreements int
	manifests  int
	lastReq    AgreementRequest
	down       bool
}

func (f *fakeCompute) Agreement(_ context.Context, req AgreementRequest) (*AgreementResponse, error) {
	if f.down {
		return nil, ErrComputeUnavailable
	}
	f.agreements++
	f.lastReq = req
	g := AgreementResult{ClipID: req.RaterA.ClipID, Version: req.RaterA.Version, Raters: []string{req.RaterA.Rater, req.RaterB.Rater},
		Accepted: f.accept, NeedsThirdRater: !f.accept, Reasons: []string{},
		Pairs: []AgreementPair{{A: req.RaterA.Marks[0], B: req.RaterB.Marks[0], DeltaOnsetMs: 500, Accepted: f.accept}}}
	if f.accept {
		g.FinalHazards = []FinalHazard{{HazardID: "h1", HazardType: "bus_stop_pedestrian", Window: FWindow{AMs: 12267, BMs: 16767},
			RaterCount: 2, DeltaOnsetMs: 500, DeltaEndMs: 500, Cues: []string{"feet at bus front"}}}
	} else {
		g.Reasons = []string{"onset_delta"}
	}
	raw, _ := json.Marshal(map[string]any{"op": req.Op, "agreement": g})
	return decodeAgreement(raw)
}

func (f *fakeCompute) Manifests(_ context.Context, req ManifestsRequest) (*ManifestsResponse, error) {
	if f.down {
		return nil, ErrComputeUnavailable
	}
	f.manifests++
	elig := map[string]Eligibility{}
	for _, raw := range req.Clips {
		var d Doc
		_ = json.Unmarshal(raw, &d)
		elig[d.Ref()] = Eligibility{Eligible: d.Status == StatusPublished, Reasons: []string{}}
	}
	return &ManifestsResponse{GeneratedAt: time.UnixMilli(req.Now).UTC().Format(time.RFC3339Nano),
		Bank: json.RawMessage(`{"digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbb"}`), Client: json.RawMessage(`{"digest":"sha256:cccccccccccccccccccccccc"}`),
		MockEligibility: elig}, nil
}

type fakeObjects struct {
	deleted []string
	puts    map[string][]byte
}

func (f *fakeObjects) Delete(_ context.Context, key string) error {
	f.deleted = append(f.deleted, key)
	return nil
}

func (f *fakeObjects) PresignGet(_ context.Context, key string, ttl time.Duration) (string, error) {
	return "https://media.example/" + key + "?sig=x", nil
}

func (f *fakeObjects) Put(_ context.Context, key string, body []byte, _ string) error {
	if f.puts == nil {
		f.puts = map[string][]byte{}
	}
	f.puts[key] = body
	return nil
}

type posted struct {
	path string
	env  adnotify.Envelope
}

type fakeWebhooks struct{ posts []posted }

func (f *fakeWebhooks) PostEnvelope(_ context.Context, path string, env adnotify.Envelope) error {
	f.posts = append(f.posts, posted{path, env})
	return nil
}

type fakeJobs struct{ started []string }

func (f *fakeJobs) StartJob(_ context.Context, _ *string, job string, _ []any, idem string) (string, error) {
	f.started = append(f.started, job+"|"+idem)
	return "run_" + idem, nil
}

type harness struct {
	svc     *Service
	store   *MemStore
	compute *fakeCompute
	objects *fakeObjects
	hooks   *fakeWebhooks
	jobs    *fakeJobs
	clock   *servertime.Fixed
}

func newHarness() *harness {
	h := &harness{store: NewMemStore(), compute: &fakeCompute{accept: true}, objects: &fakeObjects{}, hooks: &fakeWebhooks{},
		jobs: &fakeJobs{}, clock: servertime.NewFixed(t0)}
	h.svc = &Service{Store: h.store, Compute: h.compute, Objects: h.objects, Webhooks: h.hooks, Jobs: h.jobs, Clock: h.clock,
		HMACSecret: []byte("test-secret"), ClipReadyPath: "/webhook/md/clip-ready"}
	return h
}

const metadata = `{"tenantTags":["JK"],"city":"Jammu","roadType":"urban_arterial","timeOfDay":"day","weather":"clear","pov":"2W",
"capturedMonth":"2026-10","speedKmhEst":40,"speedSource":"rider_log","durationMs":38000,"quietSegments":[{"fromMs":0,"toMs":9000}],
"difficulty":{"curator":3,"empirical":null,"irt":null,"nTakers":0},"modules":["M18"]}`

var (
	sha360  = strings.Repeat("a", 64)
	sha480  = strings.Repeat("b", 64)
	curator = Actor{"curator-01"}
	raterA  = Actor{"rater-01"}
	raterB  = Actor{"rater-02"}
	auditor = Actor{"auditor-01"}
)

func ctxT() context.Context { return context.Background() }

// registered registers JK-0001 and records the ingest results (status proposed).
func (h *harness) registered(t *testing.T) *Clip {
	t.Helper()
	c, err := h.svc.Register(ctxT(), curator, RegisterInput{RawObjectKey: "raw/upload-1.mp4", State: "JK", FilmedBy: "passenger",
		Licence: Licence, ContributorConsentID: "cns_x", Metadata: json.RawMessage(metadata)})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	_, err = h.svc.Steps()["clip.open_review"](ctxT(), map[string]any{"clip_id": c.ClipID, "version": 1,
		"idempotency_key": "JK-0001:open_review:1", "flash_passed": true,
		"intermediate_keys": []any{"private/JK-0001/v1/mezzanine.mp4"},
		"media":             []any{map[string]any{"res": "360p", "bytes": 1840000, "sha256": sha360}, map[string]any{"res": "480p", "bytes": 2900000, "sha256": sha480}}})
	if err != nil {
		t.Fatalf("open_review: %v", err)
	}
	got, _ := h.store.GetClip(ctxT(), c.ClipID, 1)
	return got
}

func mark(a, b int) []RaterMark {
	return []RaterMark{{HazardType: "bus_stop_pedestrian", AMs: a, BMs: b}}
}

// rated brings the clip to rated with cue texts (everything but the blur audit).
func (h *harness) rated(t *testing.T) *Clip {
	t.Helper()
	c := h.registered(t)
	if _, err := h.svc.Rate(ctxT(), raterA, c.ClipID, 1, mark(12000, 16500)); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.Rate(ctxT(), raterB, c.ClipID, 1, mark(12500, 17000)); err != nil {
		t.Fatal(err)
	}
	out, err := h.svc.Steps()["clip.agreement"](ctxT(), map[string]any{"clip_id": c.ClipID, "version": 1})
	if err != nil || out["accepted"] != true {
		t.Fatalf("agreement: %v %v", out, err)
	}
	if _, err := h.svc.SetCueTexts(ctxT(), curator, c.ClipID, 1, map[string]CueText{"h1": {En: "Feet visible at the bus's front edge", Hi: "बस के आगे पैर दिख रहे हैं"}}); err != nil {
		t.Fatal(err)
	}
	got, _ := h.store.GetClip(ctxT(), c.ClipID, 1)
	return got
}

func (h *harness) audit(t *testing.T, id string, checked, misses int) *BlurAuditResult {
	t.Helper()
	miss := make([]BlurAuditMiss, misses)
	for i := range miss {
		miss[i] = BlurAuditMiss{Frame: 100 + i, Kind: "plate"}
	}
	res, err := h.svc.SubmitBlurAudit(ctxT(), auditor, id, 1, BlurAuditInput{RenditionSHA256: sha480,
		FramesTotal: ExpectedFrameCount(38000, DeliveryFPS), FramesChecked: checked, Misses: misses, MissFrames: miss})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func violationCodes(err error) []string {
	var pb *PublishBlockedError
	if !errors.As(err, &pb) {
		return nil
	}
	var out []string
	for _, v := range pb.Violations {
		out = append(out, v.Code)
	}
	return out
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}

// ---- status conformance ---------------------------------------------------------------------

type tsTable struct {
	Statuses    []Status            `json:"statuses"`
	Transitions map[Status][]Status `json:"transitions"`
}

func checkTable(t *testing.T, name string, tbl tsTable) {
	t.Helper()
	if !reflect.DeepEqual(tbl.Statuses, Statuses) {
		t.Errorf("%s: statuses %v, Go %v", name, tbl.Statuses, Statuses)
	}
	if len(tbl.Transitions) != len(Transitions) {
		t.Errorf("%s: %d rows, Go %d", name, len(tbl.Transitions), len(Transitions))
	}
	for from, tos := range tbl.Transitions {
		got := Transitions[from]
		if len(tos) == 0 && len(got) == 0 {
			continue
		}
		if !reflect.DeepEqual(tos, got) {
			t.Errorf("%s: %s → %v, Go %v", name, from, tos, got)
		}
	}
}

func TestStatus_ConformsToClipPipeline(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "transitions.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture tsTable
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	checkTable(t, "committed fixture", fixture)

	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH: live check against clip-pipeline source skipped (fixture checked)")
	}
	dir := filepath.Join(repoRoot(t), "packages", "clip-pipeline")
	cmd := exec.Command(node, "--conditions=margdarshak-source", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
		`import {TRANSITIONS} from './src/status.ts'; import {CLIP_STATUSES} from './src/schema.ts';
process.stdout.write(JSON.stringify({statuses: CLIP_STATUSES, transitions: TRANSITIONS}));`)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("node export failed: %v\n%s", err, stderr.String())
	}
	var live tsTable
	if err := json.Unmarshal(out, &live); err != nil {
		t.Fatalf("node output: %v", err)
	}
	checkTable(t, "live clip-pipeline source", live)
}

func TestStatus_PathAndEdges(t *testing.T) {
	for _, origin := range []string{"", OriginFilmed} {
		if p := pathTo(origin, StatusRaw, StatusProposed); !reflect.DeepEqual(p, []Status{StatusTranscoded, StatusBlurred, StatusProposed}) {
			t.Fatalf("filmed path raw→proposed = %v", p)
		}
		if IsAllowedFor(origin, StatusTranscoded, StatusProposed) {
			t.Fatal("filmed clips never skip the blur")
		}
	}
	if p := pathTo(OriginAIGenerated, StatusRaw, StatusProposed); !reflect.DeepEqual(p, []Status{StatusTranscoded, StatusProposed}) {
		t.Fatalf("ai path raw→proposed = %v", p)
	}
	if IsAllowedFor(OriginAIGenerated, StatusTranscoded, StatusBlurred) || IsAllowedFor(OriginAIGenerated, StatusBlurred, StatusAudited) {
		t.Fatal("ai clips never enter blurred or audited")
	}
	if IsAllowedTransition(StatusRetired, StatusRaw) || IsAllowedTransition(StatusProposed, StatusPublished) {
		t.Fatal("disallowed edge accepted")
	}
	if _, err := checkPath("", StatusRated, StatusProposed); err == nil {
		t.Fatal("rated → proposed must fail")
	}
}

// ---- schema ---------------------------------------------------------------------------------

func TestSchema_NoDrift(t *testing.T) {
	src, err := os.ReadFile(filepath.Join(repoRoot(t), "packages", "clip-pipeline", "schema", "clip.schema.json"))
	if err != nil {
		t.Skipf("clip-pipeline schema not found: %v", err)
	}
	var a, b any
	if err := json.Unmarshal(src, &a); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(clipSchemaJSON, &b); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatal("internal/clips/clip.schema.json drifted from packages/clip-pipeline/schema/clip.schema.json: copy it again")
	}
}

func TestValidateDoc(t *testing.T) {
	h := newHarness()
	c := h.rated(t)
	raw, _ := c.Doc.JSON()
	if _, err := ValidateDoc(raw); err != nil {
		t.Fatalf("valid doc rejected: %v", err)
	}
	// A location field anywhere is rejected (every object is strict).
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	m["lat"] = 32.7
	bad, _ := json.Marshal(m)
	if _, err := ValidateDoc(bad); !errors.Is(err, ErrInvalidDoc) {
		t.Fatalf("lat accepted: %v", err)
	}
	// speedKmhEst null requires speedSource not_logged (cross-field rule).
	d := c.Doc
	d.SpeedKmhEst = nil
	if err := ValidateDocStruct(&d); !errors.Is(err, ErrInvalidDoc) {
		t.Fatalf("null speed with rider_log accepted: %v", err)
	}
	// A hazard window past the clip end is rejected.
	d = c.Doc
	d.Hazards = append([]DocHazard{}, c.Doc.Hazards...)
	d.Hazards[0].Window.BMs = 99_000
	if err := ValidateDocStruct(&d); !errors.Is(err, ErrInvalidDoc) {
		t.Fatalf("window after end accepted: %v", err)
	}
}

// ---- admin ----------------------------------------------------------------------------------

func TestRegister_Rules(t *testing.T) {
	h := newHarness()
	_, err := h.svc.Register(ctxT(), curator, RegisterInput{RawObjectKey: "raw/x.mp4", State: "JK", FilmedBy: "rider", Licence: Licence,
		ContributorConsentID: "cns_x", Metadata: json.RawMessage(metadata)})
	var ve *ValidationError
	if !errors.As(err, &ve) || ve.Code != "never_the_rider" {
		t.Fatalf("rider accepted: %v", err)
	}
	if _, err := h.svc.Register(ctxT(), Actor{"Ravi Kumar"}, RegisterInput{}); !errors.Is(err, ErrInvalidActor) {
		t.Fatalf("a name was accepted as actor: %v", err)
	}
	c := h.registered(t)
	if c.Status != StatusProposed || c.ClipID != "JK-0001" {
		t.Fatalf("got %s %s", c.ClipID, c.Status)
	}
	if len(h.jobs.started) != 1 || h.jobs.started[0] != "clip_ingest|JK-0001:ingest:1" {
		t.Fatalf("jobs %v", h.jobs.started)
	}
}

func TestPublish_RequiresTwoRatingsAnd100PctBlurAudit(t *testing.T) {
	h := newHarness()
	c := h.registered(t)
	full := ExpectedFrameCount(38000, DeliveryFPS) // 1140

	// One rating: not publishable (and no agreement yet).
	if _, err := h.svc.Rate(ctxT(), raterA, c.ClipID, 1, mark(12000, 16500)); err != nil {
		t.Fatal(err)
	}
	h.audit(t, c.ClipID, full, 0)
	_, err := h.svc.Publish(ctxT(), curator, c.ClipID, 1)
	if codes := violationCodes(err); !contains(codes, "ratings") || !contains(codes, "agreement") {
		t.Fatalf("one rating published or wrong violations: %v %v", codes, err)
	}

	// Two ratings and agreement, but the audit checked 99% of frames.
	if _, err := h.svc.Rate(ctxT(), raterB, c.ClipID, 1, mark(12500, 17000)); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.Steps()["clip.agreement"](ctxT(), map[string]any{"clip_id": c.ClipID, "version": 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.SetCueTexts(ctxT(), curator, c.ClipID, 1, map[string]CueText{"h1": {En: "Feet at the bus front", Hi: "बस के आगे पैर"}}); err != nil {
		t.Fatal(err)
	}
	if res := h.audit(t, c.ClipID, full-12, 0); res.Passed {
		t.Fatal("99% audit passed")
	}
	_, err = h.svc.Publish(ctxT(), curator, c.ClipID, 1)
	if codes := violationCodes(err); len(codes) != 1 || codes[0] != "blur_audit" {
		t.Fatalf("99%% audit: %v %v", codes, err)
	}

	// 100% of frames but one miss.
	if res := h.audit(t, c.ClipID, full, 1); res.Passed {
		t.Fatal("audit with a miss passed")
	}
	if codes := violationCodes(mustErr(h.svc.Publish(ctxT(), curator, c.ClipID, 1))); len(codes) != 1 || codes[0] != "blur_audit" {
		t.Fatalf("audit with a miss: %v", codes)
	}

	// A passing audit on the current bytes: publishes, and the manifests are rebuilt.
	if res := h.audit(t, c.ClipID, full, 0); !res.Passed {
		t.Fatalf("full audit failed: %v", res.Issues)
	}
	got, err := h.svc.Publish(ctxT(), curator, c.ClipID, 1)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if got.Status != StatusPublished || got.Doc.Status != StatusPublished || got.PublishedAt == nil {
		t.Fatalf("not published: %+v", got.Status)
	}
	if h.compute.manifests != 1 {
		t.Fatalf("manifest rebuilds %d", h.compute.manifests)
	}
	stored, _ := h.store.GetClip(ctxT(), c.ClipID, 1)
	if !stored.MockEligible {
		t.Fatal("mock eligibility not taken from /clip/manifests")
	}
	if err := ValidateDocStruct(&stored.Doc); err != nil {
		t.Fatalf("published doc invalid: %v", err)
	}
}

func mustErr(_ *Clip, err error) error { return err }

func TestPublish_AuditOnOldBytesDoesNotCount(t *testing.T) {
	h := newHarness()
	c := h.rated(t)
	_, err := h.svc.SubmitBlurAudit(ctxT(), auditor, c.ClipID, 1, BlurAuditInput{RenditionSHA256: strings.Repeat("c", 64),
		FramesTotal: 1140, FramesChecked: 1140})
	if err != nil {
		t.Fatal(err)
	}
	if codes := violationCodes(mustErr(h.svc.Publish(ctxT(), curator, c.ClipID, 1))); !contains(codes, "blur_audit") {
		t.Fatalf("audit of other bytes counted: %v", codes)
	}
}

func TestRater_BlindUntilSaved(t *testing.T) {
	h := newHarness()
	c := h.registered(t)
	c.Proposals = []Proposal{{AMs: 11000, BMs: 15000, HazardType: "bus_stop_pedestrian", Why: "bus stopping"}}
	if err := h.store.UpdateClip(ctxT(), c); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.Rate(ctxT(), raterA, c.ClipID, 1, mark(12000, 16500)); err != nil {
		t.Fatal(err)
	}

	// Rater B, before saving: sees that one rating exists, but not whose or its marks, nor proposals.
	vb, err := h.svc.View(ctxT(), raterB, c.ClipID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if vb.BothSaved || vb.RatingsSaved != 1 || len(vb.Ratings) != 1 || !vb.Ratings[0].Hidden || vb.Ratings[0].Marks != nil || vb.Ratings[0].Rater != "" {
		t.Fatalf("rater B saw rater A: %+v", vb.Ratings)
	}
	if len(vb.Proposals) != 0 || vb.Agreement != nil {
		t.Fatal("proposals or agreement visible before both saved")
	}
	// Rater A sees only their own marks.
	va, _ := h.svc.View(ctxT(), raterA, c.ClipID, 1)
	if va.Ratings[0].Hidden || len(va.Ratings[0].Marks) != 1 {
		t.Fatalf("rater A cannot see own marks: %+v", va.Ratings)
	}
	// A curator who is not a rater is blind too.
	vc, _ := h.svc.View(ctxT(), curator, c.ClipID, 1)
	if !vc.Ratings[0].Hidden {
		t.Fatal("curator saw marks before both raters saved")
	}
	// Rater A may still change their marks; B saves; now everyone sees both and the proposals.
	if _, err := h.svc.Rate(ctxT(), raterA, c.ClipID, 1, mark(12100, 16500)); err != nil {
		t.Fatal(err)
	}
	res, err := h.svc.Rate(ctxT(), raterB, c.ClipID, 1, mark(12500, 17000))
	if err != nil || !res.BothSaved {
		t.Fatalf("second save: %v %v", res, err)
	}
	vb, _ = h.svc.View(ctxT(), raterB, c.ClipID, 1)
	if !vb.BothSaved || len(vb.Ratings) != 2 || vb.Ratings[0].Hidden || vb.Ratings[1].Hidden || len(vb.Proposals) != 1 {
		t.Fatalf("after both saved: %+v", vb)
	}
	// Frozen afterwards; a third rater is refused.
	if _, err := h.svc.Rate(ctxT(), raterA, c.ClipID, 1, mark(1, 2)); !errors.Is(err, ErrRatingsFrozen) {
		t.Fatalf("frozen: %v", err)
	}
	if _, err := h.svc.Rate(ctxT(), Actor{"rater-03"}, c.ClipID, 1, mark(1, 2)); !errors.Is(err, ErrTooManyRaters) {
		t.Fatalf("third rater: %v", err)
	}
}

func TestAdjudication_RaterCannotAdjudicate(t *testing.T) {
	h := newHarness()
	h.compute.accept = false
	c := h.registered(t)
	_, _ = h.svc.Rate(ctxT(), raterA, c.ClipID, 1, mark(12000, 16500))
	_, _ = h.svc.Rate(ctxT(), raterB, c.ClipID, 1, mark(14000, 18000))
	out, err := h.svc.Steps()["clip.agreement"](ctxT(), map[string]any{"clip_id": c.ClipID, "version": 1})
	if err != nil || out["next"] != "clip.request_adjudication" {
		t.Fatalf("agreement: %v %v", out, err)
	}
	if _, err := h.svc.Steps()["clip.request_adjudication"](ctxT(), map[string]any{"clip_id": c.ClipID, "version": 1, "round": 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.Adjudicate(ctxT(), raterA, c.ClipID, 1, AdjudicationInput{ReasonCode: "onset_disagreement"}); !errors.Is(err, ErrAdjudicatorIsRater) {
		t.Fatalf("rater adjudicated: %v", err)
	}
	got, _ := h.store.GetClip(ctxT(), c.ClipID, 1)
	if got.Status != StatusAdjudication || len(h.hooks.posts) != 2 {
		t.Fatalf("status %s, posts %d", got.Status, len(h.hooks.posts))
	}
}

// ---- steps ----------------------------------------------------------------------------------

func TestOpenReview_SignedEnvelopeOnce(t *testing.T) {
	h := newHarness()
	c := h.registered(t)
	if len(h.hooks.posts) != 1 || h.hooks.posts[0].path != "/webhook/md/clip-ready" {
		t.Fatalf("posts %+v", h.hooks.posts)
	}
	env := h.hooks.posts[0].env
	if err := adnotify.VerifyEnvelope([]byte("test-secret"), env, t0); err != nil {
		t.Fatalf("envelope signature: %v", err)
	}
	var p map[string]any
	_ = json.Unmarshal([]byte(env.Payload), &p)
	if p["event"] != ClipReadyEvent || p["clip_id"] != c.ClipID || p["event_id"] != "JK-0001:open_review:1" {
		t.Fatalf("payload %v", p)
	}
	// Replay with the same idempotency key posts nothing.
	out, err := h.svc.Steps()["clip.open_review"](ctxT(), map[string]any{"clip_id": c.ClipID, "version": 1, "idempotency_key": "JK-0001:open_review:1"})
	if err != nil || out["replayed"] != true || len(h.hooks.posts) != 1 {
		t.Fatalf("replay: %v %v posts=%d", out, err, len(h.hooks.posts))
	}
}

func TestProposeWindows_IsP3Stub(t *testing.T) {
	out, err := newHarness().svc.Steps()["clip.propose_windows"](ctxT(), map[string]any{"clip_id": "JK-0001", "version": 1})
	if err != nil || out["status"] != "skipped" || out["reason"] != "AI layer is P3" {
		t.Fatalf("%v %v", out, err)
	}
}

func TestRawDeletion_Logged(t *testing.T) {
	h := newHarness()
	c := h.rated(t)
	del := h.svc.Steps()["clip.delete_raw"]

	// Before the audit passes (and within 7 days) nothing is deleted.
	out, err := del(ctxT(), map[string]any{"clip_id": c.ClipID, "version": 1})
	if err != nil || out["deleted"] != false || len(h.objects.deleted) != 0 {
		t.Fatalf("deleted before audit: %v %v %v", out, err, h.objects.deleted)
	}
	h.audit(t, c.ClipID, 1140, 0)
	h.clock.Advance(3 * time.Hour)
	out, err = del(ctxT(), map[string]any{"clip_id": c.ClipID, "version": 1})
	if err != nil || out["deleted"] != true || out["on_time"] != true || out["reason"] != "audit_passed" {
		t.Fatalf("delete_raw: %v %v", out, err)
	}
	want := []string{"raw/upload-1.mp4", "private/JK-0001/v1/mezzanine.mp4"}
	if !reflect.DeepEqual(h.objects.deleted, want) {
		t.Fatalf("deleted %v, want %v", h.objects.deleted, want)
	}
	rec, err := h.store.RawDeletion(ctxT(), c.ClipID, 1)
	if err != nil {
		t.Fatalf("no deletion record: %v", err)
	}
	if !reflect.DeepEqual(rec.ObjectKeys, want) || rec.DeletedBy != "clip_finalize" || rec.AuditPassedAt == nil || !rec.DeletedAt.Equal(t0.Add(3*time.Hour)) {
		t.Fatalf("record %+v", rec)
	}
	if want := rec.AuditPassedAt.Add(RawAfterAudit); !rec.Deadline.Equal(want) {
		t.Fatalf("deadline %v want %v", rec.Deadline, want)
	}
	for _, k := range rec.ObjectKeys {
		if strings.Contains(k, "://") || strings.Contains(k, "?") {
			t.Fatalf("URL in deletion log: %s", k)
		}
	}
	// Idempotent: no second deletion, the same record comes back.
	out, err = del(ctxT(), map[string]any{"clip_id": c.ClipID, "version": 1})
	if err != nil || out["replayed"] != true || len(h.objects.deleted) != 2 {
		t.Fatalf("second run: %v %v", out, err)
	}
	got, _ := h.store.GetClip(ctxT(), c.ClipID, 1)
	if got.RawDeletedAt == nil {
		t.Fatal("raw_deleted_at not set")
	}
}

func TestRawDeletion_RetentionLimit(t *testing.T) {
	h := newHarness()
	c := h.registered(t)
	h.clock.Advance(RawRetention + time.Minute)
	out, err := h.svc.Steps()["clip.delete_raw"](ctxT(), map[string]any{"clip_id": c.ClipID, "version": 1})
	if err != nil || out["reason"] != "retention_limit" || out["on_time"] != false {
		t.Fatalf("%v %v", out, err)
	}
}

// ---- API-37 and scoring ---------------------------------------------------------------------

func (h *harness) published(t *testing.T) *Clip {
	t.Helper()
	c := h.rated(t)
	h.audit(t, c.ClipID, 1140, 0)
	got, err := h.svc.Publish(ctxT(), curator, c.ClipID, 1)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestAPI37_NoHazardWindows(t *testing.T) {
	h := newHarness()
	c := h.published(t)
	if len(c.Doc.Hazards) == 0 || len(c.Doc.QuietSegments) == 0 {
		t.Fatal("fixture must carry hazards and quiet segments")
	}
	page, err := h.svc.ListNazarClips(ctxT(), ClipQuery{State: "JK"})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Ref != "JK-0001@1" || page.TotalBytes != 1840000 || page.ManifestVersion == "" {
		t.Fatalf("page %+v", page)
	}
	raw, _ := json.Marshal(page)
	low := strings.ToLower(string(raw))
	for _, banned := range []string{"hazard", "window", "ams", "bms", "quiet", "speed", "cue", "occlusion"} {
		if strings.Contains(low, banned) {
			t.Fatalf("API-37 leaked %q: %s", banned, raw)
		}
	}
	// The type itself has no field that could carry them.
	typ := reflect.TypeOf(ClipListItem{})
	for i := 0; i < typ.NumField(); i++ {
		tag := strings.ToLower(typ.Field(i).Tag.Get("json"))
		if strings.Contains(tag, "hazard") || strings.Contains(tag, "window") || strings.Contains(tag, "speed") {
			t.Fatalf("ClipListItem has field %s", tag)
		}
	}
	// exclude_seen removes a clip the subject has played.
	page, _ = h.svc.ListNazarClips(ctxT(), ClipQuery{State: "JK", Seen: []string{"clip:JK-0001@1"}})
	if len(page.Items) != 0 {
		t.Fatal("exclude_seen ignored")
	}
}

func TestScoringDocsAndMockEligible(t *testing.T) {
	h := newHarness()
	h.published(t)
	docs, err := h.svc.ScoringDocs(ctxT(), []string{"clip:JK-0001@1"})
	if err != nil {
		t.Fatal(err)
	}
	var sc ScoringClip
	if err := json.Unmarshal(docs[0], &sc); err != nil || sc.SpeedKmhEst != 40 || len(sc.Hazards) != 1 || sc.Hazards[0].Window.AMs != 12267 {
		t.Fatalf("scoring doc %s %v", docs[0], err)
	}
	items, err := h.svc.MockEligible(ctxT(), "JK", nil, 1)
	if err != nil || len(items) != 1 || items[0].Ref != "clip:JK-0001@1" {
		t.Fatalf("eligible %v %v", items, err)
	}
	if _, err := h.svc.MockEligible(ctxT(), "JK", []string{"clip:JK-0001@1"}, 1); !errors.Is(err, ErrNotEnoughClips) {
		t.Fatalf("seen clip offered: %v", err)
	}
	u, sha, n, err := h.svc.AssetURL(ctxT(), "clip:JK-0001@1", uuid.New())
	if err != nil || !strings.Contains(u, "clips/JK-0001/v1/360p.mp4") || sha != sha360 || n != 1840000 {
		t.Fatalf("asset %s %s %d %v", u, sha, n, err)
	}
	rows, err := h.svc.RaterOnsets(ctxT(), []string{"JK-0001"})
	if err != nil || len(rows) != 1 || rows[0].RaterAOnsetMs != 12000 || rows[0].RaterBOnsetMs != 12500 {
		t.Fatalf("rater onsets %v %v", rows, err)
	}
}

type fakeTakers struct {
	points float64
	n      int
}

func (f fakeTakers) ClipTakerStats(context.Context, string) (float64, int, error) {
	return f.points, f.n, nil
}

func TestRecomputeDifficulty(t *testing.T) {
	h := newHarness()
	h.published(t)
	step := h.svc.Steps()["clip.recompute_difficulty"]
	args := map[string]any{"clip_id": "JK-0001", "version": 1}
	if out, err := step(ctxT(), args); err != nil || out["status"] != "skipped" {
		t.Fatalf("no source: %v %v", out, err)
	}
	// Below 30 takers: count only, no empirical level.
	h.svc.Takers = fakeTakers{points: 1, n: 12}
	if out, err := step(ctxT(), args); err != nil || out["empirical"] != nil || out["n_takers"] != float64(12) {
		t.Fatalf("12 takers: %v %v", out, err)
	}
	// 40 takers averaging 1 point per hazard: 1 + (5-1)*4/5 = 4.2; gap 1.2 from curator 3, no flag.
	h.svc.Takers = fakeTakers{points: 1, n: 40}
	out, err := step(ctxT(), args)
	if err != nil || out["empirical"] != 4.2 || out["review_flag"] != false {
		t.Fatalf("40 takers: %v %v", out, err)
	}
	// 0 points: level 5, two levels above curator 3: flagged.
	h.svc.Takers = fakeTakers{points: 0, n: 40}
	if out, _ := step(ctxT(), args); out["empirical"] != float64(5) || out["review_flag"] != true {
		t.Fatalf("flag: %v", out)
	}
	got, _ := h.store.GetClip(ctxT(), "JK-0001", 1)
	if err := ValidateDocStruct(&got.Doc); err != nil {
		t.Fatalf("doc invalid after recompute: %v", err)
	}
}
