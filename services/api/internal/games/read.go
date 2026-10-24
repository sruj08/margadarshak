package games

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Session reads a session with its items in the tenant's transaction (RLS hides other tenants).
// It does no ownership check: the HTTP layer compares the subject (the account holder may read a
// family member's session). The Store has only the locking read, so the row lock is held for
// this short transaction.
func (s *Service) Session(ctx context.Context, tenant string, id uuid.UUID) (*Session, error) {
	var out *Session
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		sess, err := s.Store.GetSessionForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		out = sess
		return nil
	})
	if errors.Is(err, ErrNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return out, nil
}

// RecordReplay records a replay exposure for every clip of a session whose final windows the
// replay endpoint has revealed. Clips already exposed (the mock itself, at start) keep their
// first exposure; the call is idempotent.
func (s *Service) RecordReplay(ctx context.Context, sess *Session) error {
	ids := clipIDs(sess.Items)
	if len(ids) == 0 {
		return nil
	}
	now := s.Clock.Now().UTC()
	ex := make([]Exposure, len(ids))
	for i, id := range ids {
		ex[i] = Exposure{ClipID: id, Via: ViaReplay, SessionID: sess.ID, At: now}
	}
	return s.DB.Tenant(ctx, sess.Subject.Tenant, func(tx pgx.Tx) error {
		return s.Store.RecordExposures(ctx, tx, sess.Subject, ex)
	})
}
