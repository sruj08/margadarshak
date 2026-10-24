package accounts

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/mail"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/audit"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/notify"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// DeviceInfo is the anonymous device registration (no PII).
type DeviceInfo struct {
	Platform        string
	AppVersion      string
	DevicePublicKey string
}

// Session is a newly issued session.
type Session struct {
	Token     string
	Principal Principal
}

// CreateDeviceSession registers an anonymous device (API-06).
func (s *Service) CreateDeviceSession(ctx context.Context, tenant string, d DeviceInfo) (*Session, error) {
	now := s.now()
	app := &store.Applicant{ID: ids.New(), TenantID: tenant, Kind: "device"}
	token, hash := s.newToken()
	sess := &store.Session{ID: ids.New(), TenantID: tenant, ApplicantID: app.ID, Scope: "anon", TokenHash: hash,
		Platform: strPtr(d.Platform), AppVersion: strPtr(d.AppVersion), DevicePublicKey: strPtr(d.DevicePublicKey),
		CreatedAt: now, ExpiresAt: now.Add(s.SessionTTL)}
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		if err := store.InsertApplicant(ctx, tx, app); err != nil {
			return err
		}
		return store.InsertSession(ctx, tx, sess)
	})
	if err != nil {
		return nil, err
	}
	return &Session{Token: token, Principal: Principal{SessionID: sess.ID, ApplicantID: app.ID, Tenant: tenant, Scope: "anon",
		Kind: "device", UserBand: "unknown", ExpiresAt: sess.ExpiresAt}}, nil
}

// Authenticate resolves a cookie or bearer token within the request tenant. A session of
// another tenant is invisible under RLS and so fails like an unknown token.
func (s *Service) Authenticate(ctx context.Context, tenant, token string) (*Principal, error) {
	hash, ok := s.tokenHash(token)
	if !ok {
		return nil, ErrUnauthenticated
	}
	var p *Principal
	now := s.now()
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		sess, err := store.SessionByTokenHash(ctx, tx, hash, now)
		if err != nil {
			return err
		}
		app, err := store.GetApplicant(ctx, tx, sess.ApplicantID)
		if err != nil {
			return err
		}
		if app.DeletedAt != nil || app.MergedInto != nil {
			return store.ErrNotFound
		}
		if err := store.TouchSession(ctx, tx, sess.ID, now, s.SessionTTL); err != nil {
			return err
		}
		p = &Principal{SessionID: sess.ID, ApplicantID: app.ID, Tenant: tenant, Scope: sess.Scope, Kind: app.Kind,
			UserBand: app.UserBand, AgeBand: app.AgeBand, ExpiresAt: sess.ExpiresAt}
		return nil
	})
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrUnauthenticated
	}
	return p, err
}

// RequestMagicLink e-mails a single-use sign-in link bound to the device session (API-07).
// The response is identical whether or not the address is known (no enumeration). Limits:
// 5 per hour per address and 20 per hour per IP (brute-force protection).
func (s *Service) RequestMagicLink(ctx context.Context, tenant string, sender ports.NotificationPort, device *Principal, email, lang, ip string) error {
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != strings.TrimSpace(email) || len(email) > 254 {
		return &ValidationError{Pointer: "/email", Code: "invalid_email"}
	}
	norm := privacy.NormalizeContact("email", addr.Address)
	blind := s.Vault.BlindIndex(tenant, "email", norm)
	for _, lim := range []struct {
		key   string
		limit int
	}{{"ml:email:" + base64.RawURLEncoding.EncodeToString(blind[:12]), 5}, {"ml:ip:" + audit.TruncateIP(ip), 20}} {
		d, err := s.Limiter.Allow(ctx, tenant+":"+lim.key, lim.limit, time.Hour)
		if err != nil {
			return err
		}
		if !d.Allowed {
			return &RateLimitedError{RetryAfter: d.RetryAfter}
		}
	}
	code := randomCode("ml_")
	emailEnc, err := s.Vault.EncryptString(tenant, "magic_links.email", norm)
	if err != nil {
		return err
	}
	link := &store.MagicLink{ID: ids.New(), TenantID: tenant, CodeHash: hashToken(code), EmailEnc: emailEnc, EmailBlindIndex: blind,
		Language: strPtr(lang), ExpiresAt: s.now().Add(s.MagicTTL)}
	if device != nil {
		link.DeviceSessionID = &device.SessionID
	}
	if err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error { return store.InsertMagicLink(ctx, tx, link) }); err != nil {
		return err
	}
	var applicant *uuid.UUID
	if device != nil {
		applicant = &device.ApplicantID
	}
	if lang == "" {
		lang = "en"
	}
	_, err = s.Notify.Send(ctx, sender, notify.Request{
		Tenant: tenant, ApplicantID: applicant, Channel: "email", TemplateID: "auth.magic_link", Language: lang, To: norm,
		Vars:           map[string]string{"link": strings.TrimRight(s.WebBaseURL, "/") + "/auth/magic?code=" + code, "ttl_minutes": strconv.Itoa(int(s.MagicTTL.Minutes()))},
		StoredVars:     map[string]any{"ttl_minutes": int(s.MagicTTL.Minutes())},
		IdempotencyKey: "magic_link:" + link.ID.String() + ":email",
	})
	if err != nil && ports.KindOf(err) != "" {
		// Delivery failure is recorded in E-13; the API still answers 202 (no enumeration).
		s.Log.WarnContext(ctx, "magic link delivery failed", "kind", string(ports.KindOf(err)))
		return nil
	}
	return err
}

