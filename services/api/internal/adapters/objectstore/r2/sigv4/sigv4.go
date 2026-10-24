// Package sigv4 implements AWS Signature Version 4 for the S3 API with the standard library:
// query-string presigning (GET/PUT URLs) and Authorization-header signing (PUT, HEAD, DELETE),
// plus verification (used by the fake S3 in tests). Reference: AWS "Authenticating Requests:
// Using Query Parameters / the Authorization Header (AWS Signature Version 4)" for S3; the
// known-answer tests use the examples published there.
package sigv4

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Constants of the scheme.
const (
	Algorithm       = "AWS4-HMAC-SHA256"
	TimeFormat      = "20060102T150405Z"
	DateFormat      = "20060102"
	UnsignedPayload = "UNSIGNED-PAYLOAD"
	// EmptySHA256 is hex(sha256("")).
	EmptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	// MaxExpires is the presign limit (7 days).
	MaxExpires = 7 * 24 * time.Hour
	// MaxSkew is the clock skew accepted on header-signed requests.
	MaxSkew = 15 * time.Minute
)

// Signer signs for one credential scope.
type Signer struct {
	AccessKeyID     string
	SecretAccessKey string
	Region          string // "auto" for R2, "us-east-1" in the AWS examples
	Service         string // "s3"
}

func (s Signer) scope(t time.Time) string {
	return t.UTC().Format(DateFormat) + "/" + s.Region + "/" + s.service() + "/aws4_request"
}

func (s Signer) service() string {
	if s.Service == "" {
		return "s3"
	}
	return s.Service
}

// SigningKey derives the per-day signing key.
func (s Signer) SigningKey(t time.Time) []byte {
	k := hmacSHA256([]byte("AWS4"+s.SecretAccessKey), t.UTC().Format(DateFormat))
	k = hmacSHA256(k, s.Region)
	k = hmacSHA256(k, s.service())
	return hmacSHA256(k, "aws4_request")
}

// StringToSign builds the string to sign for a canonical request.
func (s Signer) StringToSign(t time.Time, canonicalRequest string) string {
	return Algorithm + "\n" + t.UTC().Format(TimeFormat) + "\n" + s.scope(t) + "\n" + hexSHA256([]byte(canonicalRequest))
}

// Signature signs a canonical request.
func (s Signer) Signature(t time.Time, canonicalRequest string) string {
	return hex.EncodeToString(hmacSHA256(s.SigningKey(t), s.StringToSign(t, canonicalRequest)))
}

// Presign returns u signed with query parameters for method, valid for expires. headers are
// extra headers the caller must send (e.g. Content-Type for a PUT); host is always signed. The
// payload is UNSIGNED-PAYLOAD.
func (s Signer) Presign(method string, u *url.URL, headers map[string]string, t time.Time, expires time.Duration) (*url.URL, error) {
	if expires < time.Second || expires > MaxExpires {
		return nil, fmt.Errorf("sigv4: expires %v out of range", expires)
	}
	h := http.Header{}
	for k, v := range headers {
		h.Set(k, v)
	}
	h.Set("Host", u.Host)
	names := signedNames(h, func(string) bool { return true })
	out := *u
	out.RawPath = EncodePath(u.Path)
	q := u.Query()
	q.Set("X-Amz-Algorithm", Algorithm)
	q.Set("X-Amz-Credential", s.AccessKeyID+"/"+s.scope(t))
	q.Set("X-Amz-Date", t.UTC().Format(TimeFormat))
	q.Set("X-Amz-Expires", strconv.FormatInt(int64(expires/time.Second), 10))
	q.Set("X-Amz-SignedHeaders", strings.Join(names, ";"))
	cq := CanonicalQuery(q)
	cr := CanonicalRequest(method, out.RawPath, cq, h, names, UnsignedPayload)
	// The signature goes last, as in the AWS examples.
	out.RawQuery = cq + "&X-Amz-Signature=" + s.Signature(t, cr)
	return &out, nil
}

