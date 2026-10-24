package app

// P2 wiring (plan §2.1 W0a): the compute client, the object store and the learning, game,
// gamification, clip and study services, with the glue adapters between them. Every domain
// package defines its own narrow ports; this file is the only place that knows how they connect.

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/compute"
	adnotify "github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore/mock"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore/r2"
	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/games"
	"github.com/sruj08/margadarshak/services/api/internal/gamify"
	"github.com/sruj08/margadarshak/services/api/internal/jobs"
	"github.com/sruj08/margadarshak/services/api/internal/learn"
	"github.com/sruj08/margadarshak/services/api/internal/learner"
	"github.com/sruj08/margadarshak/services/api/internal/plans"
	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/rules"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/study"
)

// ComputeService is everything the API asks the private compute service (score verifier):
// POST /verify typed, and the learn/gamification/clip routes through the untyped poster the
// domain packages build their own clients on. compute.Client implements it; tests pass a fake
// through Options.Compute.
type ComputeService interface {
	ports.ScoreVerifier
	ports.ComputePoster
}

// P2 holds the P2 services (nil fields mean the part could not be built; its endpoints answer 503).
type P2 struct {
	Compute     ComputeService
	ObjectStore ports.ObjectStore
	MockMedia   http.Handler // /mock/media/* when OBJECT_STORE=mock
	Games       *games.Service
	Learn       *learn.Service
	Gamify      *gamify.Service
	Clips       *clips.Service
	Study       *study.Service
	StudyStore  *store.StudyStore
	Staircase   store.GamesStaircase
	ContentDir  string
}

// ContentDir resolves CONTENT_DIR: the configured value, else the nearest "content" directory
// with a curriculum folder walking up from the working directory (repo checkouts and tests).
func ContentDir(dir string) string {
	if dir != "" {
		return dir
	}
	wd, _ := os.Getwd()
	for d := wd; ; d = filepath.Dir(d) {
		c := filepath.Join(d, "content")
		if st, err := os.Stat(filepath.Join(c, "curriculum")); err == nil && st.IsDir() {
			return c
		}
		if filepath.Dir(d) == d {
			return "content"
		}
	}
}

