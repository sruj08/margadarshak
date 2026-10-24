package httpapi

// Gamification handlers (workstream B; GAMIFICATION_ENGINE §2–§10): API-38 achievements, API-39
// co-op squads, API-44 the Khud Licence self-declaration and API-57 share cards. The internal
// package speaks badge IDs B1..B9, ranks R1..R5, share-card kinds nazar_score|badge and bare
// short IDs; this file maps them to the wire keys (gamify.BadgeNames, gamify.RankNames, shc_…).
// Every number on a share card is recomputed by gamify.Service.ShareCardData; a client score is
// rejected by the strict decoder before anything runs.

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/gamify"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/learner"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

func init() {
	problemTitles["GONE"] = "No longer available"
}

// ---- Wire shapes ------------------------------------------------------------------------------

type gamifyBadgeOut struct {
	BadgeID      string     `json:"badge_id"`
	AwardedAt    *time.Time `json:"awarded_at"`
	SelfDeclared bool       `json:"self_declared"`
	Label        string     `json:"label,omitempty"`
}

type gamifyStreakOut struct {
	Status       string `json:"status"`
	WeeklyGoal   int    `json:"weekly_goal"`
	ThisWeek     int    `json:"this_week"`
	Weeks        int    `json:"weeks"`
	FreezeTokens int    `json:"freeze_tokens"`
	Archived     bool   `json:"archived"`
}

type gamifyAchievementOut struct {
	XPTotal          int              `json:"xp_total"`
	XPToday          int              `json:"xp_today"`
	XPMultiplier     float64          `json:"xp_multiplier_today"`
	Rank             string           `json:"rank"`
	RankRequirements map[string]any   `json:"rank_requirements,omitempty"`
	Badges           []gamifyBadgeOut `json:"badges"`
	Streak           gamifyStreakOut  `json:"streak"`
}

type gamifyMemberOut struct {
	DisplayName   string `json:"display_name"`
	Rank          string `json:"rank"`
	WeeklyGoalHit bool   `json:"weekly_goal_hit"`
	Role          string `json:"role"`
	IsMe          bool   `json:"is_me"`
}

type gamifySquadOut struct {
	SquadID        string            `json:"squad_id"`
	Name           string            `json:"name"`
	InviteCode     string            `json:"invite_code,omitempty"`
	InviteExpires  time.Time         `json:"invite_expires_at"`
	Members        []gamifyMemberOut `json:"members"`
	SquadScore     *int              `json:"squad_score"`
	WeeklyProgress struct {
		Done int `json:"done"`
		Goal int `json:"goal"`
	} `json:"weekly_progress"`
	WeekKey        string `json:"week_key"`
	RibbonThisWeek bool   `json:"ribbon_this_week"`
}

type gamifySquadPage struct {
	Items []gamifySquadOut `json:"items"`
}

type gamifyCardContent struct {
	DisplayName     string  `json:"display_name"`
	NazarScore      float64 `json:"nazar_score"`
	CountedSessions int     `json:"counted_sessions"`
	Rank            string  `json:"rank"`
	Badge           string  `json:"badge,omitempty"`
	KeralaLine      bool    `json:"kerala_line"`
	Percentile      *int    `json:"percentile"`
}

type gamifyCardOut struct {
	ShareCardID string            `json:"share_card_id"`
	Kind        string            `json:"kind"`
	URL         string            `json:"url"`
	ImageURL    string            `json:"image_url"`
	Content     gamifyCardContent `json:"content"`
	CreatedAt   time.Time         `json:"created_at"`
	ExpiresAt   time.Time         `json:"expires_at"`
}

type gamifyCardPublic struct {
	ShareCardID   string            `json:"share_card_id"`
	Kind          string            `json:"kind"`
	Content       gamifyCardContent `json:"content"`
	ImageURL      string            `json:"image_url"`
	TaglineKey    string            `json:"tagline_key,omitempty"`
	FooterKey     string            `json:"footer_key"`
	KeralaLineKey string            `json:"kerala_line_key,omitempty"`
}

// ---- Mapping helpers --------------------------------------------------------------------------

