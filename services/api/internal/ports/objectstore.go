package ports

import (
	"context"
	"errors"
	"time"
)

// ---- Object storage (decision D5: mock | r2) --------------------------------------------------

// ObjectStore stores clip media and small JSON documents. Keys are slash-separated relative
// paths, e.g. "clips/JMU-0012/v3/360p.mp4" (clip-pipeline mediaObjectKey). Implementations:
// internal/adapters/objectstore/mock (filesystem, served at /mock/media/) and .../r2 (SigV4).
type ObjectStore interface {
	// PresignGet returns a URL that answers GET (with Range support) until now+ttl.
	PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error)
	// PresignPut returns a URL that accepts one PUT of the object until now+ttl. The upload must
	// send Content-Type: contentType (it is signed).
	PresignPut(ctx context.Context, key string, ttl time.Duration, contentType string) (string, error)
	// Put stores a small object (manifests, at most 8 MiB) directly.
	Put(ctx context.Context, key string, body []byte, contentType string) error
	// Head returns the object's metadata, or ErrObjectNotFound.
	Head(ctx context.Context, key string) (ObjectInfo, error)
	// Delete removes the object. Deleting a missing object is not an error.
	Delete(ctx context.Context, key string) error
}

// ObjectInfo is an object's metadata.
type ObjectInfo struct {
	Key         string
	Size        int64
	ContentType string
	ETag        string
}

// Object storage errors shared by every implementation.
var (
	ErrObjectNotFound    = errors.New("objectstore: not found")
	ErrObjectInvalidKey  = errors.New("objectstore: invalid key")
	ErrObjectInvalidTTL  = errors.New("objectstore: invalid ttl")
	ErrObjectTooLarge    = errors.New("objectstore: object too large for Put")
	ErrObjectUnavailable = errors.New("objectstore: unavailable")
)
