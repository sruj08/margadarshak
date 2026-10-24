package ai

import (
	"errors"
	"sync"
	"time"
)

// ErrCircuitOpen is returned without calling the model while the breaker is open (AGENTS.md §6):
// callers serve the template, so an outage costs no latency (EC-29).
var ErrCircuitOpen = errors.New("ai: circuit open")

// Breaker opens after threshold consecutive failures, stays open for cooldown, then lets one
// probe through (half-open); a success closes it, a failure re-opens it.
type Breaker struct {
	mu        sync.Mutex
	threshold int
	cooldown  time.Duration
	failures  int
	openUntil time.Time
	probing   bool
	now       func() time.Time
}

// NewBreaker is a breaker with the AGENTS.md §6 settings: 3 failures, 30 s open.
func NewBreaker() *Breaker {
	return &Breaker{threshold: 3, cooldown: 30 * time.Second, now: time.Now}
}

// Allow reports whether a call may go to the model.
func (b *Breaker) Allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.failures < b.threshold {
		return true
	}
	if b.now().Before(b.openUntil) || b.probing {
		return false
	}
	b.probing = true
	return true
}

// Record reports the outcome of a call that Allow let through.
func (b *Breaker) Record(ok bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.probing = false
	if ok {
		b.failures = 0
		return
	}
	b.failures++
	if b.failures >= b.threshold {
		b.openUntil = b.now().Add(b.cooldown)
	}
}

// Open reports whether the breaker is refusing calls (for /v1/ai/status and the voice fallback).
func (b *Breaker) Open() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.failures >= b.threshold && b.now().Before(b.openUntil)
}