// wireP2 builds the P2 services. Missing content or object storage degrades the affected part
// (logged) instead of failing start-up, so P0/P1 keep working.
func (a *App) wireP2(cfg *config.Config, opt Options) (*P2, error) {
	db, clock, log := a.DB, a.Clock, a.Log
	p := &P2{ContentDir: ContentDir(cfg.ContentDir)}

	// Compute client (decision D1): HMAC-signed, 2 s budget.
	p.Compute = opt.Compute
	if p.Compute == nil {
		base := cfg.ScoreVerifierURL
		if base == "" {
			base = "http://127.0.0.1:8081"
		}
		c := compute.New(base, cfg.ScoreVerifierSecret, cfg.ScoreVerifierTimeout, clock)
		c.Log = log
		p.Compute = c
	}

	// Object storage (decision D5).
	p.ObjectStore = opt.ObjectStore
	if p.ObjectStore == nil {
		switch cfg.ObjectStore {
		case "r2":
			endpoint := cfg.R2Endpoint
			if endpoint == "" {
				endpoint = r2.AccountEndpoint(cfg.R2AccountID)
			}
			st, err := r2.New(r2.Config{Endpoint: endpoint, Bucket: cfg.R2BucketClips, AccessKeyID: cfg.R2AccessKeyID,
				SecretAccessKey: cfg.R2SecretAccessKey}, clock, nil)
			if err != nil {
				return nil, fmt.Errorf("app: OBJECT_STORE=r2: %w", err)
			}
			p.ObjectStore = st
		default:
			root := cfg.MockMediaDir
			if root == "" && cfg.CacheDir != "" {
				root = filepath.Join(cfg.CacheDir, "media")
			} else if root == "" {
				root = filepath.Join(os.TempDir(), "margdarshak-media")
			}
			// Stable across restarts in dev: derived from the session secret, never logged.
			sum := sha256.Sum256([]byte("mock-media:" + cfg.SessionSecret))
			st, err := mock.New(root, cfg.PublicBaseURL, sum[:], clock)
			if err != nil {
				log.Warn("mock object store unavailable; clip media endpoints answer 503", "err", err)
			} else {
				p.ObjectStore, p.MockMedia = st, st.Handler()
			}
		}
	} else if h, ok := opt.ObjectStore.(interface{ Handler() http.Handler }); ok {
		p.MockMedia = h.Handler()
	}

	envelopeSecret := []byte(cfg.N8NHMACSecret)
	if len(envelopeSecret) == 0 {
		envelopeSecret = []byte(cfg.InternalHMACSecret)
	}

	// Clips (workstream F).
	p.Clips = &clips.Service{
		Store: store.NewClipsStore(db), Compute: clips.NewComputeVia(p.Compute), Objects: p.ObjectStore, Webhooks: a.N8n,
		Jobs: jobStarter{a}, Consents: clipConsents{db: db}, Takers: store.GamesTakerStats{DB: db}, Clock: clock, Log: log,
		HMACSecret: envelopeSecret, ClipReadyPath: cfg.N8NClipReadyPath, MediaBaseURL: cfg.MediaPublicBaseURL, MediaURLTTL: cfg.MediaURLTTL,
		ScenesPath: filepath.Join(p.ContentDir, "nazar", "scenes.json"),
	}

	// Study (workstream H).
	p.StudyStore = store.NewStudyStore(db)
	p.Study = &study.Service{Store: p.StudyStore, Consents: studyConsents{db: db}, Raters: raterSource{p.Clips},
		Speeds: speedSource{p.Clips}, Clock: clock, Log: log, DefaultTenant: cfg.DefaultTenant}

	// Games (workstream A).
	catalog, err := games.LoadCatalog(filepath.Join(p.ContentDir, "generated", "game-items.json"))
	if err != nil {
		log.Warn("game catalogue not loaded; game endpoints answer 503 (set CONTENT_DIR)", "err", err)
	}
	gs := &games.Service{DB: db, Store: store.GamesStore{}, Clips: clipSource{p.Clips}, Compute: p.Compute,
		StudyForms: studyForms{p.Study}, RulePack: rulePack{lib: a.Rules}, Staircase: p.Staircase, Catalog: catalog,
		Clock: clock, Log: log}

	// Learn (workstream B).
	var learnCatalog *learn.Catalog
	if learnCatalog, err = learn.LoadCatalog(p.ContentDir); err != nil {
		log.Warn("curriculum not loaded; API-30 answers 503 (set CONTENT_DIR)", "err", err)
		learnCatalog = nil
	}
	nazar := nazarScore{db: db, games: gs}
	p.Learn = &learn.Service{Store: store.NewLearnStore(db), Compute: learn.NewComputeVia(p.Compute), Catalog: learnCatalog,
		Nazar: nazar, Gate: llGate{db: db, lib: a.Rules}, Clock: clock, Log: log}

	// Gamify (workstream B).
	p.Gamify = &gamify.Service{Store: store.NewGamifyStore(db), Compute: gamify.NewComputeVia(p.Compute), Nodes: p.Learn,
		Nazar: nazar, Brier: brierSource{p.Learn}, Extras: parentalExtras{db: db}, Clock: clock, Log: log}

	// The games hooks run inside the completing transaction (or the replay step's System one).
	gs.Awards = awards{gamify: p.Gamify, learn: p.Learn}
	gs.Study = studyHook{n8n: a.N8n, path: cfg.N8NStudyWebhookPath, secret: envelopeSecret, log: log}
	if catalog != nil {
		g, err := games.New(*gs)
		if err != nil {
			return nil, err
		}
		p.Games = g
	}
	return p, nil
}

// p2Steps are the P2 job steps for jobs.Steps (POST /internal/job-steps/{step}).
func (p *P2) p2Steps() map[string]jobs.StepFunc {
	out := map[string]jobs.StepFunc{}
	if p.Games != nil {
		out["sessions.replay_pending"] = p.Games.ReplayPendingStep
	}
	for k, f := range p.Clips.Steps() {
		out[k] = f
	}
	for k, f := range p.Study.Steps() {
		out[k] = f
	}
	return out
}

