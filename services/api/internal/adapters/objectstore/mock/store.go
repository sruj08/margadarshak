// Package mock is the filesystem object store (OBJECT_STORE=mock). Objects live under a root
// directory; presigned URLs point back at the API:
//
//	<MEDIA_PUBLIC_BASE_URL>/mock/media/<key>?exp=<unix>&sig=<hex>
//
// sig = hex(HMAC-SHA256(secret, method + "\n" + key + "\n" + exp + "\n" + contentType)), where
// contentType is empty for GET. Handler validates the signature and expiry and serves the file
// with HTTP Range support (offline packs and the service worker need it), or accepts a presigned
// PUT. Content types come from the key's extension (objectstore.ContentTypeFor).
//
// httpapi mounts Handler() at /mock/media/ (mockpages.go, when OBJECT_STORE=mock).
package mock

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/objectstore"
)

// Clock is the source of server time.
type Clock interface{ Now() time.Time }

// PathPrefix is where Handler expects to be mounted.
const PathPrefix = "/mock/media/"

// MaxUploadBytes caps a presigned PUT (a 480p clip is a few MB).
const MaxUploadBytes = 64 << 20

// Store is the filesystem store.
type Store struct {
	root    string
	baseURL string
	secret  []byte
	clock   Clock
}

var _ objectstore.ObjectStore = (*Store)(nil)

// New returns a store rooted at root (created if missing). publicBaseURL is
// MEDIA_PUBLIC_BASE_URL (the API's public origin). secret signs URLs; a random one is generated
// when empty (URLs then die with the process, which is fine for dev).
func New(root, publicBaseURL string, secret []byte, clock Clock) (*Store, error) {
	if root == "" || publicBaseURL == "" || clock == nil {
		return nil, errors.New("mock objectstore: root, base URL and clock are required")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o750); err != nil {
		return nil, fmt.Errorf("mock objectstore: %w", err)
	}
	if len(secret) == 0 {
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return nil, err
		}
	}
	return &Store{root: abs, baseURL: strings.TrimRight(publicBaseURL, "/"), secret: secret, clock: clock}, nil
}

func (s *Store) path(key string) (string, error) {
	if err := objectstore.ValidKey(key); err != nil {
		return "", err
	}
	p := filepath.Join(s.root, filepath.FromSlash(key))
	rel, err := filepath.Rel(s.root, p)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("%w: escapes root", objectstore.ErrInvalidKey)
	}
	return p, nil
}

func (s *Store) sign(method, key string, exp int64, contentType string) string {
	m := hmac.New(sha256.New, s.secret)
	_, _ = io.WriteString(m, method+"\n"+key+"\n"+strconv.FormatInt(exp, 10)+"\n"+contentType)
	return hex.EncodeToString(m.Sum(nil))
}

func (s *Store) presign(method, key string, ttl time.Duration, contentType string) (string, error) {
	if _, err := s.path(key); err != nil {
		return "", err
	}
	if err := objectstore.ValidTTL(ttl); err != nil {
		return "", err
	}
	exp := s.clock.Now().Add(ttl).Unix()
	q := url.Values{}
	q.Set("exp", strconv.FormatInt(exp, 10))
	q.Set("sig", s.sign(method, key, exp, contentType))
	return s.baseURL + PathPrefix + key + "?" + q.Encode(), nil
}

// PresignGet implements objectstore.ObjectStore.
func (s *Store) PresignGet(_ context.Context, key string, ttl time.Duration) (string, error) {
	return s.presign(http.MethodGet, key, ttl, "")
}

// PresignPut implements objectstore.ObjectStore.
func (s *Store) PresignPut(_ context.Context, key string, ttl time.Duration, contentType string) (string, error) {
	return s.presign(http.MethodPut, key, ttl, contentType)
}

// Put implements objectstore.ObjectStore.
func (s *Store) Put(_ context.Context, key string, body []byte, _ string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if len(body) > objectstore.MaxPutBytes {
		return objectstore.ErrTooLarge
	}
	return writeAtomic(p, func(w io.Writer) error { _, err := w.Write(body); return err })
}

func writeAtomic(p string, fill func(io.Writer) error) error {
	if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(p), ".upload-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	if err := fill(f); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// Head implements objectstore.ObjectStore.
func (s *Store) Head(_ context.Context, key string) (objectstore.ObjectInfo, error) {
	p, err := s.path(key)
	if err != nil {
		return objectstore.ObjectInfo{}, err
	}
	st, err := os.Stat(p)
	if errors.Is(err, fs.ErrNotExist) || (err == nil && st.IsDir()) {
		return objectstore.ObjectInfo{}, objectstore.ErrNotFound
	}
	if err != nil {
		return objectstore.ObjectInfo{}, err
	}
	return objectstore.ObjectInfo{Key: key, Size: st.Size(), ContentType: objectstore.ContentTypeFor(key),
		ETag: etag(st)}, nil
}

func etag(st fs.FileInfo) string {
	return fmt.Sprintf(`"%x-%x"`, st.Size(), st.ModTime().UnixNano())
}

// Delete implements objectstore.ObjectStore.
func (s *Store) Delete(_ context.Context, key string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// Handler serves presigned URLs under PathPrefix: GET/HEAD with Range support, and PUT.
func (s *Store) Handler() http.Handler {
	return http.HandlerFunc(s.serve)
}

func (s *Store) serve(w http.ResponseWriter, r *http.Request) {
	key, ok := strings.CutPrefix(r.URL.Path, PathPrefix)
	if !ok {
		http.NotFound(w, r)
		return
	}
	p, err := s.path(key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	method, ct := r.Method, ""
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		method = http.MethodGet // a GET URL also answers HEAD
	case http.MethodPut:
		ct = r.Header.Get("Content-Type")
	default:
		w.Header().Set("Allow", "GET, HEAD, PUT")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	exp, err := strconv.ParseInt(q.Get("exp"), 10, 64)
	want := s.sign(method, key, exp, ct)
	if err != nil || !hmac.Equal([]byte(want), []byte(q.Get("sig"))) || s.clock.Now().Unix() > exp {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=0")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method == http.MethodPut {
		err := writeAtomic(p, func(dst io.Writer) error {
			n, err := io.Copy(dst, io.LimitReader(r.Body, MaxUploadBytes+1))
			if err == nil && n > MaxUploadBytes {
				return objectstore.ErrTooLarge
			}
			return err
		})
		if errors.Is(err, objectstore.ErrTooLarge) {
			http.Error(w, "too large", http.StatusRequestEntityTooLarge)
			return
		}
		if err != nil {
			http.Error(w, "upload failed", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() { _ = f.Close() }()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", objectstore.ContentTypeFor(key))
	w.Header().Set("ETag", etag(st))
	http.ServeContent(w, r, "", st.ModTime(), f) // Range, If-Range, HEAD
}
