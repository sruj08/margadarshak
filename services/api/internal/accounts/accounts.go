// Package accounts implements sessions and accounts (MD-048), age band + family mode +
// parental consent (MD-049, D-13 revised: no AI gating) and consent artefacts (E-15, API-60).
//
// Sessions: an anonymous device session (opaque 256-bit token, HMAC-signed, in the md_sid
// cookie; only its SHA-256 is stored) upgrades to an account by e-mail magic link (single use,
// 15 minutes) or Google sign-in. Upgrading keeps the device's cases. Accounts are held by
// adults; a learner under 18 is a family member inside a parent's account and needs the parent's
// recorded consent before a case is opened for them.
package accounts

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/hkdf"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/notify"
	"github.com/sruj08/margadarshak/services/api/internal/platform/ratelimit"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// Errors mapped to problem+json by the HTTP layer.
var (
	ErrUnauthenticated     = errors.New("accounts: unauthenticated")
	ErrForbidden           = errors.New("accounts: forbidden")
	ErrInvalidCode         = errors.New("accounts: sign-in code is invalid, used or expired")
	ErrHolderMustBeAdult   = errors.New("accounts: the account holder must be 18 or older; add the learner as a family member")
	ErrNotFound            = errors.New("accounts: not found")
	ErrGoogleNotConfigured = errors.New("accounts: Google sign-in is not configured")
	ErrParentConsent       = privacy.ErrParentalConsentRequired
)

// ValidationError points at an invalid field.
type ValidationError struct {
	Pointer string
	Code    string
	Detail  string
}

func (e *ValidationError) Error() string { return "accounts: invalid " + e.Pointer + ": " + e.Code }

// RateLimitedError carries Retry-After.
type RateLimitedError struct{ RetryAfter time.Duration }

func (e *RateLimitedError) Error() string { return "accounts: rate limited" }

// Principal is the authenticated caller.
type Principal struct {
	SessionID   uuid.UUID
	ApplicantID uuid.UUID
	Tenant      string
	Scope       string // anon | user | helper | ...
	Kind        string // device | account
	UserBand    string
	AgeBand     *string
	ExpiresAt   time.Time
}

// Subject is the pseudonymous id shown on the wire (dev_... or usr_...).
func (p *Principal) Subject() string {
	if p.Kind == "account" {
		return ids.Encode(ids.User, p.ApplicantID)
	}
	return ids.Encode(ids.Device, p.ApplicantID)
}

// Service is the accounts application service.
type Service struct {
	DB            *store.DB
	Vault         *privacy.Vault
	Clock         servertime.Clock
	Notify        *notify.Service
	Log           *slog.Logger
	Limiter       ratelimit.Limiter
	Google        GoogleVerifier
	SessionSecret []byte
	SessionTTL    time.Duration
	MagicTTL      time.Duration
	WebBaseURL    string

	consentKey ed25519.PrivateKey
}

// Init derives keys; call once after construction.
func (s *Service) Init() error {
	seed := make([]byte, ed25519.SeedSize)
	if _, err := io.ReadFull(hkdf.New(sha256.New, s.SessionSecret, nil, []byte("margdarshak:consent-signing:v1")), seed); err != nil {
		return err
	}
	s.consentKey = ed25519.NewKeyFromSeed(seed)
	if s.SessionTTL == 0 {
		s.SessionTTL = 180 * 24 * time.Hour
	}
	if s.MagicTTL == 0 {
		s.MagicTTL = 15 * time.Minute
	}
	if s.Limiter == nil {
		s.Limiter = ratelimit.NewMemory()
	}
	if s.Google == nil {
		s.Google = UnconfiguredGoogle{}
	}
	return nil
}

// ConsentPublicKey is the key that verifies consent artefact signatures.
func (s *Service) ConsentPublicKey() ed25519.PublicKey {
	return s.consentKey.Public().(ed25519.PublicKey)
}

func (s *Service) now() time.Time { return s.Clock.Now() }

// newToken returns a signed opaque token ("<raw>.<sig>") and the hash stored server-side.
func (s *Service) newToken() (string, []byte) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	r := base64.RawURLEncoding.EncodeToString(raw)
	return r + "." + s.sign(r), hashToken(r)
}

func (s *Service) sign(raw string) string {
	m := hmac.New(sha256.New, s.SessionSecret)
	m.Write([]byte("md_sid:" + raw))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil)[:16])
}

// tokenHash verifies the signature and returns the lookup hash. Tampered or foreign tokens are
// rejected before any database work.
func (s *Service) tokenHash(value string) ([]byte, bool) {
	raw, sig, ok := strings.Cut(strings.TrimSpace(value), ".")
	if !ok || len(raw) != 43 || !hmac.Equal([]byte(sig), []byte(s.sign(raw))) {
		return nil, false
	}
	return hashToken(raw), true
}

func hashToken(raw string) []byte {
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}

func randomCode(prefix string) string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b)
}

func ed25519Sign(k ed25519.PrivateKey, msg []byte) []byte { return ed25519.Sign(k, msg) }
