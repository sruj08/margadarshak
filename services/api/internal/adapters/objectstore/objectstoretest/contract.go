// Package objectstoretest is the contract suite every objectstore.ObjectStore must pass (the mock
// filesystem store and the r2 client against a SigV4-checking fake S3).
package objectstoretest

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

// Harness is one implementation under test.
type Harness struct {
	Store objectstore.ObjectStore
	// HTTP fetches presigned URLs (it must reach wherever the store points them).
	HTTP *http.Client
	// Clock is the clock the store and its server use; the suite advances it to test expiry.
	Clock *servertime.Fixed
}

// Run runs the contract against a fresh harness per subtest.
func Run(t *testing.T, newHarness func(t *testing.T) Harness) {
	ctx := context.Background()

	t.Run("invalid keys are refused everywhere", func(t *testing.T) {
		h := newHarness(t)
		for _, key := range []string{"", "/abs", "a/../b", "a//b", "./a", "a/", `a\b`, "a b", "ä", strings.Repeat("k", objectstore.MaxKeyLen+1)} {
			if _, err := h.Store.PresignGet(ctx, key, time.Minute); !errors.Is(err, objectstore.ErrInvalidKey) {
				t.Errorf("PresignGet(%q): %v", key, err)
			}
			if _, err := h.Store.PresignPut(ctx, key, time.Minute, "video/mp4"); !errors.Is(err, objectstore.ErrInvalidKey) {
				t.Errorf("PresignPut(%q): %v", key, err)
			}
			if err := h.Store.Put(ctx, key, []byte("{}"), "application/json"); !errors.Is(err, objectstore.ErrInvalidKey) {
				t.Errorf("Put(%q): %v", key, err)
			}
			if _, err := h.Store.Head(ctx, key); !errors.Is(err, objectstore.ErrInvalidKey) {
				t.Errorf("Head(%q): %v", key, err)
			}
			if err := h.Store.Delete(ctx, key); !errors.Is(err, objectstore.ErrInvalidKey) {
				t.Errorf("Delete(%q): %v", key, err)
			}
		}
	})

	t.Run("ttl bounds", func(t *testing.T) {
		h := newHarness(t)
		for _, ttl := range []time.Duration{0, -time.Minute, 500 * time.Millisecond, objectstore.MaxTTL + time.Second} {
			if _, err := h.Store.PresignGet(ctx, "a.json", ttl); !errors.Is(err, objectstore.ErrInvalidTTL) {
				t.Errorf("PresignGet ttl %v: %v", ttl, err)
			}
		}
	})

	t.Run("missing objects", func(t *testing.T) {
		h := newHarness(t)
		if _, err := h.Store.Head(ctx, "nope/missing.json"); !errors.Is(err, objectstore.ErrNotFound) {
			t.Fatalf("Head: %v", err)
		}
		if err := h.Store.Delete(ctx, "nope/missing.json"); err != nil {
			t.Fatalf("Delete of a missing object: %v", err)
		}
		u, err := h.Store.PresignGet(ctx, "nope/missing.json", time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if st, _ := fetch(t, h, http.MethodGet, u, nil, nil); st != http.StatusNotFound {
			t.Fatalf("GET missing: %d", st)
		}
	})

	t.Run("put, head, presigned get with range, delete", func(t *testing.T) {
		h := newHarness(t)
		key := "manifests/client-JK.json"
		body := []byte(`{"schema":"margdarshak.clips.client/1","clips":[]}`)
		if err := h.Store.Put(ctx, key, body, "application/json"); err != nil {
			t.Fatal(err)
		}
		info, err := h.Store.Head(ctx, key)
		if err != nil {
			t.Fatal(err)
		}
		if info.Size != int64(len(body)) || info.ContentType != "application/json" || info.ETag == "" || info.Key != key {
			t.Fatalf("Head: %+v", info)
		}
		u, err := h.Store.PresignGet(ctx, key, 10*time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		st, got := fetch(t, h, http.MethodGet, u, nil, nil)
		if st != http.StatusOK || !bytes.Equal(got, body) {
			t.Fatalf("GET: %d %q", st, got)
		}
		st, got = fetch(t, h, http.MethodGet, u, map[string]string{"Range": "bytes=2-9"}, nil)
		if st != http.StatusPartialContent || !bytes.Equal(got, body[2:10]) {
			t.Fatalf("Range GET: %d %q", st, got)
		}
		// Overwrite.
		body2 := []byte(`{"v":2}`)
		if err := h.Store.Put(ctx, key, body2, "application/json"); err != nil {
			t.Fatal(err)
		}
		if st, got = fetch(t, h, http.MethodGet, u, nil, nil); st != http.StatusOK || !bytes.Equal(got, body2) {
			t.Fatalf("GET after overwrite: %d %q", st, got)
		}
		if err := h.Store.Delete(ctx, key); err != nil {
			t.Fatal(err)
		}
		if _, err := h.Store.Head(ctx, key); !errors.Is(err, objectstore.ErrNotFound) {
			t.Fatalf("Head after delete: %v", err)
		}
		if st, _ = fetch(t, h, http.MethodGet, u, nil, nil); st != http.StatusNotFound {
			t.Fatalf("GET after delete: %d", st)
		}
	})

	t.Run("presigned urls expire and cannot be altered", func(t *testing.T) {
		h := newHarness(t)
		key := "clips/JMU-0012/v3/360p.mp4"
		if err := h.Store.Put(ctx, key, []byte("0123456789"), "video/mp4"); err != nil {
			t.Fatal(err)
		}
		u, err := h.Store.PresignGet(ctx, key, 5*time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if st, _ := fetch(t, h, http.MethodGet, u, nil, nil); st != http.StatusOK {
			t.Fatalf("fresh URL: %d", st)
		}
		// Another key under the same signature.
		other := strings.Replace(u, "360p.mp4", "480p.mp4", 1)
		if st, _ := fetch(t, h, http.MethodGet, other, nil, nil); st != http.StatusForbidden {
			t.Fatalf("re-pointed URL: %d", st)
		}
		// A flipped signature character.
		if st, _ := fetch(t, h, http.MethodGet, flipLast(t, u), nil, nil); st != http.StatusForbidden {
			t.Fatalf("tampered URL: %d", st)
		}
		// A GET URL is not a PUT URL.
		if st, _ := fetch(t, h, http.MethodPut, u, map[string]string{"Content-Type": "video/mp4"}, []byte("x")); st != http.StatusForbidden {
			t.Fatalf("GET URL used for PUT: %d", st)
		}
		start := h.Clock.Now()
		h.Clock.Advance(5*time.Minute + 2*time.Second)
		if st, _ := fetch(t, h, http.MethodGet, u, nil, nil); st != http.StatusForbidden {
			t.Fatalf("expired URL: %d", st)
		}
		h.Clock.Set(start)
	})

	t.Run("presigned put", func(t *testing.T) {
		h := newHarness(t)
		key := "ingest/JMU-0099/raw.mp4"
		u, err := h.Store.PresignPut(ctx, key, 15*time.Minute, "video/mp4")
		if err != nil {
			t.Fatal(err)
		}
		media := bytes.Repeat([]byte{0, 1, 2, 3}, 1024)
		if st, _ := fetch(t, h, http.MethodPut, u, map[string]string{"Content-Type": "video/webm"}, media); st != http.StatusForbidden {
			t.Fatalf("PUT with another content type: %d", st)
		}
		if st, _ := fetch(t, h, http.MethodPut, u, map[string]string{"Content-Type": "video/mp4"}, media); st != http.StatusOK {
			t.Fatalf("PUT: %d", st)
		}
		info, err := h.Store.Head(ctx, key)
		if err != nil || info.Size != int64(len(media)) || info.ContentType != "video/mp4" {
			t.Fatalf("Head after PUT: %+v %v", info, err)
		}
		g, err := h.Store.PresignGet(ctx, key, time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if st, got := fetch(t, h, http.MethodGet, g, nil, nil); st != http.StatusOK || !bytes.Equal(got, media) {
			t.Fatalf("GET after PUT: %d (%d bytes)", st, len(got))
		}
		if err := h.Store.Delete(ctx, key); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("put size cap", func(t *testing.T) {
		h := newHarness(t)
		if err := h.Store.Put(ctx, "big.json", make([]byte, objectstore.MaxPutBytes+1), "application/json"); !errors.Is(err, objectstore.ErrTooLarge) {
			t.Fatalf("oversized Put: %v", err)
		}
	})
}

func fetch(t *testing.T, h Harness, method, rawURL string, headers map[string]string, body []byte) (int, []byte) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, rawURL, rd)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := h.HTTP.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

// flipLast changes the last hex character of the URL's signature parameter.
func flipLast(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	for _, name := range []string{"sig", "X-Amz-Signature"} {
		if v := q.Get(name); v != "" {
			last := v[len(v)-1]
			repl := byte('0')
			if last == '0' {
				repl = '1'
			}
			q.Set(name, v[:len(v)-1]+string(repl))
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
}