// identity is a verified sign-in identity.
type identity struct {
	subjectPurpose string // auth:email | auth:google
	subject        string
	email          string
}

// ExchangeMagicLink redeems a code (API-08 grant_type=magic_link).
func (s *Service) ExchangeMagicLink(ctx context.Context, tenant, code string, current *Principal) (*Session, error) {
	var email string
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		link, err := store.ConsumeMagicLink(ctx, tx, hashToken(code), s.now())
		if err != nil {
			return err
		}
		email, err = s.Vault.DecryptString(tenant, "magic_links.email", link.EmailEnc)
		return err
	})
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrInvalidCode
	}
	if err != nil {
		return nil, err
	}
	return s.signIn(ctx, tenant, identity{subjectPurpose: "auth:email", subject: email, email: email}, current, "magic_link")
}

// ExchangeGoogle verifies a Google ID token (API-08 grant_type=google_id_token).
func (s *Service) ExchangeGoogle(ctx context.Context, tenant, idToken string, current *Principal) (*Session, error) {
	id, err := s.Google.Verify(ctx, idToken)
	if err != nil {
		return nil, err
	}
	if !id.EmailVerified || id.Email == "" {
		return nil, ErrInvalidCode
	}
	return s.signIn(ctx, tenant, identity{subjectPurpose: "auth:google", subject: id.Subject, email: id.Email}, current, "google")
}

// signIn finds or creates the account, merges the current device's data into it (the case
// created anonymously survives sign-up), stores the e-mail contact encrypted and rotates the
// session token.
func (s *Service) signIn(ctx context.Context, tenant string, id identity, current *Principal, method string) (*Session, error) {
	now := s.now()
	subjectHash := s.Vault.Keyed(tenant, id.subjectPurpose, privacy.NormalizeContact("email", id.subject))
	if id.subjectPurpose == "auth:google" {
		subjectHash = s.Vault.Keyed(tenant, id.subjectPurpose, id.subject)
	}
	token, hash := s.newToken()
	var out Principal
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		account, err := store.GetApplicantBySubject(ctx, tx, subjectHash)
		switch {
		case err == nil:
			if current != nil && current.Kind == "device" && current.ApplicantID != account.ID {
				if _, err := store.MergeDeviceInto(ctx, tx, current.ApplicantID, account.ID); err != nil {
					return err
				}
			}
		case errors.Is(err, store.ErrNotFound):
			if current != nil && current.Kind == "device" {
				if err := store.UpgradeToAccount(ctx, tx, current.ApplicantID, subjectHash); err != nil {
					return err
				}
				account, err = store.GetApplicant(ctx, tx, current.ApplicantID)
				if err != nil {
					return err
				}
			} else {
				account = &store.Applicant{ID: ids.New(), TenantID: tenant, Kind: "account", AuthSubjectHash: subjectHash, UserBand: "adult"}
				if err := store.InsertApplicant(ctx, tx, account); err != nil {
					return err
				}
			}
		default:
			return err
		}
		enc, err := s.Vault.EncryptString(tenant, "contacts.value", privacy.NormalizeContact("email", id.email))
		if err != nil {
			return err
		}
		if err := store.UpsertContact(ctx, tx, &store.Contact{ID: ids.New(), TenantID: tenant, ApplicantID: account.ID, Kind: "email",
			ValueEnc: enc, BlindIndex: s.Vault.BlindIndex(tenant, "email", id.email)}); err != nil {
			return err
		}
		if current != nil {
			if err := store.RevokeSession(ctx, tx, current.SessionID, "rotated_on_sign_in"); err != nil {
				return err
			}
		}
		sess := &store.Session{ID: ids.New(), TenantID: tenant, ApplicantID: account.ID, Scope: "user", TokenHash: hash, CreatedAt: now, ExpiresAt: now.Add(s.SessionTTL)}
		if err := store.InsertSession(ctx, tx, sess); err != nil {
			return err
		}
		out = Principal{SessionID: sess.ID, ApplicantID: account.ID, Tenant: tenant, Scope: "user", Kind: "account",
			UserBand: account.UserBand, AgeBand: account.AgeBand, ExpiresAt: sess.ExpiresAt}
		_, err = audit.Append(ctx, tx, now, audit.Entry{Tenant: tenant, Actor: out.Subject(), ActorScope: "user", Action: "auth.sign_in",
			Target: out.Subject(), Meta: map[string]any{"method": method, "merged_device": current != nil && current.Kind == "device"}})
		return err
	})
	if err != nil {
		return nil, err
	}
	return &Session{Token: token, Principal: out}, nil
}