// p2Tasks are the inline task bodies (JOB_RUNNER=inline). Under Render Workflows the same tasks
// are TypeScript and call the steps. Media steps (transcode, blur, flash check) and the field
// study script only run there, so inline clip_ingest stops at the Go steps it can run, and inline
// nightly_stats runs the export (study.export_csv) but never publishes: stats.field_study_publish
// only stores what field-kit/nazar_stats.mjs printed, and that script runs only in the Workflows
// task (no Node child process inside the API).
func p2Tasks(steps map[string]jobs.StepFunc) map[string]jobs.TaskFunc {
	seq := func(job string, names ...string) jobs.TaskFunc {
		return jobs.TaskFromStep(func(ctx context.Context, args map[string]any) (map[string]any, error) {
			out := map[string]any{"job": job}
			for _, n := range names {
				res, err := steps[n](ctx, args)
				if err != nil {
					out["failed_step"] = n
					return out, fmt.Errorf("%s: %s: %w", job, n, err)
				}
				out[n] = res
			}
			return out, nil
		})
	}
	tasks := map[string]jobs.TaskFunc{
		"clip_finalize": seq("clip_finalize", "clip.agreement", "clip.blur_audit_check", "clip.delete_raw",
			"clip.publish_manifest", "clip.recompute_difficulty"),
		// Inline ingest records the clip and leaves the media steps (TypeScript) to Render Workflows.
		"clip_ingest": seq("clip_ingest", "clip.get", "clip.propose_windows"),
		// clip_generate (ADR-0013) is video generation and media work only: there is no Go step to
		// run inline, so the inline body records that it needs Render Workflows and succeeds.
		"clip_generate": jobs.TaskFromStep(func(context.Context, map[string]any) (map[string]any, error) {
			return map[string]any{"job": "clip_generate", "status": "skipped", "reason": "requires Render Workflows (JOB_RUNNER=render_workflows)"}, nil
		}),
	}
	if export, ok := steps["study.export_csv"]; ok {
		tasks["nightly_stats"] = jobs.TaskFromStep(func(ctx context.Context, args map[string]any) (map[string]any, error) {
			res, err := export(ctx, args)
			if err != nil {
				return map[string]any{"job": "nightly_stats", "failed_step": "study.export_csv"}, fmt.Errorf("nightly_stats: study.export_csv: %w", err)
			}
			return map[string]any{"job": "nightly_stats", "status": "exported", "published": false,
				"reason":  "field-kit/nazar_stats.mjs runs only in the Render Workflows task (JOB_RUNNER=render_workflows); nothing was published",
				"summary": res["summary"], "sha256": res["sha256"], "omitted": res["omitted"]}, nil
		})
	}
	if _, ok := steps["sessions.replay_pending"]; ok {
		tasks["replay_pending_sessions"] = jobs.TaskFromStep(steps["sessions.replay_pending"])
	}
	return tasks
}

// ---- Glue adapters ------------------------------------------------------------------------

// jobStarter adapts jobs.Service.Start to clips.JobStarter.
type jobStarter struct{ a *App }

func (j jobStarter) StartJob(ctx context.Context, tenant *string, job string, args []any, idemKey string) (string, error) {
	run, err := j.a.Jobs.Start(ctx, tenant, job, args, idemKey)
	if err != nil {
		return "", err
	}
	return run.RunID, nil
}

// clipConsents checks a contributor's clip_contribution consent artefact (any tenant: the clip
// bank is not tenant-scoped).
type clipConsents struct{ db *store.DB }