// gamifyErr maps gamify (and family-mode) errors to problems. Internal error text never leaks.
func (s *Server) gamifyErr(w http.ResponseWriter, r *http.Request, err error) {
	var ve *gamify.ValidationError
	switch {
	case s.learnerError(w, r, err): // PARENT_CONSENT_REQUIRED (gamify.ErrParentConsentRequired), compute down
	case errors.Is(err, gamify.ErrComputeUnavailable):
		computeUnavailable(w, r)
	case errors.Is(err, gamify.ErrAccountRequired):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "ACCOUNT_REQUIRED", Detail: "This needs an account, not an anonymous device session."})
	case errors.Is(err, gamify.ErrNotFound):
		notFound(w, r)
	case errors.Is(err, gamify.ErrSquadFull):
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "SQUAD_FULL", Detail: "A squad has at most 5 members."})
	case errors.Is(err, gamify.ErrInviteExpired):
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "INVITE_EXPIRED", Detail: "Invite links last 7 days; ask for a new one."})
	case errors.Is(err, gamify.ErrGone):
		gamifyGone(w, r)
	case errors.Is(err, gamify.ErrNothingToShare):
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "SHARE_CARD_NOT_ALLOWED",
			Detail: "A card needs at least one counted Nazar mock (and, for a badge card, the earned badge)."})
	case errors.Is(err, gamify.ErrUnknownField):
		validation(w, r, "/", "unknown_field")
	case errors.As(err, &ve):
		ptr := ve.Pointer
		if ptr == "/display_text" || ptr == "/display" {
			ptr = "/display_name"
		}
		if ve.Code == "PROHIBITED_FIELD" {
			writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Detail: "1 field failed validation",
				Errors: []FieldError{{Pointer: ptr, Code: "PROHIBITED_FIELD", MessageKey: "errors.prohibited_field"}}})
			return
		}
		validation(w, r, ptr, ve.Code)
	default:
		s.deps.Log.ErrorContext(r.Context(), "gamify request failed", "err", err)
		internalError(w, r)
	}
}

func gamifyGone(w http.ResponseWriter, r *http.Request) {
	writeProblem(w, r, Problem{Status: http.StatusGone, Code: "GONE", Detail: "This card was withdrawn or has expired."})
}

func gamifyRankKey(id string) string {
	if k, ok := gamify.RankNames[id]; ok {
		return k
	}
	return gamify.RankNames["R1"]
}

// gamifyBadgeID maps a wire badge key to the internal ID (B1..B9).
func gamifyBadgeID(key string) (string, bool) {
	for id, k := range gamify.BadgeNames {
		if k == key {
			return id, true
		}
	}
	return "", false
}

// gamifyRankReqs turns the compute RankGap (camelCase, R-ids) into the wire rank_requirements.
func gamifyRankReqs(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	if strings.TrimSpace(string(raw)) == "null" {
		return map[string]any{"next": nil} // at Ghat
	}
	var gap struct {
		Rank         string  `json:"rank"`
		XPRequired   float64 `json:"xpRequired"`
		XPMissing    float64 `json:"xpMissing"`
		NodesMissing []struct {
			Node string `json:"node"`
		} `json:"nodesMissing"`
		NazarMocksMissing float64 `json:"nazarMocksMissing"`
	}
	if json.Unmarshal(raw, &gap) != nil || gap.Rank == "" {
		return nil
	}
	nodes := make([]string, 0, len(gap.NodesMissing))
	for _, n := range gap.NodesMissing {
		nodes = append(nodes, n.Node)
	}
	return map[string]any{"next": gamifyRankKey(gap.Rank), "xp_required": int(gap.XPRequired), "xp_missing": int(gap.XPMissing),
		"missing_nodes": nodes, "nazar_mocks_missing": int(gap.NazarMocksMissing)}
}

func gamifyAchievementsOut(a *gamify.Achievements) gamifyAchievementOut {
	out := gamifyAchievementOut{XPTotal: a.XPTotal, XPToday: a.XPToday, XPMultiplier: a.XPMultiplier, Rank: a.Rank,
		RankRequirements: gamifyRankReqs(a.RankRequirements), Badges: []gamifyBadgeOut{},
		Streak: gamifyStreakOut{Status: a.Streak.Status, WeeklyGoal: a.Streak.WeeklyGoal, ThisWeek: a.Streak.ThisWeek,
			Weeks: a.Streak.Weeks, FreezeTokens: a.Streak.FreezeTokens, Archived: a.Streak.Archived}}
	if out.Rank == "" {
		out.Rank = gamifyRankKey("R1")
	}
	if out.Streak.Status == "" {
		out.Streak.Status = "active"
	}
	for _, b := range a.Badges {
		if b.BadgeID == "" {
			continue // an ID this build has no key for
		}
		bo := gamifyBadgeOut{BadgeID: b.BadgeID, SelfDeclared: b.SelfDeclared}
		if !b.AwardedAt.IsZero() {
			t := b.AwardedAt.UTC()
			bo.AwardedAt = &t
		}
		if b.SelfDeclared {
			bo.Label = "your_word"
		}
		out.Badges = append(out.Badges, bo)
	}
	return out
}

