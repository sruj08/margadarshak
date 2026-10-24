package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
)

func (s *Server) tokenPair(w http.ResponseWriter, r *http.Request, status int, sess *accounts.Session) {
	s.setSessionCookie(w, sess.Token, sess.Principal.ExpiresAt)
	band := gen.UserBand(sess.Principal.UserBand)
	out := gen.TokenPair{Scope: gen.TokenPairScope(sess.Principal.Scope), Subject: sess.Principal.Subject(), AgeBand: &band,
		ExpiresAt: sess.Principal.ExpiresAt.UTC()}
	// Non-browser clients ask for the token explicitly; browsers only ever get the HttpOnly cookie.
	if strings.Contains(r.Header.Get("Prefer"), "return=token") {
		tok := sess.Token
		out.SessionToken = &tok
	}
	writeJSON(w, status, out)
}

func (s *Server) accountError(w http.ResponseWriter, r *http.Request, err error) {
	var ve *accounts.ValidationError
	var rl *accounts.RateLimitedError
	switch {
	case errors.As(err, &ve):
		code := ve.Code
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Detail: ve.Detail,
			Errors: []FieldError{{Pointer: ve.Pointer, Code: code, MessageKey: "errors." + strings.ToLower(code)}}})
	case errors.As(err, &rl):
		writeProblem(w, r, Problem{Status: http.StatusTooManyRequests, Code: "RATE_LIMITED", Retryable: true, RetryAfter: rl.RetryAfter})
	case errors.Is(err, accounts.ErrUnauthenticated), errors.Is(err, accounts.ErrInvalidCode):
		writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Detail: "the sign-in link or token is invalid, used or expired"})
	case errors.Is(err, accounts.ErrGoogleNotConfigured):
		writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Detail: "Google sign-in is not configured on this server"})
	case errors.Is(err, accounts.ErrForbidden):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "FORBIDDEN", Detail: "this action needs a signed-in account"})
	case errors.Is(err, accounts.ErrHolderMustBeAdult):
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED",
			Detail: "Accounts are held by adults. Add a learner under 18 as a family member in a parent's account.",
			Errors: []FieldError{{Pointer: "/dob", Code: "ACCOUNT_HOLDER_MUST_BE_ADULT", MessageKey: "errors.account_holder_must_be_adult"}}})
	case errors.Is(err, accounts.ErrParentConsent):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "PARENT_CONSENT_REQUIRED",
			Detail: "This family member is under 18; the account holder must record parental consent first."})
	case errors.Is(err, accounts.ErrNotFound):
		notFound(w, r)
	default:
		s.deps.Log.ErrorContext(r.Context(), "accounts error", "err", err)
		internalError(w, r)
	}
}

// CreateDeviceSession is API-06.
func (s *Server) CreateDeviceSession(w http.ResponseWriter, r *http.Request, _ gen.CreateDeviceSessionParams) {
	var req gen.DeviceSessionRequest
	if !decodeJSON(w, r, &req, false) {
		return
	}
	switch req.Platform {
	case gen.AndroidWeb, gen.IosWeb, gen.DesktopWeb, gen.Pwa:
	default:
		validation(w, r, "/platform", "invalid_enum")
		return
	}
	if len(req.DevicePublicKey) < 16 || len(req.DevicePublicKey) > 200 {
		validation(w, r, "/device_public_key", "invalid_length")
		return
	}
	appVersion := ""
	if req.AppVersion != nil {
		if len(*req.AppVersion) > 32 {
			validation(w, r, "/app_version", "too_long")
			return
		}
		appVersion = *req.AppVersion
	}
	sess, err := s.deps.Accounts.CreateDeviceSession(r.Context(), tenantFrom(r.Context()).TenantID,
		accounts.DeviceInfo{Platform: string(req.Platform), AppVersion: appVersion, DevicePublicKey: req.DevicePublicKey})
	if err != nil {
		s.accountError(w, r, err)
		return
	}
	s.tokenPair(w, r, http.StatusCreated, sess)
}

// RequestMagicLink is API-07. Always 202 (no account enumeration) unless invalid or rate limited.
func (s *Server) RequestMagicLink(w http.ResponseWriter, r *http.Request, _ gen.RequestMagicLinkParams) {
	var req gen.MagicLinkRequest
	if !decodeJSON(w, r, &req, false) {
		return
	}
	lang := "en"
	if req.Language != nil {
		lang = string(*req.Language)
		if lang != "en" && lang != "hi" {
			validation(w, r, "/language", "invalid_enum")
			return
		}
	}
	t := tenantFrom(r.Context())
	err := s.deps.Accounts.RequestMagicLink(r.Context(), t.TenantID, t.Adapters.Notification, principalFrom(r.Context()),
		string(req.Email), lang, clientIP(r, s.deps.TrustProxy))
	if err != nil {
		s.accountError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, gen.Accepted{Status: gen.AcceptedStatusAccepted})
}

// ExchangeToken is API-08: magic-link code or Google ID token -> account session; the device
// session's data is merged and the md_sid cookie is rotated.
func (s *Server) ExchangeToken(w http.ResponseWriter, r *http.Request) {
	var req gen.TokenRequest
	if !decodeJSON(w, r, &req, false) {
		return
	}
	t := tenantFrom(r.Context())
	current := principalFrom(r.Context())
	var sess *accounts.Session
	var err error
	switch req.GrantType {
	case gen.MagicLink:
		if req.Code == nil || *req.Code == "" || len(*req.Code) > 128 {
			validation(w, r, "/code", "required")
			return
		}
		sess, err = s.deps.Accounts.ExchangeMagicLink(r.Context(), t.TenantID, *req.Code, current)
	case gen.GoogleIdToken:
		if req.IdToken == nil || *req.IdToken == "" || len(*req.IdToken) > 4096 {
			validation(w, r, "/id_token", "required")
			return
		}
		sess, err = s.deps.Accounts.ExchangeGoogle(r.Context(), t.TenantID, *req.IdToken, current)
	default:
		validation(w, r, "/grant_type", "invalid_enum")
		return
	}
	if err != nil {
		s.accountError(w, r, err)
		return
	}
	s.tokenPair(w, r, http.StatusOK, sess)
}

// Logout is API-09. clear_device also asks the browser to wipe storage (EC-14 shared phone).
func (s *Server) Logout(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ClearDevice bool `json:"clear_device"`
		AllSessions bool `json:"all_sessions"`
	}
	if !decodeJSON(w, r, &req, true) {
		return
	}
	p := principalFrom(r.Context())
	if err := s.deps.Accounts.Logout(r.Context(), p, req.AllSessions); err != nil {
		s.accountError(w, r, err)
		return
	}
	s.clearSessionCookie(w)
	if req.ClearDevice {
		w.Header().Set("Clear-Site-Data", `"cache", "storage"`)
	}
	w.WriteHeader(http.StatusNoContent)
}
