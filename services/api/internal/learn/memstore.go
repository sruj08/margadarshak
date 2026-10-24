package learn

import (
	"context"
	"encoding/json"
	"sync"
)

// MemStore is an in-memory Store (reference semantics and test fake).
type MemStore struct {
	mu        sync.Mutex
	answers   map[string]map[string]*StoredAnswer // subject → client_answer_id
	order     map[string][]string                 // subject → insertion order of answers
	logs      map[string][]LogRow
	cards     map[string][]json.RawMessage
	snapshots map[string]*Snapshot
}

// NewMemStore returns an empty store.
func NewMemStore() *MemStore {
	return &MemStore{answers: map[string]map[string]*StoredAnswer{}, order: map[string][]string{}, logs: map[string][]LogRow{},
		cards: map[string][]json.RawMessage{}, snapshots: map[string]*Snapshot{}}
}

// AnswersByClientID implements Store.
func (m *MemStore) AnswersByClientID(_ context.Context, subj Subject, ids []string) (map[string]*StoredAnswer, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]*StoredAnswer{}
	for _, id := range ids {
		if a, ok := m.answers[subj.Key()][id]; ok {
			c := *a
			out[id] = &c
		}
	}
	return out, nil
}

// SaveAnswers implements Store.
func (m *MemStore) SaveAnswers(_ context.Context, subj Subject, answers []*StoredAnswer, logs map[string]LogRow, cards []json.RawMessage) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := subj.Key()
	if m.answers[k] == nil {
		m.answers[k] = map[string]*StoredAnswer{}
	}
	var ins []string
	for _, a := range answers {
		if _, ok := m.answers[k][a.ClientAnswerID]; ok {
			continue
		}
		c := *a
		m.answers[k][a.ClientAnswerID] = &c
		m.order[k] = append(m.order[k], a.ClientAnswerID)
		if l, ok := logs[a.ClientAnswerID]; ok {
			m.logs[k] = append(m.logs[k], l)
		}
		ins = append(ins, a.ClientAnswerID)
	}
	m.cards[k] = cards
	return ins, nil
}

// AppendLog implements Store.
func (m *MemStore) AppendLog(_ context.Context, subj Subject, rows []LogRow) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := subj.Key()
	n := 0
	for _, r := range rows {
		dup := false
		for _, x := range m.logs[k] {
			if x.SourceKind == r.SourceKind && x.SourceID == r.SourceID && x.CardID == r.CardID {
				dup = true
				break
			}
		}
		if !dup {
			m.logs[k] = append(m.logs[k], r)
			n++
		}
	}
	return n, nil
}

// ReviewLog implements Store.
func (m *MemStore) ReviewLog(_ context.Context, subj Subject) ([]LogRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]LogRow{}, m.logs[subj.Key()]...), nil
}

// LogCount implements Store.
func (m *MemStore) LogCount(_ context.Context, subj Subject) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.logs[subj.Key()]), nil
}

// RecentRatedAnswers implements Store.
func (m *MemStore) RecentRatedAnswers(_ context.Context, subj Subject, n int) ([]RatedAnswer, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []RatedAnswer
	for _, id := range m.order[subj.Key()] {
		a := m.answers[subj.Key()][id]
		if a.Confidence != "" {
			out = append(out, RatedAnswer{Correct: a.Correct, Confidence: a.Confidence})
		}
	}
	if len(out) > n {
		out = out[len(out)-n:]
	}
	return out, nil
}

// LatestSnapshot implements Store.
func (m *MemStore) LatestSnapshot(_ context.Context, subj Subject) (*Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snapshots[subj.Key()]
	if !ok {
		return nil, ErrNotFound
	}
	c := *s
	return &c, nil
}

// SaveSnapshot implements Store.
func (m *MemStore) SaveSnapshot(_ context.Context, subj Subject, s *Snapshot) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := *s
	m.snapshots[subj.Key()] = &c
	return nil
}
