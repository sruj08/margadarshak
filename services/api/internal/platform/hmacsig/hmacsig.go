// Package hmacsig implements the Margdarshak-Signature scheme used on /internal/* (n8n, Render
// Workflows) and on signed payment callbacks (MD-041, MD-053):
//
//	Margdarshak-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>
//
// Verification enforces a timestamp window (default ±300 s) and rejects replays of the same
// signature through a ReplayCache.
package hmacsig

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Header is the signature header name.
const Header = "Margdarshak-Signature"

// Errors returned by Verify.
var (
	ErrMissing   = errors.New("hmacsig: signature missing")
	ErrMalformed = errors.New("hmacsig: signature malformed")
	ErrStale     = errors.New("hmacsig: timestamp outside the allowed window")
	ErrMismatch  = errors.New("hmacsig: signature mismatch")
	ErrReplay    = errors.New("hmacsig: replayed request")
)

// Sign returns the header value for body at time t.
func Sign(secret []byte, t time.Time, body []byte) string {
	ts := strconv.FormatInt(t.Unix(), 10)
	return "t=" + ts + ",v1=" + mac(secret, ts, body)
}

func mac(secret []byte, ts string, body []byte) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(ts))
	m.Write([]byte("."))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}

// ReplayCache remembers signatures already accepted. Seen returns true when key was already
// recorded (and records it otherwise).
type ReplayCache interface {
	Seen(ctx context.Context, key string, ttl time.Duration) (bool, error)
}

// Verifier checks signatures.
type Verifier struct {
	Secret []byte
	Window time.Duration
	Replay ReplayCache
	Now    func() time.Time
}

// Verify checks header against body. The replay cache is keyed on the signature alone; HTTP
// callers use VerifyRequest, which also keys on the method and path.
func (v *Verifier) Verify(ctx context.Context, header string, body []byte) error {
	return v.verify(ctx, "", header, body)
}

// VerifyRequest checks header against body and keys the replay cache on method + path (with the
// query) + signature. The signed string is t + "." + body, so two different calls signed in the
// same second (for example two GETs with empty bodies) carry the same signature: keying on the
// request line keeps them apart, while a replay of the same request is still rejected. Clients
// re-sign every retry with a fresh timestamp.
func (v *Verifier) VerifyRequest(ctx context.Context, method, pathAndQuery, header string, body []byte) error {
	return v.verify(ctx, method+" "+pathAndQuery+" ", header, body)
}

func (v *Verifier) verify(ctx context.Context, scope, header string, body []byte) error {
	if header == "" {
		return ErrMissing
	}
	var ts, sig string
	for _, part := range strings.Split(header, ",") {
		k, val, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			return ErrMalformed
		}
		switch k {
		case "t":
			ts = val
		case "v1":
			sig = val
		}
	}
	if ts == "" || sig == "" {
		return ErrMalformed
	}
	unix, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return ErrMalformed
	}
	window := v.Window
	if window == 0 {
		window = 5 * time.Minute
	}
	now := time.Now
	if v.Now != nil {
		now = v.Now
	}
	d := now().Sub(time.Unix(unix, 0))
	if d > window || d < -window {
		return ErrStale
	}
	want := mac(v.Secret, ts, body)
	if !hmac.Equal([]byte(want), []byte(strings.ToLower(sig))) {
		return ErrMismatch
	}
	if v.Replay != nil {
		seen, err := v.Replay.Seen(ctx, "sig:"+scope+strings.ToLower(sig), 2*window)
		if err != nil {
			return fmt.Errorf("hmacsig: replay cache: %w", err)
		}
		if seen {
			return ErrReplay
		}
	}
	return nil
}

// MemoryReplayCache is an in-process ReplayCache (single instance, tests).
type MemoryReplayCache struct {
	mu   sync.Mutex
	seen map[string]time.Time
}

// NewMemoryReplayCache returns an empty cache.
func NewMemoryReplayCache() *MemoryReplayCache {
	return &MemoryReplayCache{seen: map[string]time.Time{}}
}

// Seen implements ReplayCache.
func (c *MemoryReplayCache) Seen(_ context.Context, key string, ttl time.Duration) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for k, exp := range c.seen {
		if now.After(exp) {
			delete(c.seen, k)
		}
	}
	if _, ok := c.seen[key]; ok {
		return true, nil
	}
	c.seen[key] = now.Add(ttl)
	return false, nil
}