// gamifySquadOut renders what a squad member sees: display name, rank and weekly goal yes/no per
// member (never scores), the co-op score from the domain view, and the weekly goal of 3 × members
// (decision D-11).
func (s *Server) gamifySquadOut(r *http.Request, viewer learner.Subject, v *gamify.SquadView) (gamifySquadOut, error) {
	ctx := r.Context()
	g := s.deps.Gamify
	id, err := uuid.Parse(strings.TrimPrefix(v.SquadID, "sqd_"))
	if err != nil {
		return gamifySquadOut{}, err
	}
	sq, err := g.Store.GetSquad(ctx, id)
	if err != nil {
		return gamifySquadOut{}, err
	}
	week := gamify.WeekKey(g.Clock.Now())
	out := gamifySquadOut{SquadID: ids.Encode(ids.Squad, id), Name: sq.Name, InviteCode: v.InviteCode, InviteExpires: sq.InviteExpiresAt.UTC(),
		Members: []gamifyMemberOut{}, SquadScore: v.SquadScore, WeekKey: week}
	done := 0
	for _, m := range sq.Members {
		rank, goal := "R1", 4
		p, err := g.Store.GetProgress(ctx, m.Subject)
		switch {
		case err == nil:
			if p.Rank != "" {
				rank = p.Rank
			}
			if p.StreakGoal > 0 {
				goal = p.StreakGoal
			}
		case !errors.Is(err, gamify.ErrNotFound):
			return gamifySquadOut{}, err
		}
		counts, err := g.Store.WeekCounts(ctx, m.Subject)
		if err != nil {
			return gamifySquadOut{}, err
		}
		done += counts[week]
		out.Members = append(out.Members, gamifyMemberOut{DisplayName: m.DisplayName, Rank: gamifyRankKey(rank),
			WeeklyGoalHit: counts[week] >= goal, Role: m.Role, IsMe: m.Subject.Key() == viewer.Key()})
	}
	out.WeeklyProgress.Done, out.WeeklyProgress.Goal = done, 3*len(sq.Members)
	out.RibbonThisWeek = out.WeeklyProgress.Goal > 0 && done >= out.WeeklyProgress.Goal
	return out, nil
}

func (s *Server) gamifyWriteSquad(w http.ResponseWriter, r *http.Request, status int, viewer learner.Subject, v *gamify.SquadView) {
	out, err := s.gamifySquadOut(r, viewer, v)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	writeJSON(w, status, out)
}

var gamifyShortIDRe = regexp.MustCompile(`^[a-km-np-z2-9]{10}$`)

// gamifyCardID renders a short ID as shc_ + upper case; gamifyShortID reverses it.
func gamifyCardID(short string) string { return ids.ShareCard + "_" + strings.ToUpper(short) }

func gamifyShortID(wire string) (string, bool) {
	rest, ok := strings.CutPrefix(wire, ids.ShareCard+"_")
	if !ok {
		return "", false
	}
	short := strings.ToLower(rest)
	return short, gamifyShortIDRe.MatchString(short)
}

// gamifyWireKind maps the package kind to the API kind ("" for kinds the API cannot show).
func gamifyWireKind(kind string) string {
	switch kind {
	case "nazar_score":
		return "nazar"
	case "badge":
		return "badge"
	}
	return ""
}

func gamifyLocale(l string) string {
	if l == "hi" {
		return "hi"
	}
	return "en"
}

func (s *Server) gamifyWebBase() string {
	if s.deps.WebBaseURLShare != "" {
		return strings.TrimRight(s.deps.WebBaseURLShare, "/")
	}
	if s.deps.WebBaseURL != "" {
		return strings.TrimRight(s.deps.WebBaseURL, "/")
	}
	return strings.TrimRight(s.deps.PublicBaseURL, "/")
}

