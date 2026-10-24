// Package learner resolves who a learning or game request acts for (plan §2.1): the account or
// device holder, or a family member inside the account (family mode, D-13 revised). Every P2
// package (games, learn, gamify, clips, study) keys its rows by this Subject:
// tenant_id, applicant_id, family_member_id NULL.
//
// A minor family member needs the parent's recorded consent before any row is written
// (accounts.RequireMemberAllowed, 403 PARENT_CONSENT_REQUIRED). Squads, share cards and pair mode
// for a minor also need the matching parental extra (core.family_members.parental_extras).
//
// This package is a leaf (no store or accounts import) so the domain packages and
// internal/store can both use Subject. The resolution itself (principal + family_member_id ->
// Subject, wrapping RequireMemberAllowed) and the extras gate live in internal/accounts
// (accounts.ResolveLearner, accounts.RequireExtra): an import here would close the cycle
// store -> games -> learner -> store.
package learner

import (
	"errors"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// Parental extras (core.family_members.parental_extras; ParentalConsentChange.extras).
const (
	ExtraSquads     = "squads"
	ExtraShareCards = "share_cards"
	ExtraPairMode   = "pair_mode"
)

// Extras is the closed set of parental extras.
var Extras = []string{ExtraSquads, ExtraShareCards, ExtraPairMode}

// Errors.
var (
	// ErrParentConsentRequired is privacy.ErrParentalConsentRequired (403 PARENT_CONSENT_REQUIRED).
	ErrParentConsentRequired = privacy.ErrParentalConsentRequired
	// ErrUnknownMember is a family_member_id that is malformed or not the caller's (404).
	ErrUnknownMember = errors.New("learner: unknown family member")
	// ErrUnknownExtra is an extra outside Extras (a programming error).
	ErrUnknownExtra = errors.New("learner: unknown parental extra")
)

// Subject is whose learning and game data a request touches.
type Subject struct {
	Tenant      string
	ApplicantID uuid.UUID
	MemberID    *uuid.UUID
	// UserBand is "u18" | "adult" (derived server-side from the DOB band; never the DOB). Empty
	// for an anonymous device session whose band is unknown (games then treat it as adult).
	UserBand string
	// Minor is true for a family member under 18 (and for a holder whose band is u18).
	Minor bool
	// Account is true when the holder signed in (Principal.Kind == "account"), false for an
	// anonymous device session. Squads and share cards need an account.
	Account bool
}

// Key identifies the subject in caches and in-memory stores.
func (s Subject) Key() string {
	k := s.Tenant + "/" + s.ApplicantID.String()
	if s.MemberID != nil {
		k += "/" + s.MemberID.String()
	}
	return k
}

// Same reports whether two subjects are the same person.
func (s Subject) Same(o Subject) bool {
	if s.Tenant != o.Tenant || s.ApplicantID != o.ApplicantID || (s.MemberID == nil) != (o.MemberID == nil) {
		return false
	}
	return s.MemberID == nil || *s.MemberID == *o.MemberID
}

// MemberRef is the wire form of the family member (fam_...), or "".
func (s Subject) MemberRef() string {
	if s.MemberID == nil {
		return ""
	}
	return ids.Encode(ids.FamilyMember, *s.MemberID)
}