// Logout revokes the current session, or every session of the applicant (API-09).
func (s *Service) Logout(ctx context.Context, p *Principal, all bool) error {
	return s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		if all {
			n, err := store.RevokeAllSessions(ctx, tx, p.ApplicantID, "sign_out_everywhere")
			if err != nil {
				return err
			}
			_, err = audit.Append(ctx, tx, s.now(), audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope,
				Action: "auth.sign_out_everywhere", Target: p.Subject(), Meta: map[string]any{"sessions": n}})
			return err
		}
		return store.RevokeSession(ctx, tx, p.SessionID, "logout")
	})
}

// ---- Google OIDC -----------------------------------------------------------------------------

// GoogleIdentity is a verified Google account.
type GoogleIdentity struct {
	Subject       string
	Email         string
	EmailVerified bool
}

// GoogleVerifier verifies a Google ID token (aud, iss, exp, nonce and JWKS signature in the
// real implementation).
type GoogleVerifier interface {
	Verify(ctx context.Context, idToken string) (GoogleIdentity, error)
}

// UnconfiguredGoogle rejects every token (production until GOOGLE_CLIENT_ID and the JWKS
// verifier are wired; the real verifier is not part of this build).
type UnconfiguredGoogle struct{}

// Verify implements GoogleVerifier.
func (UnconfiguredGoogle) Verify(context.Context, string) (GoogleIdentity, error) {
	return GoogleIdentity{}, ErrGoogleNotConfigured
}

// StubGoogle accepts dev tokens "stub.<base64url JSON {sub,email,email_verified}>". Dev and
// test only: never enabled when APP_ENV is staging, production or field.
type StubGoogle struct{}

// Verify implements GoogleVerifier.
func (StubGoogle) Verify(_ context.Context, idToken string) (GoogleIdentity, error) {
	payload, ok := strings.CutPrefix(idToken, "stub.")
	if !ok {
		return GoogleIdentity{}, ErrInvalidCode
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return GoogleIdentity{}, ErrInvalidCode
	}
	var c struct {
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
	}
	if err := json.Unmarshal(raw, &c); err != nil || c.Sub == "" {
		return GoogleIdentity{}, ErrInvalidCode
	}
	return GoogleIdentity{Subject: c.Sub, Email: c.Email, EmailVerified: c.EmailVerified}, nil
}

// StubGoogleToken builds a dev token for StubGoogle.
func StubGoogleToken(sub, email string) string {
	b, _ := json.Marshal(map[string]any{"sub": sub, "email": email, "email_verified": true})
	return "stub." + base64.RawURLEncoding.EncodeToString(b)
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ErrNotSynthetic is returned when a persona session is asked for a real account.
var ErrNotSynthetic = errors.New("accounts: persona sessions are only issued for synthetic seed accounts")

// PersonaSession issues an account session for a synthetic seed persona (demo tenant persona
// switcher, MD-122). It refuses any applicant without the "synthetic" flag; the HTTP layer also
// refuses it outside dev/test and on tenants without the persona_switcher feature.
func (s *Service) PersonaSession(ctx context.Context, tenant string, applicant uuid.UUID) (*Session, error) {
	now := s.now()
	token, hash := s.newToken()
	var out Principal
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		a, err := store.GetApplicant(ctx, tx, applicant)
		if err != nil {
			return err
		}
		synthetic := false
		for _, f := range a.Flags {
			if f == "synthetic" {
				synthetic = true
			}
		}
		if !synthetic || a.Kind != "account" || a.DeletedAt != nil {
			return ErrNotSynthetic
		}
		// Synthetic clip-admin personas (P2, API-55) carry the admin flag and get the admin scope.
		scope := "user"
		if slices.Contains(a.Flags, "admin") {
			scope = "admin"
		}
		sess := &store.Session{ID: ids.New(), TenantID: tenant, ApplicantID: a.ID, Scope: scope, TokenHash: hash, CreatedAt: now, ExpiresAt: now.Add(s.SessionTTL)}
		if err := store.InsertSession(ctx, tx, sess); err != nil {
			return err
		}
		out = Principal{SessionID: sess.ID, ApplicantID: a.ID, Tenant: tenant, Scope: scope, Kind: "account", UserBand: a.UserBand, AgeBand: a.AgeBand, ExpiresAt: sess.ExpiresAt}
		_, err = audit.Append(ctx, tx, now, audit.Entry{Tenant: tenant, Actor: out.Subject(), ActorScope: "user", Action: "auth.persona_session", Target: out.Subject(),
			Meta: map[string]any{"synthetic": true}})
		return err
	})
	if err != nil {
		return nil, err
	}
	return &Session{Token: token, Principal: out}, nil
}
