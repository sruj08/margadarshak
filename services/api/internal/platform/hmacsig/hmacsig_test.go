package hmacsig

import (
	"context"
	"errors"
	"testing"
	"time"
)

// The replay cache is keyed on method + path + signature (P1 hand-off): two different calls
// signed in the same second with the same body (e.g. two GETs with empty bodies) are both
// accepted; replaying the same request is rejected; a re-signed retry is accepted.
func TestReplayCacheKeysOnMethodAndPath(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	v := &Verifier{Secret: []byte("s"), Window: 5 * time.Minute, Replay: NewMemoryReplayCache(), Now: func() time.Time { return now }}
	ctx := context.Background()
	sig := Sign(v.Secret, now, nil)
	if err := v.VerifyRequest(ctx, "GET", "/internal/analytics/digest?period=week", sig, nil); err != nil {
		t.Fatal(err)
	}
	if err := v.VerifyRequest(ctx, "POST", "/internal/notifications/seen", sig, nil); err != nil {
		t.Fatalf("a different request with the same signature must not count as a replay: %v", err)
	}
	if err := v.VerifyRequest(ctx, "GET", "/internal/analytics/digest?period=day", sig, nil); err != nil {
		t.Fatalf("different query: %v", err)
	}
	if err := v.VerifyRequest(ctx, "GET", "/internal/analytics/digest?period=week", sig, nil); !errors.Is(err, ErrReplay) {
		t.Fatalf("replay not rejected: %v", err)
	}
	retry := Sign(v.Secret, now.Add(time.Second), nil)
	if err := v.VerifyRequest(ctx, "GET", "/internal/analytics/digest?period=week", retry, nil); err != nil {
		t.Fatalf("re-signed retry rejected: %v", err)
	}
	if err := v.VerifyRequest(ctx, "GET", "/x", Sign([]byte("other"), now, nil), nil); !errors.Is(err, ErrMismatch) {
		t.Fatalf("bad signature: %v", err)
	}
	if err := v.VerifyRequest(ctx, "GET", "/x", Sign(v.Secret, now.Add(-10*time.Minute), nil), nil); !errors.Is(err, ErrStale) {
		t.Fatalf("stale: %v", err)
	}
}