func (c clipConsents) ClipContributionActive(ctx context.Context, consentID string) (bool, error) {
	id, err := uuid.Parse(consentID)
	if err != nil {
		return false, nil
	}
	var ok bool
	err = c.db.System(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM privacy.consent_artefacts
			WHERE consent_id = $1 AND purpose = 'clip_contribution' AND revoked_at IS NULL)`, id).Scan(&ok)
	})
	return ok, err
}

// studyConsents finds the subject's active field_study consent (study.Consents).
type studyConsents struct{ db *store.DB }

func (s studyConsents) ActiveConsent(ctx context.Context, tenant string, applicant uuid.UUID, purpose string) (uuid.UUID, bool, error) {
	var id uuid.UUID
	var found bool
	err := s.db.InTenant(ctx, tenant, func(tx pgx.Tx) error {
		c, err := store.ActiveConsent(ctx, tx, applicant, purpose, nil, nil)
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		id, found = c.ID, true
		return nil
	})
	return id, found, err
}

// raterSource adapts clips.Service.RaterOnsets to study.RaterSource.
type raterSource struct{ c *clips.Service }

func (r raterSource) RaterOnsets(ctx context.Context, ids []string) ([]study.RaterRow, error) {
	rows, err := r.c.RaterOnsets(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]study.RaterRow, len(rows))
	for i, x := range rows {
		out[i] = study.RaterRow{ClipID: x.ClipID, RaterAOnsetMs: x.RaterAOnsetMs, RaterBOnsetMs: x.RaterBOnsetMs}
	}
	return out, nil
}

// speedSource reads the curator speed estimate from the clips' scoring documents.
type speedSource struct{ c *clips.Service }

func (s speedSource) ClipSpeeds(ctx context.Context, refs []string) (map[string]float64, error) {
	docs, err := s.c.ScoringDocs(ctx, refs)
	if err != nil {
		return nil, err
	}
	out := make(map[string]float64, len(refs))
	for i, d := range docs {
		var sc clips.ScoringClip
		if err := json.Unmarshal(d, &sc); err != nil {
			return nil, fmt.Errorf("app: scoring document %s: %w", refs[i], err)
		}
		out[refs[i]] = sc.SpeedKmhEst
	}
	return out, nil
}

// clipSource adapts clips.Service to games.ClipSource. games excludes seen clips by clip ID and
// asks for a large candidate pool; clips excludes by ref and reports a short pool as an error,
// so the adapter filters by ID and keeps what it found.
type clipSource struct{ c *clips.Service }

func (s clipSource) ScoringDocs(ctx context.Context, refs []string) ([]json.RawMessage, error) {
	return s.c.ScoringDocs(ctx, refs)
}

func (s clipSource) MockEligible(ctx context.Context, state string, exclude []string, n int) ([]games.ClipItem, error) {
	items, err := s.c.MockEligible(ctx, state, nil, 1<<20)
	if err != nil && !errors.Is(err, clips.ErrNotEnoughClips) {
		return nil, err
	}
	skip := map[string]bool{}
	for _, id := range exclude {
		skip[id] = true
	}
	out := make([]games.ClipItem, 0, len(items))
	for _, it := range items {
		if skip[it.ClipID] {
			continue
		}
		d := 0
		if it.Difficulty != nil {
			d = *it.Difficulty
		}
		out = append(out, games.ClipItem{Ref: it.Ref, ClipID: it.ClipID, Version: it.Version, ContentVersion: it.ContentVersion, CuratorDifficulty: d})
		if len(out) == n {
			break
		}
	}
	return out, nil
}

func (s clipSource) AssetURL(ctx context.Context, ref string, sid uuid.UUID) (string, string, int64, error) {
	return s.c.AssetURL(ctx, ref, sid)
}

// studyForms adapts study.Service.FormItems; the tenant is the one the calling transaction is
// bound to (app.tenant_id).
type studyForms struct{ s *study.Service }

func (f studyForms) FormItems(ctx context.Context, tx pgx.Tx, participant, phase string) ([]string, error) {
	var tenant string
	if err := tx.QueryRow(ctx, `SELECT current_setting('app.tenant_id', true)`).Scan(&tenant); err != nil {
		return nil, err
	}
	refs, err := f.s.FormItems(store.ContextWithTx(ctx, tx), tenant, participant, phase)
	if errors.Is(err, study.ErrNotFound) || errors.Is(err, study.ErrUnknownPhase) || errors.Is(err, study.ErrWithdrawn) {
		return nil, fmt.Errorf("%w: %w", games.ErrStudyUnavailable, err)
	}
	return refs, err
}

// rulePack reads the tenant's rule pack: its version and the LL mock format (API-05 data).
type rulePack struct{ lib *rules.Library }

func (r rulePack) Version(_ context.Context, tenant string) (string, error) {
	if r.lib == nil {
		return "", errors.New("app: rule packs not loaded")
	}
	c, ok := r.lib.Pack(tenant)
	if !ok {
		return "", fmt.Errorf("app: no rule pack for %s", tenant)
	}
	return c.Version, nil
}

// DefaultLLMockQuestions is the mock size when a state's format is unknown (EC-10: the test is
// at the RTO): practice still works, and the result says the format is unconfirmed.
const DefaultLLMockQuestions = 15

func (r rulePack) LLMockFormat(_ context.Context, tenant string) (games.LLFormat, error) {
	if r.lib == nil {
		return games.LLFormat{}, errors.New("app: rule packs not loaded")
	}
	c, ok := r.lib.Pack(tenant)
	if !ok {
		return games.LLFormat{}, fmt.Errorf("app: no rule pack for %s", tenant)
	}
	f := plans.Format(c, nil)
	if !f.Known || f.Questions == nil || *f.Questions < 1 {
		return games.LLFormat{RuleID: "default", Questions: DefaultLLMockQuestions}, nil
	}
	return games.LLFormat{RuleID: f.RuleID, Questions: int(*f.Questions)}, nil
}

// nazarScore opens a tenant transaction around games.Service.NazarScore (learn and gamify read it).
type nazarScore struct {
	db    *store.DB
	games *games.Service
}

func (n nazarScore) NazarScore(ctx context.Context, subj learner.Subject) (*float64, int, error) {
	var score *float64
	var count int
	err := n.db.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		var err error
		score, count, err = n.games.NazarScore(ctx, tx, subj)
		return err
	})
	return score, count, err
}

// llGate is the readiness gate input: the verified LL mock percentages (oldest first, last 5)
// and the state's pass mark.
type llGate struct {
	db  *store.DB
	lib *rules.Library
}

func (g llGate) LLGateInput(ctx context.Context, subj learner.Subject) (*learn.GateInput, error) {
	pass := 60.0
	if g.lib != nil {
		if c, ok := g.lib.Pack(subj.Tenant); ok {
			if f := plans.Format(c, nil); f.PassPct != nil {
				pass = float64(*f.PassPct)
			} else if f.PassCorrect != nil && f.Questions != nil && *f.Questions > 0 {
				pass = 100 * float64(*f.PassCorrect) / float64(*f.Questions)
			}
		}
	}
	in := &learn.GateInput{LLMockPcts: []float64{}, PassMarkPct: pass}
	err := g.db.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT server_score_pct::float8 FROM (
			SELECT server_score_pct, verified_at FROM game.sessions
			WHERE tenant_id = $1 AND applicant_id = $2 AND family_member_id IS NOT DISTINCT FROM $3
			  AND game_id = 'll_sim' AND mode = 'mock' AND status = 'checked' AND server_score_pct IS NOT NULL
			ORDER BY verified_at DESC LIMIT 5) t ORDER BY verified_at`, subj.Tenant, subj.ApplicantID, subj.MemberID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var v float64
			if err := rows.Scan(&v); err != nil {
				return err
			}
			in.LLMockPcts = append(in.LLMockPcts, v)
		}
		return rows.Err()
	})
	return in, err
}

