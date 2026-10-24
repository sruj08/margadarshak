package gamify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"

	"github.com/google/uuid"
)

// MemStore is an in-memory Store with the database's guarantees: the xp_ledger reason CHECK,
// UNIQUE (subject, reason, source_id), and the squad member-cap trigger.
type MemStore struct {
	mu           sync.Mutex
	ledger       map[string][]*XPEntry
	progress     map[string]*Progress
	declarations map[string]*Declaration
	squads       map[uuid.UUID]*Squad
	cards        map[string]*ShareCard
}

// NewMemStore returns an empty store.
func NewMemStore() *MemStore {
	return &MemStore{ledger: map[string][]*XPEntry{}, progress: map[string]*Progress{}, declarations: map[string]*Declaration{},
		squads: map[uuid.UUID]*Squad{}, cards: map[string]*ShareCard{}}
}

func clone[T any](in *T) *T {
	raw, err := json.Marshal(in)
	if err != nil {
		panic(err)
	}
	out := new(T)
	if err := json.Unmarshal(raw, out); err != nil {
		panic(err)
	}
	return out
}

// Ledger returns a copy of the subject's ledger (tests).
func (m *MemStore) Ledger(subj Subject) []XPEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []XPEntry
	for _, e := range m.ledger[subj.Key()] {
		out = append(out, *e)
	}
	return out
}

// AppendXP implements Store.
func (m *MemStore) AppendXP(_ context.Context, subj Subject, e *XPEntry) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !AllowedReasons[e.Reason] { // game.xp_ledger reason CHECK
		return false, fmt.Errorf("%w: %q (check constraint)", ErrXPReasonNotAllowed, e.Reason)
	}
	for _, x := range m.ledger[subj.Key()] {
		if x.Reason == e.Reason && x.SourceID == e.SourceID {
			return false, nil
		}
	}
	m.ledger[subj.Key()] = append(m.ledger[subj.Key()], clone(e))
	return true, nil
}

// XPEntryBySource implements Store.
func (m *MemStore) XPEntryBySource(_ context.Context, subj Subject, reason XPReason, sourceID string) (*XPEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, x := range m.ledger[subj.Key()] {
		if x.Reason == reason && x.SourceID == sourceID {
			return clone(x), nil
		}
	}
	return nil, ErrNotFound
}

// MinutesOn implements Store.
func (m *MemStore) MinutesOn(_ context.Context, subj Subject, day string) (float64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var s float64
	for _, x := range m.ledger[subj.Key()] {
		if x.ISTDay == day {
			s += x.Minutes
		}
	}
	return s, nil
}

// XPOn implements Store.
func (m *MemStore) XPOn(_ context.Context, subj Subject, day string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := 0
	for _, x := range m.ledger[subj.Key()] {
		if x.ISTDay == day {
			s += x.XP
		}
	}
	return s, nil
}

// WeekCounts implements Store.
func (m *MemStore) WeekCounts(_ context.Context, subj Subject) (map[string]int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]int{}
	for _, x := range m.ledger[subj.Key()] {
		if x.CountsForStreak {
			out[x.WeekKey]++
		}
	}
	return out, nil
}

// SeedWeek adds n streak-counting session entries in week (tests: history before "now").
func (m *MemStore) SeedWeek(subj Subject, week string, n int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := 0; i < n; i++ {
		m.ledger[subj.Key()] = append(m.ledger[subj.Key()], &XPEntry{ID: uuid.New(), Reason: ReasonSession,
			SourceID: fmt.Sprintf("seed-%s-%d", week, i), WeekKey: week, CountsForStreak: true})
	}
}

// GetProgress implements Store.
func (m *MemStore) GetProgress(_ context.Context, subj Subject) (*Progress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.progress[subj.Key()]
	if !ok {
		return nil, ErrNotFound
	}
	return clone(p), nil
}

// SaveProgress implements Store.
func (m *MemStore) SaveProgress(_ context.Context, subj Subject, p *Progress) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.progress[subj.Key()] = clone(p)
	return nil
}

// GetDeclaration implements Store.
func (m *MemStore) GetDeclaration(_ context.Context, subj Subject) (*Declaration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.declarations[subj.Key()]
	if !ok {
		return nil, ErrNotFound
	}
	return clone(d), nil
}

// SaveDeclaration implements Store.
func (m *MemStore) SaveDeclaration(_ context.Context, subj Subject, d *Declaration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.declarations[subj.Key()] = clone(d)
	return nil
}

// DeleteDeclaration implements Store.
func (m *MemStore) DeleteDeclaration(_ context.Context, subj Subject) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.declarations[subj.Key()]; !ok {
		return ErrNotFound
	}
	delete(m.declarations, subj.Key())
	return nil
}

// InsertSquad implements Store.
func (m *MemStore) InsertSquad(_ context.Context, s *Squad) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(s.Members) > MaxSquadMembers {
		return ErrSquadFull
	}
	m.squads[s.ID] = clone(s)
	return nil
}

// GetSquad implements Store.
func (m *MemStore) GetSquad(_ context.Context, id uuid.UUID) (*Squad, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.squads[id]
	if !ok {
		return nil, ErrNotFound
	}
	return clone(s), nil
}

// SquadByInviteHash implements Store.
func (m *MemStore) SquadByInviteHash(_ context.Context, hash []byte) (*Squad, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.squads {
		if bytes.Equal(s.InviteCodeHash, hash) {
			return clone(s), nil
		}
	}
	return nil, ErrNotFound
}

// UpdateSquad implements Store (the member-cap trigger).
func (m *MemStore) UpdateSquad(_ context.Context, s *Squad) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.squads[s.ID]; !ok {
		return ErrNotFound
	}
	if len(s.Members) > MaxSquadMembers {
		return ErrSquadFull
	}
	m.squads[s.ID] = clone(s)
	return nil
}

// SquadsOf implements Store.
func (m *MemStore) SquadsOf(_ context.Context, subj Subject) ([]*Squad, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Squad
	for _, s := range m.squads {
		for _, mem := range s.Members {
			if mem.Subject.Key() == subj.Key() {
				out = append(out, clone(s))
				break
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

// InsertShareCard implements Store.
func (m *MemStore) InsertShareCard(_ context.Context, c *ShareCard) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cards[c.ShortID] = clone(c)
	return nil
}

// GetShareCard implements Store.
func (m *MemStore) GetShareCard(_ context.Context, id string) (*ShareCard, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.cards[id]
	if !ok {
		return nil, ErrNotFound
	}
	return clone(c), nil
}

// UpdateShareCard implements Store.
func (m *MemStore) UpdateShareCard(_ context.Context, c *ShareCard) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.cards[c.ShortID]; !ok {
		return ErrNotFound
	}
	m.cards[c.ShortID] = clone(c)
	return nil
}
