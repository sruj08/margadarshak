package gamify

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// Squad rules (GAMIFICATION_ENGINE §8; E-23).
const (
	MaxSquadMembers    = 5
	MinScoreMembers    = 3
	InviteTTL          = 7 * 24 * time.Hour
	DefaultWeeklyGoal  = 15
	ShareCardTTL       = 90 * 24 * time.Hour
	inviteAlphabet     = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // no 0/O, 1/I/L
	shortIDAlphabet    = "abcdefghijkmnpqrstuvwxyz23456789"
	maxDisplayNameRune = 24
)

// SquadMember is one member (E-23). Others see only the display name, the role and whether the
// member met their weekly goal: never scores, calibration or failures.
type SquadMember struct {
	Subject     Subject
	DisplayName string
	Role        string // owner | member
	JoinedAt    time.Time
}

// Squad is game.squads with its members (game.squad_members, capped at 5 by a trigger).
type Squad struct {
	ID              uuid.UUID
	Tenant          string
	Name            string
	InviteCodeHash  []byte
	InviteExpiresAt time.Time
	WeeklyGoal      int
	CreatedAt       time.Time
	DisbandedAt     *time.Time
	Members         []SquadMember
}

// SquadMemberView is a member as other members see them.
type SquadMemberView struct {
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
	GoalMet     bool   `json:"goal_met"`
}

// SquadView is the API-39 Squad.
type SquadView struct {
	SquadID        string            `json:"squad_id"`
	Name           string            `json:"name"`
	InviteCode     string            `json:"invite_code,omitempty"` // only in the create response
	InviteExpires  time.Time         `json:"invite_expires_at"`
	Members        []SquadMemberView `json:"members"`
	SquadScore     *int              `json:"squad_score"`
	WeeklyProgress struct {
		Done int `json:"done"`
		Goal int `json:"goal"`
	} `json:"weekly_progress"`
	RibbonThisWeek bool `json:"ribbon_this_week"`
}

func hashCode(code string) []byte {
	h := sha256.Sum256([]byte(strings.ToUpper(strings.TrimSpace(code))))
	return h[:]
}

func cleanText(s string, minRunes, maxRunes int, ptr string) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < minRunes || n > maxRunes {
		return "", &ValidationError{ptr, "length"}
	}
	if len(privacy.Detect(s)) > 0 {
		return "", &ValidationError{ptr, "PROHIBITED_FIELD"}
	}
	return s, nil
}

// SquadCreate is the API-39 create input.
type SquadCreate struct {
	Name        string
	DisplayName string // how the creator appears to members (user-chosen)
	WeeklyGoal  int    // 3–40, default 15
}

// CreateSquad creates a squad with the caller as owner. Creating earns no XP.
func (s *Service) CreateSquad(ctx context.Context, subj Subject, in SquadCreate) (*SquadView, error) {
	if err := s.requireSocial(ctx, subj, "squads"); err != nil {
		return nil, err
	}
	name, err := cleanText(in.Name, 2, 40, "/name")
	if err != nil {
		return nil, err
	}
	display, err := cleanText(in.DisplayName, 1, maxDisplayNameRune, "/display_name")
	if err != nil {
		return nil, err
	}
	goal := in.WeeklyGoal
	if goal == 0 {
		goal = DefaultWeeklyGoal
	}
	if goal < 3 || goal > 40 {
		return nil, &ValidationError{"/weekly_goal_sessions", "out_of_range"}
	}
	now := s.now()
	code := "SQ-" + s.tokens().Token(inviteAlphabet, 6)
	sq := &Squad{ID: uuid.New(), Tenant: subj.Tenant, Name: name, InviteCodeHash: hashCode(code), InviteExpiresAt: now.Add(InviteTTL),
		WeeklyGoal: goal, CreatedAt: now, Members: []SquadMember{{Subject: subj, DisplayName: display, Role: "owner", JoinedAt: now}}}
	if err := s.Store.InsertSquad(ctx, sq); err != nil {
		return nil, err
	}
	v, err := s.view(ctx, sq)
	if err != nil {
		return nil, err
	}
	v.InviteCode = code
	return v, nil
}

func isMember(sq *Squad, subj Subject) int {
	for i, m := range sq.Members {
		if m.Subject.Key() == subj.Key() {
			return i
		}
	}
	return -1
}

// JoinSquad joins by invite code. A minor's profile needs the parent's "squads" extra consent;
// a full squad (5) is refused; joining twice is a no-op. Joining earns no XP.
func (s *Service) JoinSquad(ctx context.Context, subj Subject, code, displayName string) (*SquadView, error) {
	return s.joinSquad(ctx, subj, uuid.Nil, code, displayName)
}

