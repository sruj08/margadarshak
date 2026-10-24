package r2

import (
	"context"
	"errors"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore/objectstoretest"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore/r2/fakes3"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore/r2/sigv4"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

var t0 = time.Date(2026, 10, 24, 4, 30, 0, 0, time.UTC)

const (
	accessKey = "R2TESTACCESSKEY"
	secretKey = "r2-test-secret-access-key"
	bucket    = "margdarshak-clips"
)

func newFake(t *testing.T) (*fakes3.Server, *httptest.Server, *servertime.Fixed) {
	t.Helper()
	clk := servertime.NewFixed(t0)
	fake := fakes3.New(sigv4.Signer{AccessKeyID: accessKey, SecretAccessKey: secretKey, Region: "auto", Service: "s3"}, bucket, clk)
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	return fake, srv, clk
}

func newStore(t *testing.T, srv *httptest.Server, clk Clock, secret string) *Store {
	t.Helper()
	s, err := New(Config{Endpoint: srv.URL, Bucket: bucket, AccessKeyID: accessKey, SecretAccessKey: secret}, clk, srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// The r2 client passes the shared contract against a fake S3 that checks every SigV4 signature.
func TestContract(t *testing.T) {
	objectstoretest.Run(t, func(t *testing.T) objectstoretest.Harness {
		_, srv, clk := newFake(t)
		return objectstoretest.Harness{Store: newStore(t, srv, clk, secretKey), HTTP: srv.Client(), Clock: clk}
	})
}

// Put, Head and Delete are header-signed; presigned URLs are query-signed.
func TestSigningModes(t *testing.T) {
	fake, srv, clk := newFake(t)
	s := newStore(t, srv, clk, secretKey)
	ctx := context.Background()
	if err := s.Put(ctx, "m/a.json", []byte("{}"), "application/json"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Head(ctx, "m/a.json"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, "m/a.json"); err != nil {
		t.Fatal(err)
	}
	want := []string{"PUT header m/a.json 200", "HEAD header m/a.json 200", "DELETE header m/a.json 204"}
	if strings.Join(fake.Requests, "|") != strings.Join(want, "|") {
		t.Fatalf("requests %v", fake.Requests)
	}
	u, err := s.PresignGet(ctx, "clips/JMU-0012/v3/360p.mp4", 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	pu, _ := url.Parse(u)
	q := pu.Query()
	if pu.Path != "/"+bucket+"/clips/JMU-0012/v3/360p.mp4" || q.Get("X-Amz-Expires") != "600" ||
		q.Get("X-Amz-Credential") != accessKey+"/20261024/auto/s3/aws4_request" || q.Get("X-Amz-SignedHeaders") != "host" {
		t.Fatalf("presigned %s", u)
	}
	put, _ := s.PresignPut(ctx, "ingest/x.mp4", time.Minute, "video/mp4")
	if pq, _ := url.Parse(put); pq.Query().Get("X-Amz-SignedHeaders") != "content-type;host" {
		t.Fatalf("presigned put %s", put)
	}
}

// Wrong credentials are refused by the server; the client reports a plain error, not "not found".
func TestWrongSecretRefused(t *testing.T) {
	_, srv, clk := newFake(t)
	s := newStore(t, srv, clk, "wrong")
	ctx := context.Background()
	if err := s.Put(ctx, "a.json", []byte("{}"), "application/json"); err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("Put: %v", err)
	}
	if _, err := s.Head(ctx, "a.json"); err == nil || errors.Is(err, objectstore.ErrNotFound) {
		t.Fatalf("Head: %v", err)
	}
}

// A down endpoint is ErrUnavailable.
func TestUnavailable(t *testing.T) {
	_, srv, clk := newFake(t)
	s := newStore(t, srv, clk, secretKey)
	srv.Close()
	if err := s.Put(context.Background(), "a.json", []byte("{}"), "application/json"); !errors.Is(err, objectstore.ErrUnavailable) {
		t.Fatalf("Put: %v", err)
	}
}

func TestVirtualHostedAndConfig(t *testing.T) {
	s, err := New(Config{Endpoint: AccountEndpoint("acc123"), Bucket: "b", AccessKeyID: "k", SecretAccessKey: "s", VirtualHosted: true},
		servertime.NewFixed(t0), nil)
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.PresignGet(context.Background(), "x/y.mp4", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(u, "https://b.acc123.r2.cloudflarestorage.com/x/y.mp4?") {
		t.Fatalf("url %s", u)
	}
	if _, err := New(Config{Endpoint: "ftp://x", Bucket: "b", AccessKeyID: "k", SecretAccessKey: "s"}, servertime.NewFixed(t0), nil); err == nil {
		t.Fatal("accepted a non-http endpoint")
	}
}