// brierSource is the personal Brier score from the readiness snapshot (squad score input).
type brierSource struct{ l *learn.Service }

func (b brierSource) Brier(ctx context.Context, subj learner.Subject) (*float64, error) {
	v, err := b.l.Readiness(ctx, subj)
	if errors.Is(err, learn.ErrComputeUnavailable) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return v.Brier, nil
}

// parentalExtras reads core.family_members.parental_extras (gamify.Extras).
type parentalExtras struct{ db *store.DB }

func (p parentalExtras) HasParentalExtra(ctx context.Context, subj learner.Subject, extra string) (bool, error) {
	var ok bool
	err := p.db.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		var err error
		ok, err = accounts.HasParentalExtra(ctx, tx, subj, extra)
		return err
	})
	return ok, err
}

// awards runs after verification, inside the games transaction: gamify XP/rank/streak/badges
// (games.Awards) and the session's evidence into the learning review log.
type awards struct {
	gamify *gamify.Service
	learn  *learn.Service
}

func (a awards) OnSessionVerified(ctx context.Context, tx pgx.Tx, vs games.VerifiedSession) (games.AwardSummary, error) {
	ctx = store.ContextWithTx(ctx, tx)
	var out games.AwardSummary
	if ev := evidenceOf(vs.Result); len(ev) > 0 && vs.Eligible[games.EligibleXP] {
		if _, err := a.learn.AppendEvidence(ctx, vs.Subject, vs.ID.String(), vs.VerifiedAt, ev); err != nil {
			return out, fmt.Errorf("learn evidence: %w", err)
		}
	}
	if !vs.Subject.Account || !vs.Eligible[games.EligibleXP] {
		// Anonymous progress stays on the device (decision D-03); unverified sessions earn nothing.
		return out, nil
	}
	sum, err := a.gamify.OnSessionVerified(ctx, gamify.VerifiedSession{ID: vs.ID, Subject: vs.Subject, GameID: vs.GameID,
		Mode: vs.Mode, Result: vs.Result, DurationMs: vs.DurationMs, VerifiedAt: vs.VerifiedAt})
	if err != nil {
		if ports.IsComputeUnavailable(err) || errors.Is(err, gamify.ErrComputeUnavailable) {
			// XP is not worth losing a verified score over; the next session re-evaluates.
			slog.Default().WarnContext(ctx, "gamify: compute unavailable, no XP for this session", "sid", vs.ID.String())
			return out, nil
		}
		return out, err
	}
	out.XPAwarded = sum.XPAwarded
	out.BadgesAwarded = append([]string{}, sum.BadgesAwarded...)
	return out, nil
}

