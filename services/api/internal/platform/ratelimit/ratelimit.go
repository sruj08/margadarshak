// Package ratelimit implements fixed-window counters for API rate limits (BACKEND §15,
// SECURITY_ARCHITECTURE §12): in-memory for a single instance (dev, tests, REDIS_URL empty) and
// Redis/Valkey when REDIS_URL is set, so limits hold across instances. The same package backs
// the HMAC replay cache on Redis.
package ratelimit

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Decision is the outcome of one Allow call.
type Decision struct {
	Allowed    bool
	Limit      int
	Remaining  int
	RetryAfter time.Duration
	Reset      time.Duration
}

// Limiter counts hits per key in fixed windows.
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (Decision, error)
}

// Memory is an in-process limiter.
type Memory struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	now     func() time.Time
	sweeps  int
}

type bucket struct {
	start time.Time
	count int
	win   time.Duration
}

// NewMemory returns an in-memory limiter.
func NewMemory() *Memory { return &Memory{buckets: map[string]*bucket{}, now: time.Now} }

// Allow implements Limiter.
func (m *Memory) Allow(_ context.Context, key string, limit int, window time.Duration) (Decision, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.sweeps++
	if m.sweeps%1024 == 0 {
		for k, b := range m.buckets {
			if now.Sub(b.start) > b.win {
				delete(m.buckets, k)
			}
		}
	}
	b, ok := m.buckets[key]
	if !ok || now.Sub(b.start) >= window {
		b = &bucket{start: now, win: window}
		m.buckets[key] = b
	}
	reset := window - now.Sub(b.start)
	if b.count >= limit {
		return Decision{Allowed: false, Limit: limit, RetryAfter: reset, Reset: reset}, nil
	}
	b.count++
	return Decision{Allowed: true, Limit: limit, Remaining: limit - b.count, Reset: reset}, nil
}

// Redis is a Redis/Valkey-backed limiter (INCR + PEXPIRE per window).
type Redis struct {
	Client *redis.Client
	Prefix string
}

// NewRedis connects to url (redis://host:port/db).
func NewRedis(url string) (*Redis, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return &Redis{Client: redis.NewClient(opt), Prefix: "md:rl:"}, nil
}

// Allow implements Limiter.
func (r *Redis) Allow(ctx context.Context, key string, limit int, window time.Duration) (Decision, error) {
	slot := time.Now().UnixMilli() / window.Milliseconds()
	k := r.Prefix + key + ":" + strconv.FormatInt(slot, 10)
	pipe := r.Client.TxPipeline()
	incr := pipe.Incr(ctx, k)
	pipe.PExpire(ctx, k, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return Decision{}, err
	}
	n := int(incr.Val())
	reset := time.Duration((slot+1)*window.Milliseconds()-time.Now().UnixMilli()) * time.Millisecond
	if n > limit {
		return Decision{Allowed: false, Limit: limit, RetryAfter: reset, Reset: reset}, nil
	}
	return Decision{Allowed: true, Limit: limit, Remaining: limit - n, Reset: reset}, nil
}

// Seen implements hmacsig.ReplayCache on Redis (SET NX with expiry).
func (r *Redis) Seen(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	ok, err := r.Client.SetNX(ctx, "md:replay:"+key, 1, ttl).Result()
	if err != nil {
		return false, err
	}
	return !ok, nil
}

// Ping checks the connection.
func (r *Redis) Ping(ctx context.Context) error { return r.Client.Ping(ctx).Err() }
