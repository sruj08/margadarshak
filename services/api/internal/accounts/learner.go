package accounts

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/learner"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// LearnerOf is the holder's own learner.Subject (no family member). Account is true for a
// signed-in account (Kind "account"), false for an anonymous device session.
func LearnerOf(p *Principal) learner.Subject {
	band := ""
	switch p.UserBand {
	case "u18", "adult":
		band = p.UserBand
	}
	return learner.Subject{Tenant: p.Tenant, ApplicantID: p.ApplicantID, UserBand: band, Minor: p.UserBand == "u18", Account: p.Kind == "account"}
}

// ResolveLearner returns the subject a learning or game request acts for (plan §2.1).
// memberID is the wire family_member_id (fam_...) or "" for the holder. It wraps
// RequireMemberAllowed: a minor member without the parent's recorded consent is
// learner.ErrParentConsentRequired (403 PARENT_CONSENT_REQUIRED); a member that is malformed or
// not the caller's is learner.ErrUnknownMember (404).
func ResolveLearner(ctx context.Context, tx pgx.Tx, p *Principal, memberID string) (learner.Subject, error) {
	s := LearnerOf(p)
	if memberID == "" {
		return s, nil
	}
	mid, err := ids.Decode(ids.FamilyMember, memberID)
	if err != nil {
		return learner.Subject{}, learner.ErrUnknownMember
	}
	m, err := store.GetFamilyMember(ctx, tx, p.ApplicantID, mid)
	if errors.Is(err, store.ErrNotFound) {
		return learner.Subject{}, learner.ErrUnknownMember
	}
	if err != nil {
		return learner.Subject{}, fmt.Errorf("accounts: family member: %w", err)
	}
	if err := RequireMemberAllowed(ctx, tx, p.ApplicantID, mid); err != nil {
		return learner.Subject{}, err
	}
	s.MemberID = &mid
	s.Minor = m.IsMinor
	s.UserBand = "adult"
	if m.IsMinor {
		s.UserBand = "u18"
	}
	return s, nil
}

// HasParentalExtra reports whether the parent granted extra ("squads" | "share_cards" |
// "pair_mode") for the subject. Adults always have it; a minor holder without a family-member
// row never does.
func HasParentalExtra(ctx context.Context, tx pgx.Tx, s learner.Subject, extra string) (bool, error) {
	if !slices.Contains(learner.Extras, extra) {
		return false, fmt.Errorf("%w: %q", learner.ErrUnknownExtra, extra)
	}
	if !s.Minor {
		return true, nil
	}
	if s.MemberID == nil {
		return false, nil
	}
	extras, err := store.ParentalExtras(ctx, tx, s.ApplicantID, *s.MemberID)
	if err != nil {
		return false, err
	}
	return slices.Contains(extras, extra), nil
}

// RequireExtra is HasParentalExtra as a gate: learner.ErrParentConsentRequired when a minor
// lacks the extra.
func RequireExtra(ctx context.Context, tx pgx.Tx, s learner.Subject, extra string) error {
	ok, err := HasParentalExtra(ctx, tx, s, extra)
	if err != nil {
		return err
	}
	if !ok {
		return learner.ErrParentConsentRequired
	}
	return nil
}
