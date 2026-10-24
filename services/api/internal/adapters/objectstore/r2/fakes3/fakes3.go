// Package fakes3 is an in-memory S3 endpoint for tests. Every request must carry a valid AWS
// SigV4 signature (query presign or Authorization header) for the configured credentials, checked
// against the injected clock; otherwise it answers 403 like S3. Supports path-style
// PUT/GET/HEAD/DELETE on /<bucket>/<key>, with Range on GET.
package fakes3

import (
	"bytes"
	"crypto/md5" //nolint:gosec // ETag format only, as S3 does
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore/r2/sigv4"
)

// Clock is the source of time for signature checks.
type Clock interface{ Now() time.Time }

type object struct {
	body        []byte
	contentType string
	modified    time.Time
}

// Server is the fake endpoint (an http.Handler).
type Server struct {
	Signer sigv4.Signer
	Bucket string
	Clock  Clock

	mu       sync.Mutex
	objects  map[string]object
	Requests []string // "METHOD auth-kind key status", for assertions
}

// New returns an empty fake bucket.
func New(signer sigv4.Signer, bucket string, clock Clock) *Server {
	return &Server{Signer: signer, Bucket: bucket, Clock: clock, objects: map[string]object{}}
}

func s3err(w http.ResponseWriter, r *http.Request, status int, code string) {
	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>%s</Code><Message>%s</Message></Error>`, code, code)
	}
}

func (s *Server) record(r *http.Request, key string, status int) {
	kind := "header"
	if r.URL.Query().Get("X-Amz-Algorithm") != "" {
		kind = "presigned"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Requests = append(s.Requests, fmt.Sprintf("%s %s %s %d", r.Method, kind, key, status))
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	key, ok := strings.CutPrefix(r.URL.Path, "/"+s.Bucket+"/")
	if !ok || key == "" {
		s3err(w, r, http.StatusNotFound, "NoSuchBucket")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 128<<20))
	if err != nil {
		s3err(w, r, http.StatusBadRequest, "IncompleteBody")
		return
	}
	if err := s.Signer.Verify(r, body, s.Clock.Now()); err != nil {
		s.record(r, key, http.StatusForbidden)
		s3err(w, r, http.StatusForbidden, "SignatureDoesNotMatch")
		return
	}
	switch r.Method {
	case http.MethodPut:
		s.mu.Lock()
		s.objects[key] = object{body: body, contentType: r.Header.Get("Content-Type"), modified: s.Clock.Now()}
		s.mu.Unlock()
		sum := md5.Sum(body) //nolint:gosec
		w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:])+`"`)
		w.WriteHeader(http.StatusOK)
		s.record(r, key, http.StatusOK)
	case http.MethodGet, http.MethodHead:
		s.mu.Lock()
		o, found := s.objects[key]
		s.mu.Unlock()
		if !found {
			s.record(r, key, http.StatusNotFound)
			s3err(w, r, http.StatusNotFound, "NoSuchKey")
			return
		}
		sum := md5.Sum(o.body) //nolint:gosec
		w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:])+`"`)
		if o.contentType != "" {
			w.Header().Set("Content-Type", o.contentType)
		}
		s.record(r, key, http.StatusOK)
		http.ServeContent(w, r, "", o.modified, bytes.NewReader(o.body))
	case http.MethodDelete:
		s.mu.Lock()
		delete(s.objects, key)
		s.mu.Unlock()
		s.record(r, key, http.StatusNoContent)
		w.WriteHeader(http.StatusNoContent)
	default:
		s3err(w, r, http.StatusMethodNotAllowed, "MethodNotAllowed")
	}
}