func (s *Server) gamifyImageURL(kind, id, locale string) string {
	u := strings.TrimRight(s.deps.PublicBaseURL, "/") + "/v1/share-cards/" + kind + "/" + id + ".png"
	if locale != "" {
		u += "?locale=" + locale
	}
	return u
}

func gamifyContent(d *gamify.ShareCardData) gamifyCardContent {
	c := gamifyCardContent{DisplayName: d.DisplayName, CountedSessions: d.VerifiedSessions, Rank: d.Rank, Badge: d.Badge,
		KeralaLine: d.KeralaLineKey != ""}
	if d.NazarScore != nil {
		c.NazarScore = float64(*d.NazarScore)
	}
	return c
}

// gamifyInitials keeps only the initials of a display name ("Kabir Sharma" → "KS"), so the full
// name is never stored on the card.
func gamifyInitials(name string) string {
	var b strings.Builder
	n := 0
	for _, word := range strings.Fields(name) {
		for _, r := range word {
			if unicode.IsLetter(r) {
				b.WriteRune(unicode.ToUpper(r))
				n++
				break
			}
		}
		if n == 3 {
			break
		}
	}
	return b.String()
}

// ---- API-38 -----------------------------------------------------------------------------------

// GetAchievements is API-38: XP, rank, badges and the weekly streak (stored state, no compute).
func (s *Server) GetAchievements(w http.ResponseWriter, r *http.Request, params gen.GetAchievementsParams) {
	if s.deps.Gamify == nil {
		serviceMissing(w, r)
		return
	}
	subj, ok := s.learnerFor(w, r, memberRef(params.FamilyMemberId))
	if !ok {
		return
	}
	a, err := s.deps.Gamify.Achievements(r.Context(), subj)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gamifyAchievementsOut(a))
}

// ---- API-39 -----------------------------------------------------------------------------------

// gamifySquadSubject resolves the subject of a squad request and applies the squads extra.
func (s *Server) gamifySquadSubject(w http.ResponseWriter, r *http.Request, member string) (learner.Subject, bool) {
	if s.deps.Gamify == nil {
		serviceMissing(w, r)
		return learner.Subject{}, false
	}
	subj, ok := s.learnerFor(w, r, member)
	if !ok {
		return learner.Subject{}, false
	}
	if !subj.Account {
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "ACCOUNT_REQUIRED", Detail: "This needs an account, not an anonymous device session."})
		return learner.Subject{}, false
	}
	return subj, s.requireExtra(w, r, subj, "squads")
}

// CreateSquad is API-39 create. Creating earns no XP.
func (s *Server) CreateSquad(w http.ResponseWriter, r *http.Request, params gen.CreateSquadParams) {
	subj, ok := s.gamifySquadSubject(w, r, memberRef(params.FamilyMemberId))
	if !ok {
		return
	}
	var req gen.SquadCreate
	if !decodeJSON(w, r, &req, false) {
		return
	}
	v, err := s.deps.Gamify.CreateSquad(r.Context(), subj, gamify.SquadCreate{Name: req.Name, DisplayName: req.DisplayName})
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	s.gamifyWriteSquad(w, r, http.StatusCreated, subj, v)
}

// JoinSquad is API-39 join: the code from the invite link (/s/{squad_id}.{invite_code}) in the
// body, the squad in the path. Joining twice returns the squad again. Joining earns no XP.
func (s *Server) JoinSquad(w http.ResponseWriter, r *http.Request, squadID gen.SquadId, params gen.JoinSquadParams) {
	id, err := ids.Decode(ids.Squad, squadID)
	if err != nil {
		notFound(w, r)
		return
	}
	subj, ok := s.gamifySquadSubject(w, r, memberRef(params.FamilyMemberId))
	if !ok {
		return
	}
	var req gen.SquadJoin
	if !decodeJSON(w, r, &req, false) {
		return
	}
	v, err := s.deps.Gamify.JoinSquadID(r.Context(), subj, id, req.InviteCode, req.DisplayName)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	s.gamifyWriteSquad(w, r, http.StatusCreated, subj, v)
}

// ListMySquads is API-39 mine: the subject's active squads.
func (s *Server) ListMySquads(w http.ResponseWriter, r *http.Request, params gen.ListMySquadsParams) {
	subj, ok := s.gamifySquadSubject(w, r, memberRef(params.FamilyMemberId))
	if !ok {
		return
	}
	list, err := s.deps.Gamify.MySquads(r.Context(), subj)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	page := gamifySquadPage{Items: make([]gamifySquadOut, 0, len(list))}
	for _, v := range list {
		out, err := s.gamifySquadOut(r, subj, v)
		if err != nil {
			s.gamifyErr(w, r, err)
			return
		}
		page.Items = append(page.Items, out)
	}
	writeJSON(w, http.StatusOK, page)
}

