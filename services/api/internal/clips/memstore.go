package clips

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
)

// MemStore is an in-memory Store: the reference semantics for internal/store/clips.go and the
// fake used by tests. Records are deep-copied in and out, so callers cannot mutate stored state.
type MemStore struct {
	mu        sync.Mutex
	counters  map[string]int
	clips     map[string]*Clip // key id@v
	ratings   map[string][]*Rating
	audits    map[string][]*BlurAudit
	deletions map[string]*RawDeletion
	manifests []*Manifest
	// Writes counts mutating calls (tests assert "nothing stored").
	Writes int
}

// NewMemStore returns an empty store.
func NewMemStore() *MemStore {
	return &MemStore{counters: map[string]int{}, clips: map[string]*Clip{}, ratings: map[string][]*Rating{},
		audits: map[string][]*BlurAudit{}, deletions: map[string]*RawDeletion{}}
}

func key(id string, v int) string { return fmt.Sprintf("%s@%d", id, v) }

func deepCopy[T any](in *T) *T {
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

// NextClipNumber implements Store.
func (m *MemStore) NextClipNumber(_ context.Context, prefix string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Writes++
	m.counters[prefix]++
	return m.counters[prefix], nil
}

// InsertClip implements Store.
func (m *MemStore) InsertClip(_ context.Context, c *Clip) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(c.ClipID, c.Version)
	if _, ok := m.clips[k]; ok {
		return fmt.Errorf("clips: %s already exists", k)
	}
	for _, o := range m.clips {
		if c.GenerationKey != "" && o.GenerationKey == c.GenerationKey {
			return fmt.Errorf("clips: generation %s already registered", c.GenerationKey)
		}
	}
	m.Writes++
	m.clips[k] = deepCopy(c)
	return nil
}

// GetClip implements Store.
func (m *MemStore) GetClip(_ context.Context, id string, v int) (*Clip, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if v == 0 {
		var best *Clip
		for _, c := range m.clips {
			if c.ClipID == id && (best == nil || c.Version > best.Version) {
				best = c
			}
		}
		if best == nil {
			return nil, ErrNotFound
		}
		return deepCopy(best), nil
	}
	c, ok := m.clips[key(id, v)]
	if !ok {
		return nil, ErrNotFound
	}
	return deepCopy(c), nil
}

// ClipByGenerationKey implements Store.
func (m *MemStore) ClipByGenerationKey(_ context.Context, k string) (*Clip, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, c := range m.clips {
		if k != "" && c.GenerationKey == k {
			return deepCopy(c), nil
		}
	}
	return nil, ErrNotFound
}

// UpdateClip implements Store.
func (m *MemStore) UpdateClip(_ context.Context, c *Clip) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(c.ClipID, c.Version)
	if _, ok := m.clips[k]; !ok {
		return ErrNotFound
	}
	m.Writes++
	m.clips[k] = deepCopy(c)
	return nil
}

// ListClips implements Store (sorted by clip ID, then version).
func (m *MemStore) ListClips(_ context.Context, f ListFilter) ([]*Clip, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Clip
	for _, c := range m.clips {
		if len(f.Status) > 0 {
			ok := false
			for _, s := range f.Status {
				ok = ok || c.Status == s
			}
			if !ok {
				continue
			}
		}
		if f.Tenant != "" && !hasTag(c.Doc.TenantTags, f.Tenant) {
			continue
		}
		out = append(out, deepCopy(c))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ClipID != out[j].ClipID {
			return out[i].ClipID < out[j].ClipID
		}
		return out[i].Version < out[j].Version
	})
	return out, nil
}

// UpsertRating implements Store (UNIQUE clip, version, rater).
func (m *MemStore) UpsertRating(_ context.Context, r *Rating) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Writes++
	k := key(r.ClipID, r.Version)
	for i, x := range m.ratings[k] {
		if x.Rater == r.Rater {
			m.ratings[k][i] = deepCopy(r)
			return nil
		}
	}
	m.ratings[k] = append(m.ratings[k], deepCopy(r))
	return nil
}

// Ratings implements Store (in save order).
func (m *MemStore) Ratings(_ context.Context, id string, v int) ([]*Rating, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Rating
	for _, r := range m.ratings[key(id, v)] {
		out = append(out, deepCopy(r))
	}
	return out, nil
}

// InsertBlurAudit implements Store.
func (m *MemStore) InsertBlurAudit(_ context.Context, a *BlurAudit) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Writes++
	k := key(a.ClipID, a.Version)
	m.audits[k] = append(m.audits[k], deepCopy(a))
	return nil
}

// LatestBlurAudit implements Store.
func (m *MemStore) LatestBlurAudit(_ context.Context, id string, v int) (*BlurAudit, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	as := m.audits[key(id, v)]
	if len(as) == 0 {
		return nil, ErrNotFound
	}
	return deepCopy(as[len(as)-1]), nil
}

// InsertRawDeletion implements Store (one record per clip version).
func (m *MemStore) InsertRawDeletion(_ context.Context, d *RawDeletion) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(d.ClipID, d.Version)
	if _, ok := m.deletions[k]; ok {
		return fmt.Errorf("clips: raw deletion for %s already logged", k)
	}
	m.Writes++
	m.deletions[k] = deepCopy(d)
	return nil
}

// RawDeletion implements Store.
func (m *MemStore) RawDeletion(_ context.Context, id string, v int) (*RawDeletion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.deletions[key(id, v)]
	if !ok {
		return nil, ErrNotFound
	}
	return deepCopy(d), nil
}

// SaveManifest implements Store.
func (m *MemStore) SaveManifest(_ context.Context, man *Manifest) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Writes++
	m.manifests = append(m.manifests, deepCopy(man))
	return nil
}

// LatestManifest implements Store.
func (m *MemStore) LatestManifest(context.Context) (*Manifest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.manifests) == 0 {
		return nil, ErrNotFound
	}
	return deepCopy(m.manifests[len(m.manifests)-1]), nil
}
