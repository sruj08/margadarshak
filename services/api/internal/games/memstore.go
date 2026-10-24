package games

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MemStore is an in-memory Store with copy-on-read/write, like a database: the reference
// semantics for internal/store/games.go (GamesStore) and the test fake. The tx argument is
// ignored. Sessions are ordered by insertion (the store orders by started_at, then the UUIDv7
// session ID, which is the same order for sessions started one after another).
type MemStore struct {
	mu        sync.Mutex
	sessions  map[uuid.UUID]*Session
	order     []uuid.UUID
	exposures map[string]map[string]exposureRow // subject → clipID → row
	counters  map[string]int64
	calls     []string
}

var _ Store = (*MemStore)(nil)

// NewMemStore returns an empty MemStore.
func NewMemStore() *MemStore {
	return &MemStore{sessions: map[uuid.UUID]*Session{}, exposures: map[string]map[string]exposureRow{}, counters: map[string]int64{}}
}

func subjKey(s Subject) string {
	m := ""
	if s.MemberID != nil {
		m = s.MemberID.String()
	}
	return s.Tenant + "/" + s.ApplicantID.String() + "/" + m
}

type exposureRow struct {
	Exposure
	subject string
}

func cloneSession(s *Session) *Session {
	c := *s
	c.Items = slices.Clone(s.Items)
	c.Flags = slices.Clone(s.Flags)
	c.Eligible = maps.Clone(s.Eligible)
	if s.Replay != nil {
		r := *s.Replay
		c.Replay = &r
	}
	return &c
}

// Counter returns the value of an ops counter bumped through IncrementCounter.
func (m *MemStore) Counter(tenant, name string) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.counters[tenant+"/"+name]
}

// InsertSession stores a new session; a duplicate ID is an error.
func (m *MemStore) InsertSession(_ context.Context, _ pgx.Tx, s *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sessions[s.ID]; ok {
		return fmt.Errorf("duplicate session")
	}
	m.sessions[s.ID] = cloneSession(s)
	m.order = append(m.order, s.ID)
	return nil
}

// InsertSessionItems sets the items of a stored session.
func (m *MemStore) InsertSessionItems(_ context.Context, _ pgx.Tx, id uuid.UUID, items []Item) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[id].Items = slices.Clone(items)
	return nil
}

// GetSessionForUpdate returns a copy of the session, or ErrNotFound.
func (m *MemStore) GetSessionForUpdate(_ context.Context, _ pgx.Tx, id uuid.UUID) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, ErrNotFound
	}
	return cloneSession(s), nil
}

func (m *MemStore) put(s *Session, call string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[s.ID] = cloneSession(s)
	m.calls = append(m.calls, call)
	return nil
}

// CompleteSession overwrites the session with its verified outcome.
func (m *MemStore) CompleteSession(_ context.Context, _ pgx.Tx, s *Session) error {
	return m.put(s, "complete")
}

// MarkPending overwrites the session with its pending submission.
func (m *MemStore) MarkPending(_ context.Context, _ pgx.Tx, s *Session) error {
	return m.put(s, "pending")
}

// VoidSession overwrites the session with its voided outcome.
func (m *MemStore) VoidSession(_ context.Context, _ pgx.Tx, s *Session) error {
	return m.put(s, "void")
}

// ListPending returns up to limit pending sessions of every tenant, oldest submission first.
func (m *MemStore) ListPending(_ context.Context, _ pgx.Tx, limit int) ([]*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Session
	for _, id := range m.order {
		if s := m.sessions[id]; s.Status == StatusPendingVerification {
			out = append(out, cloneSession(s))
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].SubmittedAt.Before(*out[j].SubmittedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// SeenClipIDs returns the subject's exposed clip IDs, sorted.
func (m *MemStore) SeenClipIDs(_ context.Context, _ pgx.Tx, subj Subject) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for id := range m.exposures[subjKey(subj)] {
		out = append(out, id)
	}
	sort.Strings(out)
	return out, nil
}

// ClipsSeenBefore returns, in the order of ids, those first seen strictly before t.
func (m *MemStore) ClipsSeenBefore(_ context.Context, _ pgx.Tx, subj Subject, ids []string, t time.Time) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for _, id := range ids {
		if row, ok := m.exposures[subjKey(subj)][id]; ok && row.At.Before(t) {
			out = append(out, id)
		}
	}
	return out, nil
}

// RecordExposures inserts exposures; the first exposure of a clip wins.
func (m *MemStore) RecordExposures(_ context.Context, _ pgx.Tx, subj Subject, ex []Exposure) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := subjKey(subj)
	if m.exposures[k] == nil {
		m.exposures[k] = map[string]exposureRow{}
	}
	for _, e := range ex {
		if _, ok := m.exposures[k][e.ClipID]; !ok {
			m.exposures[k][e.ClipID] = exposureRow{Exposure: e, subject: k}
		}
	}
	return nil
}