// LeaveSquad is API-39 leave: one step, idempotent (not a member, or no such squad, is also 204).
// It needs no squads extra, so a parent withdrawing the extra never traps a minor in a squad.
func (s *Server) LeaveSquad(w http.ResponseWriter, r *http.Request, squadID gen.SquadId, params gen.LeaveSquadParams) {
	if s.deps.Gamify == nil {
		serviceMissing(w, r)
		return
	}
	id, err := ids.Decode(ids.Squad, squadID)
	if err != nil {
		notFound(w, r)
		return
	}
	subj, ok := s.learnerFor(w, r, memberRef(params.FamilyMemberId))
	if !ok {
		return
	}
	if err := s.deps.Gamify.LeaveSquad(r.Context(), subj, id); err != nil && !errors.Is(err, gamify.ErrNotFound) {
		s.gamifyErr(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// ---- API-44 -----------------------------------------------------------------------------------

// DeclareKhudLicence is API-44: the self-declaration behind the Khud Licence (and, with
// first_attempt_pass, Pehli Baar Pass) badges, always labelled "your word". It earns no XP.
func (s *Server) DeclareKhudLicence(w http.ResponseWriter, r *http.Request, _ gen.DeclareKhudLicenceParams) {
	if s.deps.Gamify == nil {
		serviceMissing(w, r)
		return
	}
	var req gen.KhudLicenceDeclaration
	if !decodeJSON(w, r, &req, false) {
		return
	}
	if !bool(req.NoAgentUsed) {
		validation(w, r, "/no_agent_used", "must_be_true")
		return
	}
	in := gamify.KhudLicenceInput{DLIssuedOn: time.Date(req.DlIssuedOn.Year(), req.DlIssuedOn.Month(), req.DlIssuedOn.Day(), 0, 0, 0, 0, servertime.IST),
		NoAgentUsed: true}
	if req.CaseId != nil {
		in.CaseID = *req.CaseId
	}
	if req.FirstAttemptPass != nil {
		in.FirstAttemptPass = *req.FirstAttemptPass
	}
	a, err := s.deps.Gamify.DeclareKhudLicence(r.Context(), accounts.LearnerOf(principalFrom(r.Context())), in)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, gamifyAchievementsOut(a))
}

// ---- API-57 -----------------------------------------------------------------------------------

// CreateShareCard is API-57 create. The body has no score field (the strict decoder answers 422
// to one); the card's numbers are recomputed from server data on every read.
func (s *Server) CreateShareCard(w http.ResponseWriter, r *http.Request, _ gen.CreateShareCardParams) {
	g := s.deps.Gamify
	if g == nil {
		serviceMissing(w, r)
		return
	}
	var req gen.ShareCardCreate
	if !decodeJSON(w, r, &req, false) {
		return
	}
	subj, ok := s.learnerFor(w, r, memberRef(req.FamilyMemberId))
	if !ok {
		return
	}
	if !subj.Account {
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "ACCOUNT_REQUIRED", Detail: "This needs an account, not an anonymous device session."})
		return
	}
	if !s.requireExtra(w, r, subj, "share_cards") {
		return
	}
	in := gamify.ShareCardCreate{KeralaLine: req.KeralaLine != nil && *req.KeralaLine}
	switch req.Kind {
	case gen.ShareCardCreateKind("nazar"):
		in.Kind = "nazar_score"
	case gen.ShareCardCreateKind("badge"):
		in.Kind = "badge"
	default:
		validation(w, r, "/kind", "invalid_enum")
		return
	}
	switch req.NameDisplay {
	case gen.ShareCardCreateNameDisplay("initials"):
		in.Display, in.DisplayText = "initials", gamifyInitials(req.DisplayName)
	case gen.ShareCardCreateNameDisplay("display_name"):
		in.Display, in.DisplayText = "first_name", strings.TrimSpace(req.DisplayName)
	default:
		validation(w, r, "/name_display", "invalid_enum")
		return
	}
	if req.BadgeId != nil {
		id, ok := gamifyBadgeID(string(*req.BadgeId))
		if !ok {
			validation(w, r, "/badge_id", "invalid_enum")
			return
		}
		in.BadgeID = id
	}
	if in.Kind == "badge" && in.BadgeID == "" {
		validation(w, r, "/badge_id", "required")
		return
	}
	// Every card carries the Nazar Score (ShareCardContent requires it), so a badge card also
	// needs a counted Nazar mock.
	if g.Nazar == nil {
		s.gamifyErr(w, r, gamify.ErrNothingToShare)
		return
	}
	score, _, err := g.Nazar.NazarScore(r.Context(), subj)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	if score == nil {
		s.gamifyErr(w, r, gamify.ErrNothingToShare)
		return
	}
	c, err := g.CreateShareCard(r.Context(), subj, in)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	d, err := g.ShareCardData(r.Context(), c.ShortID)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	id, kind, locale := gamifyCardID(c.ShortID), gamifyWireKind(c.Kind), "en"
	if req.Locale != nil {
		locale = gamifyLocale(string(*req.Locale))
	}
	writeJSON(w, http.StatusCreated, gamifyCardOut{ShareCardID: id, Kind: kind, URL: s.gamifyWebBase() + "/" + locale + "/c/" + id,
		ImageURL: s.gamifyImageURL(kind, id, locale), Content: gamifyContent(d), CreatedAt: c.CreatedAt.UTC(), ExpiresAt: c.ExpiresAt.UTC()})
}