// JoinSquadID is JoinSquad for a link that names the squad (API-39 /v1/squads/{squadId}/join): a
// code that opens a different squad is ErrNotFound, so nothing is joined by mistake.
func (s *Service) JoinSquadID(ctx context.Context, subj Subject, squadID uuid.UUID, code, displayName string) (*SquadView, error) {
	if squadID == uuid.Nil {
		return nil, ErrNotFound
	}
	return s.joinSquad(ctx, subj, squadID, code, displayName)
}

func (s *Service) joinSquad(ctx context.Context, subj Subject, squadID uuid.UUID, code, displayName string) (*SquadView, error) {
	if err := s.requireSocial(ctx, subj, "squads"); err != nil {
		return nil, err
	}
	display, err := cleanText(displayName, 1, maxDisplayNameRune, "/display_name")
	if err != nil {
		return nil, err
	}
	sq, err := s.Store.SquadByInviteHash(ctx, hashCode(code))
	if err != nil {
		return nil, err
	}
	if sq.DisbandedAt != nil || sq.Tenant != subj.Tenant || (squadID != uuid.Nil && sq.ID != squadID) {
		return nil, ErrNotFound
	}
	if isMember(sq, subj) >= 0 {
		return s.view(ctx, sq)
	}
	if !s.now().Before(sq.InviteExpiresAt) {
		return nil, ErrInviteExpired
	}
	if len(sq.Members) >= MaxSquadMembers {
		return nil, ErrSquadFull
	}
	sq.Members = append(sq.Members, SquadMember{Subject: subj, DisplayName: display, Role: "member", JoinedAt: s.now()})
	if err := s.Store.UpdateSquad(ctx, sq); err != nil {
		return nil, err
	}
	return s.view(ctx, sq)
}