// RecentItemRefs walks the subject's sessions of gameID newest first and appends every item ref
// of each, stopping before the next session once limit refs are collected (the last session is
// included whole, so the result can exceed limit).
func (m *MemStore) RecentItemRefs(_ context.Context, _ pgx.Tx, subj Subject, gameID string, limit int) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for i := len(m.order) - 1; i >= 0 && len(out) < limit; i-- {
		s := m.sessions[m.order[i]]
		if s.GameID == gameID && s.Subject.Same(subj) {
			for _, it := range s.Items {
				out = append(out, it.Ref)
			}
		}
	}
	return out, nil
}

// EligibleMocks returns the server percentages of the subject's last n checked sessions whose
// eligibility nazar_score is true, newest verified first.
func (m *MemStore) EligibleMocks(_ context.Context, _ pgx.Tx, subj Subject, n int) ([]float64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var rows []*Session
	for _, s := range m.sessions {
		if s.Subject.Same(subj) && s.Status == StatusChecked && s.Eligible[EligibleNazarScore] && s.ServerPct != nil {
			rows = append(rows, s)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].VerifiedAt.After(*rows[j].VerifiedAt) })
	var out []float64
	for _, s := range rows {
		if len(out) == n {
			break
		}
		out = append(out, *s.ServerPct)
	}
	return out, nil
}

// IncrementCounter bumps an ops counter.
func (m *MemStore) IncrementCounter(_ context.Context, _ pgx.Tx, tenant, name string, by int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.counters[tenant+"/"+name] += by
	return nil
}

// Staircase levels (GAME_SDK §7).
const (
	StaircaseMin = 1
	StaircaseMax = 5
)

// StaircaseStep applies one item outcome to a staircase state (game-core learning/staircase.ts):
// two consecutive passes step up, one fail steps down, floored at 1 and capped at 5.
func StaircaseStep(level, streakPass int, passed bool) (newLevel, newStreak int) {
	if !passed {
		return max(StaircaseMin, level-1), 0
	}
	if streakPass+1 >= 2 {
		return min(StaircaseMax, level+1), 0
	}
	return level, streakPass + 1
}

// MemStaircase is an in-memory staircase (reference semantics for store.GamesStaircase).
type MemStaircase struct {
	mu    sync.Mutex
	state map[string][2]int // subject/game/skill → level, streak
}

var _ Staircase = (*MemStaircase)(nil)

// NewMemStaircase returns an empty staircase.
func NewMemStaircase() *MemStaircase { return &MemStaircase{state: map[string][2]int{}} }

func staircaseKey(subj Subject, gameID, skillID string) string {
	return subjKey(subj) + "|" + gameID + "|" + skillID
}

// Level returns the subject's level, 1 when nothing was recorded.
func (m *MemStaircase) Level(_ context.Context, _ pgx.Tx, subj Subject, gameID, skillID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if st, ok := m.state[staircaseKey(subj, gameID, skillID)]; ok {
		return st[0], nil
	}
	return StaircaseMin, nil
}

// Record applies one item outcome and returns the new level.
func (m *MemStaircase) Record(_ context.Context, _ pgx.Tx, subj Subject, gameID, skillID string, passed bool) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := staircaseKey(subj, gameID, skillID)
	st, ok := m.state[k]
	if !ok {
		st = [2]int{StaircaseMin, 0}
	}
	l, s := StaircaseStep(st[0], st[1], passed)
	m.state[k] = [2]int{l, s}
	return l, nil
}
