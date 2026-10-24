package games

import (
	"context"
	crand "crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SessionContext is game-core's SessionContext (packages/game-core/schema/SessionContext.json),
// camelCase, strict: it is everything a game may know about the player (no PII).
type SessionContext struct {
	SID             string        `json:"sid"`
	GameID          string        `json:"gameId"`
	Mode            string        `json:"mode"`
	UserBand        string        `json:"userBand"`
	Locale          string        `json:"locale"`
	A11y            A11y          `json:"a11y"`
	Difficulty      int           `json:"difficulty"`
	Seed            uint32        `json:"seed"`
	SeedOrigin      string        `json:"seedOrigin"`
	Items           []ContextItem `json:"items"`
	DeviceClass     string        `json:"deviceClass"`
	Offline         bool          `json:"offline"`
	ServerStartISO  *string       `json:"serverStartIso"`
	Tenant          string        `json:"tenant"`
	RulePackVersion string        `json:"rulePackVersion"`
}

// A11y is SessionContext.a11y.
type A11y struct {
	Modes     []string `json:"modes"`
	TextScale float64  `json:"textScale"`
	Haptics   bool     `json:"haptics"`
}

// ContextItem is game-core's SessionItem.
type ContextItem struct {
	Ref            string `json:"ref"`
	ContentVersion string `json:"contentVersion"`
}

// StudyRef puts a session in the online field study (cohort field_test).
type StudyRef struct {
	Participant string
	Phase       string // ll_mock | test | feedback | fresh
}

// StartRequest is API-34 after auth and consent checks (learner.Resolve, 403
// PARENT_CONSENT_REQUIRED, happen in the handler).
type StartRequest struct {
	Subject     Subject
	GameID      string
	Mode        string
	Locale      string   // en | hi (default en)
	A11yModes   []string // game-core A11yMode values
	TextScale   float64  // 1–2 (default 1)
	Haptics     bool
	DeviceClass string // low | mid | high (default mid)
	SkillID     string // staircase skill (default: the game ID)
	Study       *StudyRef
}

// StartItem is one item as sent to the client.
type StartItem struct {
	Item
	AssetURL string          `json:"asset_url,omitempty"`
	SHA256   string          `json:"sha256,omitempty"`
	Bytes    int64           `json:"bytes,omitempty"`
	Reveal   json.RawMessage `json:"reveal,omitempty"` // practice only: the clip's hazard windows
}

// Started is the API-34 result.
type Started struct {
	Session  *Session
	Context  SessionContext
	Items    []StartItem
	LabelKey string
}

// revealDoc is the part of a NazarClip document shown after a practice clip.
type revealDoc struct {
	ClipID  string `json:"clipId"`
	Version int    `json:"version"`
	Hazards []struct {
		HazardID   string          `json:"hazardId"`
		HazardType string          `json:"hazardType"`
		Window     json.RawMessage `json:"window"`
	} `json:"hazards"`
}

func (s *Service) seed() (uint32, error) {
	r := s.Rand
	if r == nil {
		r = crand.Reader
	}
	var b [4]byte
	if _, err := io.ReadFull(r, b[:]); err != nil {
		return 0, fmt.Errorf("games: seed: %w", err)
	}
	return binary.BigEndian.Uint32(b[:]), nil
}

// Start creates a session: server seed, items, SessionContext, exposures (API-34).
func (s *Service) Start(ctx context.Context, req StartRequest) (*Started, error) {
	g := s.Catalog.Game(req.GameID)
	if g == nil || !supported(req.GameID) {
		return nil, fmt.Errorf("%w: %s", ErrUnsupportedGame, req.GameID)
	}
	if !modeAllowed(req.GameID, req.Mode) {
		return nil, fmt.Errorf("%w: %s %s", ErrUnsupportedMode, req.GameID, req.Mode)
	}
	if req.Study != nil && s.StudyForms == nil {
		return nil, ErrStudyUnavailable
	}
	seed, err := s.seed()
	if err != nil {
		return nil, err
	}
	sid, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}
	rulePack, err := s.RulePack.Version(ctx, req.Subject.Tenant)
	if err != nil {
		return nil, fmt.Errorf("games: rule pack: %w", err)
	}
	now := s.Clock.Now().UTC()
	var out *Started
	err = s.DB.Tenant(ctx, req.Subject.Tenant, func(tx pgx.Tx) error {
		items, clips, difficulty, err := s.pick(ctx, tx, req, g, seed)
		if err != nil {
			return err
		}
		sess := &Session{
			ID: sid, Subject: req.Subject, GameID: req.GameID, Mode: req.Mode,
			GameVersion: g.GameVersion, ScoringVersion: g.ScoringVersion, RulePackVersion: rulePack,
			Seed: seed, SeedOrigin: SeedOriginServer, Difficulty: difficulty, Status: StatusStarted,
			Items: items, StartedAt: now, ExpiresAt: now.Add(SessionTTL),
		}
		if req.Study != nil {
			sess.Cohort, sess.StudyParticipant, sess.StudyPhase = CohortFieldTest, req.Study.Participant, req.Study.Phase
		}
		sc := buildContext(sess, req)
		if sess.Context, err = json.Marshal(sc); err != nil {
			return err
		}
		if err := s.Store.InsertSession(ctx, tx, sess); err != nil {
			return err
		}
		if err := s.Store.InsertSessionItems(ctx, tx, sid, items); err != nil {
			return err
		}
		startItems, err := s.decorate(ctx, sess, clips)
		if err != nil {
			return err
		}
		if ex := exposures(sess, clips, now); len(ex) > 0 {
			if err := s.Store.RecordExposures(ctx, tx, req.Subject, ex); err != nil {
				return err
			}
		}
		out = &Started{Session: sess, Context: sc, Items: startItems, LabelKey: LabelKey}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func supported(gameID string) bool {
	switch gameID {
	case GameNazar, GameLLSim, GameStoppingDistance, GameBlindSpot:
		return true
	}
	return false
}

// modeAllowed: pair mode needs squads (workstream B) and a shared seed, so it is refused until then.
func modeAllowed(gameID, mode string) bool {
	switch mode {
	case ModeMock:
		return gameID == GameNazar || gameID == GameLLSim
	case ModePractice, ModeLearn:
		return true
	}
	return false
}

// pick selects the items and the difficulty; clips lists the clip items (for URLs, reveals and
// exposures).
func (s *Service) pick(ctx context.Context, tx pgx.Tx, req StartRequest, g *CatalogGame, seed uint32) ([]Item, []ClipItem, int, error) {
	rng := newRNG(seed)
	level := 1
	if req.Mode != ModeMock && s.Staircase != nil {
		skill := req.SkillID
		if skill == "" {
			skill = req.GameID
		}
		l, err := s.Staircase.Level(ctx, tx, req.Subject, req.GameID, skill)
		if err != nil {
			return nil, nil, 0, fmt.Errorf("games: staircase: %w", err)
		}
		level = min(5, max(1, l))
	}
	if req.Study != nil {
		return s.pickStudy(ctx, tx, req, g, level)
	}
	switch req.GameID {
	case GameNazar:
		return s.pickNazar(ctx, tx, req, level, rng)
	case GameLLSim:
		pool, count, difficulty := "practice", llPracticeItems, level
		recentRefs, err := s.Store.RecentItemRefs(ctx, tx, req.Subject, GameLLSim, 200)
		if err != nil {
			return nil, nil, 0, err
		}
		if req.Mode == ModeMock {
			f, err := s.RulePack.LLMockFormat(ctx, req.Subject.Tenant)
			if err != nil {
				return nil, nil, 0, fmt.Errorf("games: LL format: %w", err)
			}
			if f.Questions < 1 || f.Questions > 40 {
				return nil, nil, 0, fmt.Errorf("games: LL format %s has %d questions", f.RuleID, f.Questions)
			}
			pool, count, difficulty = "mock", f.Questions, 3
		}
		chosen, err := selectLL(g, pool, count, setOf(recentRefs), rng)
		if err != nil {
			return nil, nil, 0, err
		}
		return catalogItems(chosen), nil, difficulty, nil
	case GameStoppingDistance:
		chosen, err := selectStoppingDistance(g)
		if err != nil {
			return nil, nil, 0, err
		}
		return catalogItems(chosen), nil, level, nil
	case GameBlindSpot:
		chosen, err := selectBlindSpot(g, rng)
		if err != nil {
			return nil, nil, 0, err
		}
		return catalogItems(chosen), nil, level, nil
	}
	return nil, nil, 0, ErrUnsupportedGame
}

func (s *Service) pickNazar(ctx context.Context, tx pgx.Tx, req StartRequest, level int, r *rand.Rand) ([]Item, []ClipItem, int, error) {
	if s.Clips == nil {
		return nil, nil, 0, fmt.Errorf("%w: no clip source", ErrUnsupportedGame)
	}
	seenIDs, err := s.Store.SeenClipIDs(ctx, tx, req.Subject)
	if err != nil {
		return nil, nil, 0, err
	}
	seen := setOf(seenIDs)
	var chosen []ClipItem
	difficulty := level
	if req.Mode == ModeMock {
		cands, err := s.Clips.MockEligible(ctx, req.Subject.Tenant, seenIDs, mockCandidatePool)
		if err != nil {
			return nil, nil, 0, err
		}
		if chosen, err = selectNazarMock(cands, seen, NazarMockClips, r); err != nil {
			return nil, nil, 0, err
		}
		difficulty = 3
	} else {
		n := nazarPracticeClips
		if req.Mode == ModeLearn {
			n = nazarLearnClips
		}
		var cands []ClipItem
		if p, ok := s.Clips.(PracticeClipSource); ok {
			cands, err = p.PracticeClips(ctx, req.Subject.Tenant, level, 4*n)
		} else {
			cands, err = s.Clips.MockEligible(ctx, req.Subject.Tenant, nil, mockCandidatePool)
		}
		if err != nil {
			return nil, nil, 0, err
		}
		if chosen, err = selectPracticeClips(cands, seen, level, n, r); err != nil {
			return nil, nil, 0, err
		}
	}
	items := make([]Item, len(chosen))
	for i, c := range chosen {
		items[i] = Item{Ordinal: i + 1, Ref: c.Ref, ContentVersion: clipContentVersion(c), Kind: "clip"}
	}
	return items, chosen, difficulty, nil
}

func (s *Service) pickStudy(ctx context.Context, tx pgx.Tx, req StartRequest, g *CatalogGame, level int) ([]Item, []ClipItem, int, error) {
	refs, err := s.StudyForms.FormItems(ctx, tx, req.Study.Participant, req.Study.Phase)
	if err != nil {
		return nil, nil, 0, err
	}
	if len(refs) == 0 || len(refs) > 40 {
		return nil, nil, 0, fmt.Errorf("%w: study form has %d items", ErrPoolTooSmall, len(refs))
	}
	byRef := map[string]CatalogItem{}
	for _, it := range g.Items {
		byRef[it.Ref] = it
	}
	var items []Item
	var clips []ClipItem
	for i, ref := range refs {
		it := Item{Ordinal: i + 1, Ref: ref, Kind: itemKind(ref)}
		if id, v, ok := clipRef(ref); ok {
			c := ClipItem{Ref: ref, ClipID: id, Version: v}
			it.ContentVersion = clipContentVersion(c)
			clips = append(clips, c)
		} else if ci, ok := byRef[ref]; ok {
			it.ContentVersion = ci.ContentVersion
		} else {
			return nil, nil, 0, fmt.Errorf("%w: study item %s not in the catalogue", ErrPoolTooSmall, ref)
		}
		items = append(items, it)
	}
	difficulty := level
	if req.Mode == ModeMock {
		difficulty = 3
	}
	return items, clips, difficulty, nil
}

func clipContentVersion(c ClipItem) string {
	if c.ContentVersion != "" {
		return c.ContentVersion
	}
	return strconv.Itoa(c.Version)
}

func catalogItems(cs []CatalogItem) []Item {
	out := make([]Item, len(cs))
	for i, c := range cs {
		out[i] = Item{Ordinal: i + 1, Ref: c.Ref, ContentVersion: c.ContentVersion, Kind: itemKind(c.Ref)}
	}
	return out
}

func buildContext(sess *Session, req StartRequest) SessionContext {
	band := req.Subject.UserBand
	if band == "" {
		band = "adult"
	}
	locale := req.Locale
	if locale == "" {
		locale = "en"
	}
	device := req.DeviceClass
	if device == "" {
		device = "mid"
	}
	scale := req.TextScale
	if scale < 1 || scale > 2 {
		scale = 1
	}
	modes := slices.Clone(req.A11yModes)
	if modes == nil {
		modes = []string{}
	}
	items := make([]ContextItem, len(sess.Items))
	for i, it := range sess.Items {
		items[i] = ContextItem{Ref: it.Ref, ContentVersion: it.ContentVersion}
	}
	start := sess.StartedAt.UTC().Format("2006-01-02T15:04:05.000Z")
	return SessionContext{
		SID: sess.ID.String(), GameID: sess.GameID, Mode: sess.Mode, UserBand: band, Locale: locale,
		A11y:       A11y{Modes: modes, TextScale: scale, Haptics: req.Haptics},
		Difficulty: sess.Difficulty, Seed: sess.Seed, SeedOrigin: sess.SeedOrigin, Items: items,
		DeviceClass: device, Offline: false, ServerStartISO: &start,
		Tenant: sess.Subject.Tenant, RulePackVersion: sess.RulePackVersion,
	}
}

// decorate adds presigned media URLs and, for practice, the reveal windows.
func (s *Service) decorate(ctx context.Context, sess *Session, clips []ClipItem) ([]StartItem, error) {
	out := make([]StartItem, len(sess.Items))
	for i, it := range sess.Items {
		out[i] = StartItem{Item: it}
	}
	if len(clips) == 0 {
		return out, nil
	}
	var reveals []json.RawMessage
	if sess.Mode == ModePractice {
		refs := make([]string, len(clips))
		for i, c := range clips {
			refs[i] = c.Ref
		}
		docs, err := s.Clips.ScoringDocs(ctx, refs)
		if err != nil {
			return nil, err
		}
		if len(docs) != len(refs) {
			return nil, fmt.Errorf("games: %d scoring documents for %d clips", len(docs), len(refs))
		}
		for _, d := range docs {
			var rd revealDoc
			if err := json.Unmarshal(d, &rd); err != nil {
				return nil, fmt.Errorf("games: scoring document: %w", err)
			}
			r, _ := json.Marshal(map[string]any{"hazards": rd.Hazards})
			reveals = append(reveals, r)
		}
	}
	ci := 0
	for i := range out {
		if out[i].Kind != "clip" {
			continue
		}
		u, sha, n, err := s.Clips.AssetURL(ctx, out[i].Ref, sess.ID)
		if err != nil {
			return nil, err
		}
		out[i].AssetURL, out[i].SHA256, out[i].Bytes = u, sha, n
		if reveals != nil {
			out[i].Reveal = reveals[ci]
		}
		ci++
	}
	return out, nil
}

// exposures: mock and study clips are seen once dealt; practice reveals windows; learn shows
// what happens next. All of them make a clip ineligible for a later mock.
func exposures(sess *Session, clips []ClipItem, at time.Time) []Exposure {
	via := ""
	switch {
	case sess.Cohort == CohortFieldTest:
		via = ViaStudy
	case sess.Mode == ModeMock || sess.Mode == ModePair:
		via = ViaMock
	case sess.Mode == ModePractice:
		via = ViaPractice
	case sess.Mode == ModeLearn:
		via = ViaLearn
	}
	out := make([]Exposure, 0, len(clips))
	for _, c := range clips {
		out = append(out, Exposure{ClipID: c.ClipID, Via: via, SessionID: sess.ID, At: at})
	}
	return out
}

func setOf(xs []string) map[string]bool {
	m := make(map[string]bool, len(xs))
	for _, x := range xs {
		m[x] = true
	}
	return m
}
