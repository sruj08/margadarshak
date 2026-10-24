// Package objectstore defines the object-storage port for clip media and manifests (decision D5)
// and the rules every implementation shares. Two implementations:
//
//   - mock: the local filesystem, served by the API itself at /mock/media/<key>?exp=…&sig=…
//     (dev, CI, demo without R2);
//   - r2: Cloudflare R2 through the S3 API, signed with AWS Signature V4 written with the standard
//     library (no SDK, so no go.mod change).
//
// Both pass the same contract suite (objectstoretest.Run).
//
// ObjectStore, ObjectInfo and the error values are defined in internal/ports; the
// implementations live here.
package objectstore

import (
	"fmt"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// ObjectStore, ObjectInfo and the errors are the port (internal/ports/objectstore.go).
type (
	ObjectStore = ports.ObjectStore
	ObjectInfo  = ports.ObjectInfo
)

// Errors shared by every implementation (aliases of the ports errors).
var (
	ErrNotFound    = ports.ErrObjectNotFound
	ErrInvalidKey  = ports.ErrObjectInvalidKey
	ErrInvalidTTL  = ports.ErrObjectInvalidTTL
	ErrTooLarge    = ports.ErrObjectTooLarge
	ErrUnavailable = ports.ErrObjectUnavailable
)

// Limits.
const (
	MaxKeyLen   = 512
	MaxPutBytes = 8 << 20
	// MaxTTL is SigV4's presign limit (7 days).
	MaxTTL = 7 * 24 * time.Hour
)

// ValidKey checks a key: 1–512 chars of [A-Za-z0-9._/-] (plus '@' and '+'), relative, no empty,
// "." or ".." segment. Keys never carry user input verbatim, so the allowlist can be strict.
func ValidKey(key string) error {
	if key == "" || len(key) > MaxKeyLen {
		return fmt.Errorf("%w: length", ErrInvalidKey)
	}
	for _, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '.', r == '_', r == '-', r == '/', r == '@', r == '+':
		default:
			return fmt.Errorf("%w: character %q", ErrInvalidKey, r)
		}
	}
	for _, seg := range strings.Split(key, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return fmt.Errorf("%w: segment %q", ErrInvalidKey, seg)
		}
	}
	return nil
}

// ValidTTL checks a presign TTL: (0, MaxTTL], whole seconds.
func ValidTTL(ttl time.Duration) error {
	if ttl < time.Second || ttl > MaxTTL {
		return fmt.Errorf("%w: %v", ErrInvalidTTL, ttl)
	}
	return nil
}

// contentTypes is the fixed extension table used where an implementation has no stored type.
var contentTypes = map[string]string{
	".json": "application/json",
	".mp4":  "video/mp4",
	".webm": "video/webm",
	".vtt":  "text/vtt",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".csv":  "text/csv",
	".txt":  "text/plain",
}

// ContentTypeFor returns the content type for key's extension (application/octet-stream when
// unknown). Deterministic across platforms: it does not consult the OS registry.
func ContentTypeFor(key string) string {
	i := strings.LastIndexByte(key, '.')
	if i >= 0 {
		if ct, ok := contentTypes[strings.ToLower(key[i:])]; ok {
			return ct
		}
	}
	return "application/octet-stream"
}