// evidenceOf reads SessionResult.evidence (game-core Evidence) into learn.Evidence.
func evidenceOf(result json.RawMessage) []learn.Evidence {
	var r struct {
		Evidence []struct {
			CardID        string  `json:"cardId"`
			Rating        int     `json:"rating"`
			Confidence    *string `json:"confidence"`
			Overconfident bool    `json:"overconfident"`
			Correct       *bool   `json:"correct"`
		} `json:"evidence"`
	}
	if json.Unmarshal(result, &r) != nil {
		return nil
	}
	out := make([]learn.Evidence, 0, len(r.Evidence))
	for _, e := range r.Evidence {
		if e.CardID == "" || e.Rating < 1 || e.Rating > 4 {
			continue
		}
		ev := learn.Evidence{CardID: e.CardID, Rating: e.Rating, Overconfident: e.Overconfident, Correct: e.Correct}
		if e.Confidence != nil {
			ev.Confidence = *e.Confidence
		}
		out = append(out, ev)
	}
	return out
}

// studyHook sends the W14 md/session-end envelope for a verified field-study session: the
// participant code, game, phase, score and trust only (no names; FIELD_STUDY §6). Sessions
// outside the study are ignored. The export reads game.sessions itself, so nothing is written.
type studyHook struct {
	n8n    *adnotify.N8n
	path   string
	secret []byte
	log    *slog.Logger
}

func (h studyHook) OnSessionVerified(ctx context.Context, tx pgx.Tx, vs games.VerifiedSession) error {
	var code, phase *string
	if err := tx.QueryRow(ctx, `SELECT study_participant, study_phase FROM game.sessions WHERE session_id = $1`, vs.ID).Scan(&code, &phase); err != nil {
		return err
	}
	if code == nil || h.n8n == nil {
		return nil
	}
	var r struct {
		Score struct {
			Pct float64 `json:"pct"`
		} `json:"score"`
	}
	_ = json.Unmarshal(vs.Result, &r)
	payload, _ := json.Marshal(map[string]any{
		"event": "md/session-end", "event_id": "session-end:" + vs.ID.String(), "participant_code": *code,
		"phase": phase, "game_id": vs.GameID, "score_pct": r.Score.Pct, "trust": vs.Trust,
		"duration_ms": vs.DurationMs, "verified_at": vs.VerifiedAt.UTC().Format(time.RFC3339),
	})
	if err := h.n8n.PostEnvelope(ctx, h.path, adnotify.SignEnvelope(h.secret, vs.VerifiedAt, payload)); err != nil {
		// The score is stored either way; the sheet append is best effort.
		h.log.WarnContext(ctx, "study: session-end envelope not sent", "sid", vs.ID.String(), "err", err)
	}
	return nil
}
