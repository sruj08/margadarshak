// Package ids generates UUIDv7 keys (time-sortable, DATA_MODEL §4.0) and renders them as the
// opaque prefixed Crockford base32 strings the API shows (cas_01JB8ZC..., API_SPEC §1.1).
package ids

import (
	"crypto/sha256"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/oklog/ulid/v2"
)

// Prefixes used on the wire.
const (
	Device        = "dev"
	User          = "usr"
	Case          = "cas"
	Consent       = "cns"
	FamilyMember  = "fam"
	PaymentIntent = "pay"
	Notification  = "ntf"
	Audit         = "aud"
	Session       = "ses"
	Run           = "run"
	Timeline      = "tle"
	Plan          = "pln"
	Quote         = "fq"
	Export        = "exp"
	Trial         = "trl"
	// P2 (API_SPEC §1.1 delta). Share cards use shc_ + the upper-cased 10-character short ID;
	// game sessions are bare UUIDs on the wire; clips use the clip-pipeline ID (KL-0007).
	Squad      = "sqd"
	ShareCard  = "shc"
	Rating     = "rtg"
	ReviewTask = "rvt"
	Debrief    = "dbf"
	XPEntry    = "xpl"
)

// New returns a fresh UUIDv7.
func New() uuid.UUID {
	id, err := uuid.NewV7()
	if err != nil {
		// NewV7 only fails if the system random source fails.
		panic(fmt.Sprintf("ids: uuid v7: %v", err))
	}
	return id
}

// Deterministic returns a stable UUID (v8 layout) derived from a name, for idempotent seeds.
func Deterministic(name string) uuid.UUID {
	sum := sha256.Sum256([]byte("margdarshak-seed:" + name))
	var id uuid.UUID
	copy(id[:], sum[:16])
	id[6] = (id[6] & 0x0f) | 0x80 // version 8
	id[8] = (id[8] & 0x3f) | 0x80 // RFC 4122 variant
	return id
}

// Encode renders id as "<prefix>_<26 Crockford base32 chars>".
func Encode(prefix string, id uuid.UUID) string {
	return prefix + "_" + ulid.ULID(id).String()
}

// Decode parses a prefixed ID. The prefix must match.
func Decode(prefix, s string) (uuid.UUID, error) {
	p, rest, ok := strings.Cut(s, "_")
	if !ok || p != prefix {
		return uuid.Nil, fmt.Errorf("ids: want %s_ prefix", prefix)
	}
	u, err := ulid.ParseStrict(rest)
	if err != nil {
		return uuid.Nil, fmt.Errorf("ids: %w", err)
	}
	return uuid.UUID(u), nil
}
