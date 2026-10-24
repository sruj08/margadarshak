// Package tenant resolves the E-31 tenant (State/UT) for a request (MD-056, F-58). Hackathon:
// a single tenant, JK; the model is multi-tenant ready (one row + rule pack + adapter config per
// state). Resolution: the X-Tenant header, which must be a known tenant and, when the tenant
// lists hosts, match the request host; otherwise the configured default tenant.
package tenant

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/adapters"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// ErrUnknown is returned for a tenant code that does not exist.
var ErrUnknown = errors.New("tenant: unknown tenant")

// ErrHostMismatch is returned when X-Tenant is not served on the request host.
var ErrHostMismatch = errors.New("tenant: tenant not served on this host")

// Tenant is the resolved tenant with its adapter set.
type Tenant struct {
	store.TenantRow
	Adapters adapters.Set
	RulePack ports.RulePackRef
}

// Feature reports whether a feature flag is on.
func (t *Tenant) Feature(name string) bool { return t.Features[name] }

// Service loads and caches tenants.
type Service struct {
	DB       *store.DB
	Registry *adapters.Registry
	Rules    ports.RulesPort // optional; overrides the rule-pack columns when set
	Default  string
	TTL      time.Duration

	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	t   *Tenant
	exp time.Time
}

// Get returns a tenant by code.
func (s *Service) Get(ctx context.Context, code string) (*Tenant, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	s.mu.Lock()
	if s.cache == nil {
		s.cache = map[string]cached{}
	}
	if c, ok := s.cache[code]; ok && time.Now().Before(c.exp) {
		s.mu.Unlock()
		return c.t, nil
	}
	s.mu.Unlock()
	if len(code) != 2 {
		return nil, ErrUnknown
	}
	var row *store.TenantRow
	err := s.DB.Tenant(ctx, code, func(tx pgx.Tx) error {
		var err error
		row, err = store.GetTenant(ctx, tx, code)
		return err
	})
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrUnknown
	}
	if err != nil {
		return nil, err
	}
	set, err := s.Registry.For(row.Adapters)
	if err != nil {
		return nil, err
	}
	t := &Tenant{TenantRow: *row, Adapters: set, RulePack: ports.RulePackRef{PackID: row.RulePackID, Version: row.RulePackVersion}}
	if row.RulePackBaseVersion != nil {
		t.RulePack.BaseVersion = *row.RulePackBaseVersion
	}
	if s.Rules != nil {
		if ref, err := s.Rules.PackFor(ctx, code); err == nil && ref.Version != "" {
			t.RulePack = ref
		}
	}
	ttl := s.TTL
	if ttl == 0 {
		ttl = 30 * time.Second
	}
	s.mu.Lock()
	s.cache[code] = cached{t: t, exp: time.Now().Add(ttl)}
	s.mu.Unlock()
	return t, nil
}

// Resolve picks the tenant for a request from the X-Tenant header and host.
func (s *Service) Resolve(ctx context.Context, header, host string) (*Tenant, error) {
	code := header
	if code == "" {
		code = s.Default
	}
	t, err := s.Get(ctx, code)
	if err != nil {
		return nil, err
	}
	if header != "" && len(t.Hosts) > 0 && host != "" {
		h := strings.ToLower(host)
		if i := strings.LastIndex(h, ":"); i >= 0 && !strings.Contains(h[i:], "]") {
			h = h[:i]
		}
		ok := false
		for _, allowed := range t.Hosts {
			if strings.EqualFold(allowed, h) {
				ok = true
				break
			}
		}
		if !ok && !isLocal(h) {
			return nil, ErrHostMismatch
		}
	}
	return t, nil
}

func isLocal(h string) bool {
	return h == "localhost" || h == "127.0.0.1" || h == "::1" || strings.HasSuffix(h, ".test") || strings.HasSuffix(h, ".onrender.com")
}

// Invalidate drops cached tenants (after adapter config changes).
func (s *Service) Invalidate() {
	s.mu.Lock()
	s.cache = map[string]cached{}
	s.mu.Unlock()
}
