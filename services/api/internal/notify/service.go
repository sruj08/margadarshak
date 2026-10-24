// Package notify records and sends notifications (MD-042, E-13). Every send writes a
// msg.notifications row keyed by a deterministic idempotency key: queued -> sent | failed |
// suppressed_opt_out | disabled_until_dlt (later delivered / read from n8n receipts, API-66).
// The recipient address is decrypted only in memory for the send and is never stored in E-13 or
// logged in clear.
package notify

import (
	"context"
	"log/slog"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// Request is one notification to send.
type Request struct {
	Tenant           string
	ApplicantID      *uuid.UUID
	ContactID        *uuid.UUID
	OptedOutChannels []string
	Channel          string
	TemplateID       string
	Language         string
	To               string
	// Vars are rendered into the message (may include secrets such as a magic link).
	Vars map[string]string
	// StoredVars are persisted in E-13 (never secrets, never C3 data).
	StoredVars     map[string]any
	IdempotencyKey string
}

// Result is the recorded outcome.
type Result struct {
	NotificationID string
	Status         string
	Duplicate      bool
}

// Service sends through a NotificationPort and records E-13.
type Service struct {
	DB  *store.DB
	Log *slog.Logger
}

// Send records and sends r through port. A duplicate idempotency key does not send again.
func (s *Service) Send(ctx context.Context, port ports.NotificationPort, r Request) (Result, error) {
	n := &store.Notification{ID: ids.New(), TenantID: r.Tenant, ApplicantID: r.ApplicantID, ContactID: r.ContactID,
		Channel: r.Channel, TemplateID: r.TemplateID, TemplateVars: r.StoredVars, Status: ports.DeliveryQueued, IdempotencyKey: r.IdempotencyKey}
	if slices.Contains(r.OptedOutChannels, r.Channel) {
		n.Status = ports.DeliveryOptedOut // EC-30: STOP honoured, nothing sent
	}
	var created bool
	if err := s.DB.Tenant(ctx, r.Tenant, func(tx pgx.Tx) error {
		var err error
		created, err = store.InsertNotification(ctx, tx, n)
		return err
	}); err != nil {
		return Result{}, err
	}
	res := Result{NotificationID: ids.Encode(ids.Notification, n.ID), Status: n.Status, Duplicate: !created}
	if !created || n.Status == ports.DeliveryOptedOut {
		return res, nil
	}
	dr, sendErr := port.Send(ctx, ports.Message{IdempotencyKey: r.IdempotencyKey, Channel: r.Channel, TemplateID: r.TemplateID,
		Language: r.Language, To: r.To, Vars: r.Vars})
	status := dr.Status
	if status == "" {
		status = ports.DeliveryFailed
	}
	var provider, providerID, errCode *string
	if dr.Provider != "" {
		provider = &dr.Provider
	}
	if dr.ProviderMessageID != "" {
		providerID = &dr.ProviderMessageID
	}
	if sendErr != nil {
		code := string(ports.KindOf(sendErr))
		errCode = &code
		s.Log.WarnContext(ctx, "notification not sent", "channel", r.Channel, "template", r.TemplateID, "status", status, "kind", code)
	}
	if err := s.DB.Tenant(context.WithoutCancel(ctx), r.Tenant, func(tx pgx.Tx) error {
		return store.UpdateNotificationStatus(ctx, tx, n.ID, status, provider, providerID, errCode)
	}); err != nil {
		return res, err
	}
	res.Status = status
	return res, sendErr
}
