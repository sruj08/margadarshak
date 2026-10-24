package study

import (
	"context"
	"sort"
	"sync"

	"github.com/google/uuid"
)

// MemStore is an in-memory Store (reference semantics and test fake). Writes and Reads count
// calls so tests can assert that declining consent touches nothing.
type MemStore struct {
	mu           sync.Mutex
	seq          map[string]int
	participants map[string]*Participant // tenant/code
	sessions     map[string][]*Session
	blocks       map[string]*Blocks
	Stats        map[string][]*PublicStats
	Writes       int
	Reads        int
}

// NewMemStore returns an empty store.
func NewMemStore() *MemStore {
	return &MemStore{seq: map[string]int{}, participants: map[string]*Participant{}, sessions: map[string][]*Session{},
		blocks: map[string]*Blocks{}, Stats: map[string][]*PublicStats{}}
}

func cp(p *Participant) *Participant { c := *p; return &c }

// NextSeq implements Store.
func (m *MemStore) NextSeq(_ context.Context, tenant string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Writes++
	m.seq[tenant]++
	return m.seq[tenant], nil
}

// InsertParticipant implements Store.
func (m *MemStore) InsertParticipant(_ context.Context, p *Participant) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Writes++
	m.participants[p.Tenant+"/"+p.Code] = cp(p)
	return nil
}

// UpdateParticipant implements Store.
func (m *MemStore) UpdateParticipant(_ context.Context, p *Participant) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.participants[p.Tenant+"/"+p.Code]; !ok {
		return ErrNotFound
	}
	m.Writes++
	m.participants[p.Tenant+"/"+p.Code] = cp(p)
	return nil
}

// GetParticipant implements Store.
func (m *MemStore) GetParticipant(_ context.Context, tenant, code string) (*Participant, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Reads++
	p, ok := m.participants[tenant+"/"+code]
	if !ok {
		return nil, ErrNotFound
	}
	return cp(p), nil
}

// ParticipantsByApplicant implements Store.
func (m *MemStore) ParticipantsByApplicant(_ context.Context, tenant string, applicant uuid.UUID) ([]*Participant, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Reads++
	var out []*Participant
	for _, p := range m.participants {
		if p.Tenant == tenant && p.ApplicantID == applicant {
			out = append(out, cp(p))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Seq < out[j].Seq })
	return out, nil
}

// Participants implements Store.
func (m *MemStore) Participants(_ context.Context, tenant string) ([]*Participant, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Reads++
	var out []*Participant
	for _, p := range m.participants {
		if p.Tenant == tenant {
			out = append(out, cp(p))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Seq < out[j].Seq })
	return out, nil
}

// AddSession stores a verified study session (written by the games package's StudyHook).
func (m *MemStore) AddSession(tenant string, s *Session) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Writes++
	m.sessions[tenant] = append(m.sessions[tenant], s)
}

// Sessions implements Store.
func (m *MemStore) Sessions(_ context.Context, tenant string) ([]*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Reads++
	return append([]*Session{}, m.sessions[tenant]...), nil
}

// SetBlocks configures the form blocks.
func (m *MemStore) SetBlocks(tenant string, b *Blocks) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.blocks[tenant] = b
}

// FormBlocks implements Store.
func (m *MemStore) FormBlocks(_ context.Context, tenant string) (*Blocks, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Reads++
	b, ok := m.blocks[tenant]
	if !ok {
		return nil, ErrNotFound
	}
	return b, nil
}

// SavePublicStats implements Store.
func (m *MemStore) SavePublicStats(_ context.Context, tenant string, s *PublicStats) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Writes++
	m.Stats[tenant] = append(m.Stats[tenant], s)
	return nil
}
