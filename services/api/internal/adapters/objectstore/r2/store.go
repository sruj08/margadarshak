// Package r2 is the Cloudflare R2 object store (OBJECT_STORE=r2) over the S3 API, signed with
// AWS Signature V4 (package sigv4, standard library only). Presigned GET/PUT URLs use query
// signing; Put, Head and Delete use header signing with a signed payload hash.
//
// Env (plan §2.11.6): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_CLIPS /
// R2_BUCKET_INGEST (one Store per bucket), MEDIA_URL_TTL.
package r2

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore/r2/sigv4"
)

// Clock is the source of server time.
type Clock interface{ Now() time.Time }

// Config configures one bucket.
type Config struct {
	// Endpoint is the S3 API origin, e.g. AccountEndpoint(R2_ACCOUNT_ID).
	Endpoint        string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	// Region is "auto" for R2 (the default).
	Region string
	// VirtualHosted puts the bucket in the host name (<bucket>.<endpoint host>) instead of the
	// path. R2 accepts both; path style is the default.
	VirtualHosted bool
	// Timeout bounds Put, Head and Delete (default 10 s).
	Timeout time.Duration
}

// AccountEndpoint is R2's S3 endpoint for an account ID.
func AccountEndpoint(accountID string) string {
	return "https://" + accountID + ".r2.cloudflarestorage.com"
}

// Store is an S3-compatible bucket client.
type Store struct {
	cfg    Config
	base   *url.URL
	signer sigv4.Signer
	clock  Clock
	http   *http.Client
}

var _ objectstore.ObjectStore = (*Store)(nil)

// New validates cfg and returns a store. hc may be nil (a default client is used).
func New(cfg Config, clock Clock, hc *http.Client) (*Store, error) {
	if cfg.Endpoint == "" || cfg.Bucket == "" || cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" || clock == nil {
		return nil, errors.New("r2: endpoint, bucket, credentials and clock are required")
	}
	u, err := url.Parse(strings.TrimRight(cfg.Endpoint, "/"))
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, fmt.Errorf("r2: bad endpoint %q", cfg.Endpoint)
	}
	if cfg.Region == "" {
		cfg.Region = "auto"
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	if hc == nil {
		hc = &http.Client{}
	}
	return &Store{
		cfg:    cfg,
		base:   u,
		signer: sigv4.Signer{AccessKeyID: cfg.AccessKeyID, SecretAccessKey: cfg.SecretAccessKey, Region: cfg.Region, Service: "s3"},
		clock:  clock,
		http:   hc,
	}, nil
}

func (s *Store) objectURL(key string) (*url.URL, error) {
	if err := objectstore.ValidKey(key); err != nil {
		return nil, err
	}
	u := *s.base
	if s.cfg.VirtualHosted {
		u.Host = s.cfg.Bucket + "." + u.Host
		u.Path = "/" + key
	} else {
		u.Path = "/" + s.cfg.Bucket + "/" + key
	}
	return &u, nil
}

func (s *Store) presign(method, key string, ttl time.Duration, headers map[string]string) (string, error) {
	u, err := s.objectURL(key)
	if err != nil {
		return "", err
	}
	if err := objectstore.ValidTTL(ttl); err != nil {
		return "", err
	}
	signed, err := s.signer.Presign(method, u, headers, s.clock.Now(), ttl.Truncate(time.Second))
	if err != nil {
		return "", err
	}
	return signed.String(), nil
}

// PresignGet implements objectstore.ObjectStore.
func (s *Store) PresignGet(_ context.Context, key string, ttl time.Duration) (string, error) {
	return s.presign(http.MethodGet, key, ttl, nil)
}

// PresignPut implements objectstore.ObjectStore. The Content-Type header is signed.
func (s *Store) PresignPut(_ context.Context, key string, ttl time.Duration, contentType string) (string, error) {
	var h map[string]string
	if contentType != "" {
		h = map[string]string{"Content-Type": contentType}
	}
	return s.presign(http.MethodPut, key, ttl, h)
}

// do sends a header-signed request and returns the response with its body (≤ 64 KiB) read.
// result is what callers need from a response; do reads and closes the body itself.
type result struct {
	StatusCode    int
	Header        http.Header
	ContentLength int64
}

func (s *Store) do(ctx context.Context, method, key string, body []byte, contentType string) (*result, []byte, error) {
	u, err := s.objectURL(key)
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, s.cfg.Timeout)
	defer cancel()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), rd)
	if err != nil {
		return nil, nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	hash := sigv4.EmptySHA256
	if body != nil {
		hash = sigv4.PayloadHash(body)
	}
	s.signer.SignRequest(req, hash, s.clock.Now())
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: r2 %s: %w", objectstore.ErrUnavailable, method, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return &result{StatusCode: resp.StatusCode, Header: resp.Header, ContentLength: resp.ContentLength}, raw, nil
}

// s3Error is the S3 XML error body.
type s3Error struct {
	Code    string `xml:"Code"`
	Message string `xml:"Message"`
}

func statusErr(method string, resp *result, raw []byte) error {
	var e s3Error
	_ = xml.Unmarshal(raw, &e)
	msg := fmt.Sprintf("r2 %s: %d %s", method, resp.StatusCode, e.Code)
	if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
		return fmt.Errorf("%w: %s", objectstore.ErrUnavailable, msg)
	}
	return errors.New(msg)
}

// Put implements objectstore.ObjectStore.
func (s *Store) Put(ctx context.Context, key string, body []byte, contentType string) error {
	if len(body) > objectstore.MaxPutBytes {
		return objectstore.ErrTooLarge
	}
	if body == nil {
		body = []byte{}
	}
	resp, raw, err := s.do(ctx, http.MethodPut, key, body, contentType)
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		return statusErr(http.MethodPut, resp, raw)
	}
	return nil
}

// Head implements objectstore.ObjectStore.
func (s *Store) Head(ctx context.Context, key string) (objectstore.ObjectInfo, error) {
	resp, raw, err := s.do(ctx, http.MethodHead, key, nil, "")
	if err != nil {
		return objectstore.ObjectInfo{}, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return objectstore.ObjectInfo{}, objectstore.ErrNotFound
	}
	if resp.StatusCode/100 != 2 {
		return objectstore.ObjectInfo{}, statusErr(http.MethodHead, resp, raw)
	}
	size := resp.ContentLength
	if size < 0 {
		size, _ = strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)
	}
	return objectstore.ObjectInfo{Key: key, Size: size, ContentType: resp.Header.Get("Content-Type"), ETag: resp.Header.Get("ETag")}, nil
}

// Delete implements objectstore.ObjectStore. S3 answers 204 for a missing key too.
func (s *Store) Delete(ctx context.Context, key string) error {
	resp, raw, err := s.do(ctx, http.MethodDelete, key, nil, "")
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 && resp.StatusCode != http.StatusNotFound {
		return statusErr(http.MethodDelete, resp, raw)
	}
	return nil
}