// MySquads lists the caller's active squads.
func (s *Service) MySquads(ctx context.Context, subj Subject) ([]*SquadView, error) {
	sqs, err := s.Store.SquadsOf(ctx, subj)
	if err != nil {
		return nil, err
	}
	out := []*SquadView{}
	for _, sq := range sqs {
		if sq.DisbandedAt != nil {
			continue
		}
		v, err := s.view(ctx, sq)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// LeaveSquad leaves in one step, with no reason asked. If the owner leaves, the longest-standing
// member becomes owner; the last member leaving disbands the squad.
func (s *Service) LeaveSquad(ctx context.Context, subj Subject, squadID uuid.UUID) error {
	sq, err := s.Store.GetSquad(ctx, squadID)
	if err != nil {
		return err
	}
	i := isMember(sq, subj)
	if i < 0 {
		return ErrNotFound
	}
	wasOwner := sq.Members[i].Role == "owner"
	sq.Members = append(sq.Members[:i], sq.Members[i+1:]...)
	if len(sq.Members) == 0 {
		now := s.now()
		sq.DisbandedAt = &now
	} else if wasOwner {
		sort.SliceStable(sq.Members, func(a, b int) bool { return sq.Members[a].JoinedAt.Before(sq.Members[b].JoinedAt) })
		sq.Members[0].Role = "owner"
	}
	return s.Store.UpdateSquad(ctx, sq)
}

// view builds what members see: names, roles, goal met yes/no; the co-op squad score only when
// at least 3 members contribute (mean of NazarScore × (1 − Brier), rounded; gamification
// squadScore), and the weekly goal (everyone gets the ribbon, or nobody does).
func (s *Service) view(ctx context.Context, sq *Squad) (*SquadView, error) {
	v := &SquadView{SquadID: "sqd_" + sq.ID.String(), Name: sq.Name, InviteExpires: sq.InviteExpiresAt, Members: []SquadMemberView{}}
	week := WeekKey(s.now())
	var contributions []float64
	done := 0
	for _, m := range sq.Members {
		counts, err := s.Store.WeekCounts(ctx, m.Subject)
		if err != nil {
			return nil, err
		}
		p, err := s.progress(ctx, m.Subject)
		if err != nil {
			return nil, err
		}
		done += counts[week]
		v.Members = append(v.Members, SquadMemberView{DisplayName: m.DisplayName, Role: m.Role, GoalMet: counts[week] >= p.StreakGoal})
		if s.Nazar != nil && s.Brier != nil {
			score, _, err := s.Nazar.NazarScore(ctx, m.Subject)
			if err != nil {
				return nil, err
			}
			b, err := s.Brier.Brier(ctx, m.Subject)
			if err != nil {
				return nil, err
			}
			if score != nil && b != nil {
				contributions = append(contributions, *score*(1-*b))
			}
		}
	}
	if len(contributions) >= MinScoreMembers {
		var sum float64
		for _, c := range contributions {
			sum += c
		}
		score := int(math.Floor(sum/float64(len(contributions)) + 0.5))
		v.SquadScore = &score
	}
	v.WeeklyProgress.Done, v.WeeklyProgress.Goal = done, sq.WeeklyGoal
	v.RibbonThisWeek = done >= sq.WeeklyGoal
	return v, nil
}

// ---- Share cards (§10, API-57) --------------------------------------------------------------

// ShareCardCreate is the create input. It has no score field: numbers on a card are always
// recomputed from server data. DecodeShareCardCreate rejects any extra field.
type ShareCardCreate struct {
	Kind        string `json:"kind"`         // nazar_score | rank | badge
	Display     string `json:"display"`      // initials | first_name
	DisplayText string `json:"display_text"` // the user's own choice
	BadgeID     string `json:"badge_id,omitempty"`
	KeralaLine  bool   `json:"kerala_line"`
}

// DecodeShareCardCreate decodes a create body strictly (a client-supplied score is refused).
func DecodeShareCardCreate(raw []byte) (*ShareCardCreate, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var in ShareCardCreate
	if err := dec.Decode(&in); err != nil {
		if strings.Contains(err.Error(), "unknown field") {
			return nil, ErrUnknownField
		}
		return nil, &ValidationError{"/", "invalid_json"}
	}
	return &in, nil
}

// ShareCard is game.share_cards.
type ShareCard struct {
	ShortID     string
	Subject     Subject
	Kind        string
	Display     string
	DisplayText string
	BadgeID     string
	KeralaLine  bool
	CreatedAt   time.Time
	ExpiresAt   time.Time
	WithdrawnAt *time.Time
}

// ShareCardData is the public JSON the web app renders the OG image from (GET
// /v1/share-cards/{kind}/{id}). No PII, RTO, dates, LL/DL status, failures or calibration.
type ShareCardData struct {
	ShortID          string `json:"short_id"`
	Kind             string `json:"kind"`
	DisplayName      string `json:"display_name"`
	NazarScore       *int   `json:"nazar_score,omitempty"`
	VerifiedSessions int    `json:"counted_sessions"`
	Rank             string `json:"rank"`
	Badge            string `json:"badge,omitempty"`
	TaglineKey       string `json:"tagline_key"`
	ChallengeKey     string `json:"challenge_key"`
	KeralaLineKey    string `json:"kerala_line_key,omitempty"`
	FooterKey        string `json:"footer_key"`
}

var (
	initialsRe  = regexp.MustCompile(`^\p{L}{1,3}$`)
	firstNameRe = regexp.MustCompile(`^\p{L}[\p{L}' -]{0,19}$`)
)

// CreateShareCard creates a card. A minor's profile needs the parent's "share_cards" extra
// consent. Creating or sharing earns no XP and unlocks nothing.
func (s *Service) CreateShareCard(ctx context.Context, subj Subject, in ShareCardCreate) (*ShareCard, error) {
	if err := s.requireSocial(ctx, subj, "share_cards"); err != nil {
		return nil, err
	}
	switch in.Kind {
	case "nazar_score", "rank", "badge":
	default:
		return nil, &ValidationError{"/kind", "invalid_enum"}
	}
	text := strings.TrimSpace(in.DisplayText)
	switch in.Display {
	case "initials":
		if !initialsRe.MatchString(text) {
			return nil, &ValidationError{"/display_text", "invalid_initials"}
		}
	case "first_name":
		if !firstNameRe.MatchString(text) {
			return nil, &ValidationError{"/display_text", "invalid_first_name"}
		}
	default:
		return nil, &ValidationError{"/display", "invalid_enum"}
	}
	if len(privacy.Detect(text)) > 0 {
		return nil, &ValidationError{"/display_text", "PROHIBITED_FIELD"}
	}
	if _, ok := BadgeNames[in.BadgeID]; in.BadgeID != "" && !ok { // game.share_cards badge_id CHECK (B1..B9)
		return nil, &ValidationError{"/badge_id", "invalid_enum"}
	}
	switch in.Kind {
	case "nazar_score":
		if s.Nazar == nil {
			return nil, ErrNothingToShare
		}
		score, _, err := s.Nazar.NazarScore(ctx, subj)
		if err != nil {
			return nil, err
		}
		if score == nil {
			return nil, ErrNothingToShare
		}
	case "badge":
		p, err := s.progress(ctx, subj)
		if err != nil {
			return nil, err
		}
		if _, ok := p.Badges[in.BadgeID]; !ok {
			return nil, ErrNothingToShare
		}
	}
	now := s.now()
	c := &ShareCard{ShortID: s.tokens().Token(shortIDAlphabet, 10), Subject: subj, Kind: in.Kind, Display: in.Display, DisplayText: text,
		BadgeID: in.BadgeID, KeralaLine: in.KeralaLine && in.Kind == "nazar_score", CreatedAt: now, ExpiresAt: now.Add(ShareCardTTL)}
	if err := s.Store.InsertShareCard(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

// ShareCardData returns the public card, recomputed from current server data every time. A
// withdrawn or expired card is gone (410 for API-57).
func (s *Service) ShareCardData(ctx context.Context, shortID string) (*ShareCardData, error) {
	c, err := s.Store.GetShareCard(ctx, shortID)
	if err != nil {
		return nil, err
	}
	if c.WithdrawnAt != nil || !s.now().Before(c.ExpiresAt) {
		return nil, ErrGone
	}
	p, err := s.progress(ctx, c.Subject)
	if err != nil {
		return nil, err
	}
	rank := p.Rank
	if rank == "" {
		rank = "R1"
	}
	d := &ShareCardData{ShortID: c.ShortID, Kind: c.Kind, DisplayName: c.DisplayText, Rank: RankNames[rank],
		TaglineKey: "share.tagline_anticipation_not_speed", ChallengeKey: "share.challenge_same_clips",
		FooterKey: "share.footer_practice_not_licence_independent"}
	if s.Nazar != nil {
		score, n, err := s.Nazar.NazarScore(ctx, c.Subject)
		if err != nil {
			return nil, err
		}
		if score != nil {
			v := int(math.Floor(*score + 0.5))
			d.NazarScore, d.VerifiedSessions = &v, n
		}
	}
	if c.Kind == "nazar_score" && d.NazarScore == nil {
		return nil, ErrGone
	}
	if c.BadgeID != "" {
		if _, ok := p.Badges[c.BadgeID]; ok {
			d.Badge = BadgeNames[c.BadgeID]
		} else if c.Kind == "badge" {
			return nil, ErrGone // the badge was revoked (a withdrawn self-declaration)
		}
	}
	if c.KeralaLine {
		d.KeralaLineKey = "share.kerala_announced_pass_mark_60"
	}
	return d, nil
}

// WithdrawShareCard deletes a card for everyone (the link answers 410).
func (s *Service) WithdrawShareCard(ctx context.Context, subj Subject, shortID string) error {
	c, err := s.Store.GetShareCard(ctx, shortID)
	if err != nil {
		return err
	}
	if c.Subject.Key() != subj.Key() {
		return ErrNotFound
	}
	if c.WithdrawnAt != nil {
		return nil
	}
	now := s.now()
	c.WithdrawnAt = &now
	return s.Store.UpdateShareCard(ctx, c)
}

// ---- Declarations (API-44) ------------------------------------------------------------------

// KhudLicenceInput is the self-declaration (always rendered as self-declared, "Your word").
type KhudLicenceInput struct {
	CaseID           string
	DLIssuedOn       time.Time // a calendar date
	NoAgentUsed      bool      // must be true
	FirstAttemptPass bool
}

// DeclareKhudLicence stores the declaration and refreshes badges B1/B2 through the compute
// service. It needs an account (no anonymous claims). It earns no XP. If the compute service is
// down the declaration is kept and the badges follow on the next evaluation.
func (s *Service) DeclareKhudLicence(ctx context.Context, subj Subject, in KhudLicenceInput) (*Achievements, error) {
	if !subj.Account {
		return nil, ErrAccountRequired
	}
	if !in.NoAgentUsed {
		return nil, &ValidationError{"/no_agent_used", "must_be_true"}
	}
	if in.CaseID != "" { // records.declarations.case_id is a uuid: only a wire cas_... id fits
		if _, err := ids.Decode(ids.Case, in.CaseID); err != nil {
			return nil, &ValidationError{"/case_id", "invalid"}
		}
	}
	today := servertime.TodayIST(s.now())
	day := time.Date(in.DLIssuedOn.Year(), in.DLIssuedOn.Month(), in.DLIssuedOn.Day(), 0, 0, 0, 0, servertime.IST)
	if day.After(today) || day.Year() < 1990 {
		return nil, &ValidationError{"/dl_issued_on", "implausible_date"}
	}
	d := &Declaration{CaseID: in.CaseID, DLIssuedOn: day.Format(time.DateOnly), NoAgentUsed: true, FirstAttemptPass: in.FirstAttemptPass, DeclaredAt: s.now()}
	if err := s.Store.SaveDeclaration(ctx, subj, d); err != nil {
		return nil, err
	}
	if _, err := s.evaluate(ctx, subj, activity{}); err != nil && !IsUnavailable(err) { // also the node or Nazar sources down
		return nil, err
	}
	return s.Achievements(ctx, subj)
}

// WithdrawDeclaration removes the declaration; its badges disappear silently.
func (s *Service) WithdrawDeclaration(ctx context.Context, subj Subject) (*Achievements, error) {
	if err := s.Store.DeleteDeclaration(ctx, subj); err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if _, err := s.evaluate(ctx, subj, activity{}); err != nil && !IsUnavailable(err) { // also the node or Nazar sources down
		return nil, err
	}
	return s.Achievements(ctx, subj)
}