// SignRequest signs req with the Authorization header. payloadHash is hex(sha256(body)) or
// UnsignedPayload. Signed: host, every x-amz-* header, and content-type, content-md5, range and
// date when present.
func (s Signer) SignRequest(req *http.Request, payloadHash string, t time.Time) {
	req.Header.Set("X-Amz-Date", t.UTC().Format(TimeFormat))
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	h := req.Header.Clone()
	h.Set("Host", hostOf(req))
	names := signedNames(h, headerSigned)
	req.URL.RawPath = EncodePath(req.URL.Path)
	cr := CanonicalRequest(req.Method, req.URL.RawPath, CanonicalQuery(req.URL.Query()), h, names, payloadHash)
	req.Header.Set("Authorization", fmt.Sprintf("%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		Algorithm, s.AccessKeyID, s.scope(t), strings.Join(names, ";"), s.Signature(t, cr)))
}

func hostOf(r *http.Request) string {
	if r.Host != "" {
		return r.Host
	}
	return r.URL.Host
}

func headerSigned(name string) bool {
	switch name {
	case "host", "content-type", "content-md5", "range", "date":
		return true
	}
	return strings.HasPrefix(name, "x-amz-")
}

func signedNames(h http.Header, keep func(string) bool) []string {
	var names []string
	for k := range h {
		n := strings.ToLower(k)
		if keep(n) {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	return names
}

// CanonicalRequest builds the canonical request. canonicalURI is already URI-encoded; the
// header values of names are taken from h (trimmed, inner spaces collapsed).
func CanonicalRequest(method, canonicalURI, canonicalQuery string, h http.Header, names []string, payloadHash string) string {
	if canonicalURI == "" {
		canonicalURI = "/"
	}
	var b strings.Builder
	b.WriteString(method + "\n" + canonicalURI + "\n" + canonicalQuery + "\n")
	for _, n := range names {
		vals := h.Values(n)
		trimmed := make([]string, len(vals))
		for i, v := range vals {
			trimmed[i] = strings.Join(strings.Fields(v), " ")
		}
		b.WriteString(n + ":" + strings.Join(trimmed, ",") + "\n")
	}
	b.WriteString("\n" + strings.Join(names, ";") + "\n" + payloadHash)
	return b.String()
}

// CanonicalQuery encodes q sorted by key (then value) with SigV4 encoding.
func CanonicalQuery(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		vs := append([]string(nil), q[k]...)
		sort.Strings(vs)
		for _, v := range vs {
			parts = append(parts, Encode(k, true)+"="+Encode(v, true))
		}
	}
	return strings.Join(parts, "&")
}

// EncodePath URI-encodes a path once (S3 does not double-encode), keeping '/'.
func EncodePath(p string) string {
	if p == "" {
		return "/"
	}
	return Encode(p, false)
}

// Encode is SigV4 URI encoding: unreserved characters (A-Z a-z 0-9 - . _ ~) stay, everything
// else is %XX (upper case). '/' is encoded only when encodeSlash is set (query components).
func Encode(s string, encodeSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '-', c == '.', c == '_', c == '~':
			b.WriteByte(c)
		case c == '/' && !encodeSlash:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

func hexSHA256(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// PayloadHash is hex(sha256(body)).
func PayloadHash(body []byte) string { return hexSHA256(body) }

// Verification errors.
var (
	ErrNoAuth    = errors.New("sigv4: no signature")
	ErrMalformed = errors.New("sigv4: malformed signature")
	ErrExpired   = errors.New("sigv4: request expired or not yet valid")
	ErrMismatch  = errors.New("sigv4: signature does not match")
	ErrPayload   = errors.New("sigv4: payload hash does not match")
)

// Verify checks a request signed either way against s (whose AccessKeyID must match the
// credential). body is the request body already read (nil for none). Used by the fake S3.
func (s Signer) Verify(r *http.Request, body []byte, now time.Time) error {
	q := r.URL.Query()
	if q.Get("X-Amz-Algorithm") != "" {
		return s.verifyQuery(r, q, now)
	}
	if strings.HasPrefix(r.Header.Get("Authorization"), Algorithm+" ") {
		return s.verifyHeader(r, body, now)
	}
	return ErrNoAuth
}

func (s Signer) checkCredential(cred string, t time.Time) error {
	if cred != s.AccessKeyID+"/"+s.scope(t) {
		return fmt.Errorf("%w: credential", ErrMismatch)
	}
	return nil
}

func (s Signer) verifyQuery(r *http.Request, q url.Values, now time.Time) error {
	if q.Get("X-Amz-Algorithm") != Algorithm {
		return ErrMalformed
	}
	t, err := time.Parse(TimeFormat, q.Get("X-Amz-Date"))
	if err != nil {
		return ErrMalformed
	}
	exp, err := strconv.Atoi(q.Get("X-Amz-Expires"))
	if err != nil || exp < 1 || time.Duration(exp)*time.Second > MaxExpires {
		return ErrMalformed
	}
	if now.Before(t.Add(-MaxSkew)) || now.After(t.Add(time.Duration(exp)*time.Second)) {
		return ErrExpired
	}
	if err := s.checkCredential(q.Get("X-Amz-Credential"), t); err != nil {
		return err
	}
	names := strings.Split(q.Get("X-Amz-SignedHeaders"), ";")
	if !contains(names, "host") {
		return ErrMalformed
	}
	got := q.Get("X-Amz-Signature")
	q.Del("X-Amz-Signature")
	h := r.Header.Clone()
	h.Set("Host", hostOf(r))
	cr := CanonicalRequest(r.Method, EncodePath(r.URL.Path), CanonicalQuery(q), h, names, UnsignedPayload)
	if !hmac.Equal([]byte(s.Signature(t, cr)), []byte(got)) {
		return ErrMismatch
	}
	return nil
}

func (s Signer) verifyHeader(r *http.Request, body []byte, now time.Time) error {
	auth := strings.TrimPrefix(r.Header.Get("Authorization"), Algorithm+" ")
	fields := map[string]string{}
	for _, part := range strings.Split(auth, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			return ErrMalformed
		}
		fields[k] = v
	}
	t, err := time.Parse(TimeFormat, r.Header.Get("X-Amz-Date"))
	if err != nil {
		return ErrMalformed
	}
	if d := now.Sub(t); d > MaxSkew || d < -MaxSkew {
		return ErrExpired
	}
	if err := s.checkCredential(fields["Credential"], t); err != nil {
		return err
	}
	names := strings.Split(fields["SignedHeaders"], ";")
	if !contains(names, "host") || !contains(names, "x-amz-content-sha256") || !contains(names, "x-amz-date") {
		return ErrMalformed
	}
	ph := r.Header.Get("X-Amz-Content-Sha256")
	if ph != UnsignedPayload && ph != PayloadHash(body) {
		return ErrPayload
	}
	h := r.Header.Clone()
	h.Set("Host", hostOf(r))
	cr := CanonicalRequest(r.Method, EncodePath(r.URL.Path), CanonicalQuery(r.URL.Query()), h, names, ph)
	if !hmac.Equal([]byte(s.Signature(t, cr)), []byte(fields["Signature"])) {
		return ErrMismatch
	}
	return nil
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
