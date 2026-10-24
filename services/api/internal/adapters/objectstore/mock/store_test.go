package mock

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore/objectstoretest"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

var t0 = time.Date(2026, 10, 24, 4, 30, 0, 0, time.UTC)

// newStore mounts Handler on an httptest server whose URL is MEDIA_PUBLIC_BASE_URL.
func newStore(t *testing.T) (*Store, *httptest.Server, *servertime.Fixed) {
	t.Helper()
	clk := servertime.NewFixed(t0)
	mux := http.NewServeMux()
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	s, err := New(t.TempDir(), srv.URL, []byte("mock-media-secret"), clk)
	if err != nil {
		t.Fatal(err)
	}
	mux.Handle(PathPrefix, s.Handler())
	return s, srv, clk
}

func TestContract(t *testing.T) {
	objectstoretest.Run(t, func(t *testing.T) objectstoretest.Harness {
		s, srv, clk := newStore(t)
		return objectstoretest.Harness{Store: s, HTTP: srv.Client(), Clock: clk}
	})
}

func TestURLShape(t *testing.T) {
	s, srv, _ := newStore(t)
	u, err := s.PresignGet(context.Background(), "clips/JMU-0012/v3/360p.mp4", 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	prefix := srv.URL + "/mock/media/clips/JMU-0012/v3/360p.mp4?exp="
	if !strings.HasPrefix(u, prefix) || !strings.Contains(u, "&sig=") {
		t.Fatalf("url %s", u)
	}
	if !strings.Contains(u, "exp=1792816800") { // t0 + 10 min
		t.Fatalf("exp not t0+ttl: %s", u)
	}
}

func TestHandlerServesHEADAndRefusesOtherMethods(t *testing.T) {
	s, srv, _ := newStore(t)
	ctx := context.Background()
	if err := s.Put(ctx, "a/b.json", []byte(`{"x":1}`), "application/json"); err != nil {
		t.Fatal(err)
	}
	u, _ := s.PresignGet(ctx, "a/b.json", time.Minute)
	req, _ := http.NewRequest(http.MethodHead, u, nil)
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 || resp.ContentLength != 7 || resp.Header.Get("Accept-Ranges") != "bytes" ||
		resp.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("HEAD: %d len %d headers %v", resp.StatusCode, resp.ContentLength, resp.Header)
	}
	req, _ = http.NewRequest(http.MethodDelete, u, nil)
	resp, err = srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE: %d", resp.StatusCode)
	}
}

// Files never land outside the root, whatever the key.
func TestStaysInsideRoot(t *testing.T) {
	root := t.TempDir()
	s, err := New(root, "http://x", []byte("k"), servertime.NewFixed(t0))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Put(context.Background(), "x/y/z.json", []byte("{}"), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "x", "y", "z.json")); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"../escape.json", "x/../../escape.json"} {
		if err := s.Put(context.Background(), key, []byte("{}"), ""); err == nil {
			t.Fatalf("accepted %q", key)
		}
	}
}