// GetShareCardData is API-57 public data (anonymous, read across tenants by short ID).
func (s *Server) GetShareCardData(w http.ResponseWriter, r *http.Request, shareCardID gen.ShareCardId) {
	if s.deps.Gamify == nil {
		serviceMissing(w, r)
		return
	}
	short, ok := gamifyShortID(shareCardID)
	if !ok {
		notFound(w, r)
		return
	}
	d, err := s.deps.Gamify.ShareCardData(r.Context(), short)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	kind := gamifyWireKind(d.Kind)
	if kind == "" || d.NazarScore == nil {
		gamifyGone(w, r) // a rank card, or a card whose Nazar mocks were erased: nothing showable
		return
	}
	id := gamifyCardID(d.ShortID)
	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, http.StatusOK, gamifyCardPublic{ShareCardID: id, Kind: kind, Content: gamifyContent(d), ImageURL: s.gamifyImageURL(kind, id, ""),
		TaglineKey: d.TaglineKey, FooterKey: d.FooterKey, KeralaLineKey: d.KeralaLineKey})
}

// WithdrawShareCard is API-57 withdraw (idempotent). The account holder may withdraw a card made
// for any of their family members.
func (s *Server) WithdrawShareCard(w http.ResponseWriter, r *http.Request, shareCardID gen.ShareCardId) {
	g := s.deps.Gamify
	if g == nil {
		serviceMissing(w, r)
		return
	}
	short, ok := gamifyShortID(shareCardID)
	if !ok {
		notFound(w, r)
		return
	}
	p := principalFrom(r.Context())
	c, err := g.Store.GetShareCard(r.Context(), short)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	if p == nil || c.Subject.Tenant != p.Tenant || c.Subject.ApplicantID != p.ApplicantID {
		notFound(w, r)
		return
	}
	if err := g.WithdrawShareCard(r.Context(), c.Subject, short); err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// GetShareCard is API-57 image: 302 to the web app's Open Graph image (decision D3). The kind in
// the path must match the card.
func (s *Server) GetShareCard(w http.ResponseWriter, r *http.Request, kind gen.GetShareCardParamsKind, id string, params gen.GetShareCardParams) {
	if s.deps.Gamify == nil {
		serviceMissing(w, r)
		return
	}
	short, ok := gamifyShortID(id)
	if !ok {
		notFound(w, r)
		return
	}
	d, err := s.deps.Gamify.ShareCardData(r.Context(), short)
	if err != nil {
		s.gamifyErr(w, r, err)
		return
	}
	if gamifyWireKind(d.Kind) != string(kind) {
		notFound(w, r)
		return
	}
	locale := "en"
	if params.Locale != nil {
		locale = gamifyLocale(string(*params.Locale))
	}
	w.Header().Set("Location", s.gamifyWebBase()+"/"+locale+"/c/"+gamifyCardID(short)+"/opengraph-image")
	w.Header().Set("Cache-Control", "public, max-age=60")
	w.WriteHeader(http.StatusFound)
}
