package clock

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	adnotify "github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
	"github.com/sruj08/margadarshak/services/api/internal/audit"
	"github.com/sruj08/margadarshak/services/api/internal/cases"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// channel is one deliverable route to the account holder.
type channel struct {
	channel   string
	to        string
	contactID *uuid.UUID
}

// purposeOf is the consent purpose a channel needs (E-15).
var purposeOf = map[string]string{"whatsapp": "whatsapp_updates", "email": "email_updates", "web_push": "web_push"}

// channels lists the account holder's deliverable channels, preferred first: WhatsApp, e-mail,
// web push. A channel needs an active consent for its purpose, a contact, and no opt-out (STOP,
// EC-30). Reminders for a family member's case go to the account holder (family mode).
func (s *Service) channels(ctx context.Context, tx pgx.Tx, tenant string, applicant uuid.UUID) ([]channel, error) {
	consents, err := store.ListConsents(ctx, tx, applicant)
	if err != nil {
		return nil, err
	}
	now := s.now()
	active := map[string]bool{}
	for _, c := range consents {
		if c.RevokedAt == nil && (c.ExpiresAt == nil || c.ExpiresAt.After(now)) && c.SubjectMemberID == nil {
			active[c.Purpose] = true
		}
	}
	contacts, err := store.ContactsFor(ctx, tx, applicant)
	if err != nil {
		return nil, err
	}
	var out []channel
	for _, ch := range []string{"whatsapp", "email", "web_push"} {
		if !active[purposeOf[ch]] {
			continue
		}
		if ch == "web_push" {
			out = append(out, channel{channel: ch})
			continue
		}
		kind := "phone"
		if ch == "email" {
			kind = "email"
		}
		for _, c := range contacts {
			if c.Kind != kind || slices.Contains(c.OptedOutChannels, ch) {
				continue
			}
			v, err := s.Vault.DecryptString(tenant, "contacts.value", c.ValueEnc)
			if err != nil {
				return nil, err
			}
			id := c.ID
			out = append(out, channel{channel: ch, to: v, contactID: &id})
			break
		}
	}
	return out, nil
}

func (s *Service) contactValue(ctx context.Context, tx pgx.Tx, tenant string, id uuid.UUID) (string, error) {
	var enc []byte
	if err := tx.QueryRow(ctx, `SELECT value_enc FROM privacy.contacts WHERE contact_id = $1`, id).Scan(&enc); err != nil {
		return "", err
	}
	return s.Vault.DecryptString(tenant, "contacts.value", enc)
}

// deliver sends committed notifications: WhatsApp in one W02 envelope per tenant, e-mail through
// the e-mail sender, web push through the push sender. It records each outcome in E-13 and
// reports how many left, how many failed, and whether a failure is worth a retry.
func (s *Service) deliver(ctx context.Context, event, eventID string, list []pending) (delivered, failed int, retryable bool) {
	byTenant := map[string][]pending{}
	for _, p := range list {
		if p.n.Channel == "whatsapp" {
			byTenant[p.tenant] = append(byTenant[p.tenant], p)
			continue
		}
		var port ports.NotificationPort
		switch p.n.Channel {
		case "email":
			port = s.Email
		case "web_push":
			port = s.WebPush
		}
		if port == nil {
			port = adnotify.Pending{Provider: p.n.Channel}
		}
		dr, err := port.Send(ctx, ports.Message{IdempotencyKey: p.n.IdempotencyKey, Channel: p.n.Channel, TemplateID: p.n.TemplateID,
			Language: p.lang, To: p.to, Vars: p.vars})
		s.record(ctx, p, dr.Status, dr.Provider, dr.ProviderMessageID, err)
		switch {
		case err != nil:
			failed++
			k := ports.KindOf(err)
			retryable = retryable || k == ports.KindUnavailable || k == ports.KindTimeout
		default:
			delivered++
		}
	}
	for tenant, ps := range byTenant {
		msgs := make([]adnotify.OutboundMessage, 0, len(ps))
		for _, p := range ps {
			msgs = append(msgs, adnotify.OutboundMessage{NotificationID: ids.Encode(ids.Notification, p.n.ID), IdempotencyKey: p.n.IdempotencyKey,
				Channel: "whatsapp", TemplateID: p.n.TemplateID, Lang: langOr(p.lang), To: p.to, Vars: p.vars})
		}
		err := s.N8n.Send(ctx, adnotify.EnvelopePayload{Event: event, EventID: eventID, Tenant: tenant, Messages: msgs})
		for _, p := range ps {
			status := ports.DeliveryQueued // n8n queued it; W02 receipts move it to sent / delivered / read
			if !s.N8n.Configured() {
				status = ports.DeliverySent
			}
			if err != nil {
				status = ports.DeliveryFailed
			}
			s.record(ctx, p, status, s.N8n.Provider(), "", err)
			if err != nil {
				failed++
				k := ports.KindOf(err)
				retryable = retryable || k == ports.KindUnavailable || k == ports.KindTimeout
			} else {
				delivered++
			}
		}
	}
	return delivered, failed, retryable
}

func langOr(l string) string {
	if l == "hi" {
		return "hi"
	}
	return "en"
}

func (s *Service) record(ctx context.Context, p pending, status, provider, msgID string, sendErr error) {
	if status == "" {
		status = ports.DeliveryFailed
	}
	var prov, mid, code *string
	if provider != "" {
		prov = &provider
	}
	if msgID != "" {
		mid = &msgID
	}
	if sendErr != nil {
		k := string(ports.KindOf(sendErr))
		if k == "" {
			k = "error"
		}
		code = &k
	}
	if err := s.DB.Tenant(context.WithoutCancel(ctx), p.tenant, func(tx pgx.Tx) error {
		return store.UpdateNotificationStatus(ctx, tx, p.n.ID, status, prov, mid, code)
	}); err != nil {
		s.Log.WarnContext(ctx, "notification status write failed", "err", err)
	}
	p.n.Status = status
}

// ---- One-off sends (API-04 plan card, API-15 milestones, STOP confirmation) -------------------

// transactional records and sends a transactional message on the first deliverable channel
// (not a nudge: no daily cap; quiet hours still apply, EC-30 opt-outs always apply).
func (s *Service) transactional(ctx context.Context, tenant string, applicant uuid.UUID, keyBase, template string, vars map[string]string) (*store.Notification, error) {
	now := s.now()
	var p *pending
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		app, err := store.GetApplicant(ctx, tx, applicant)
		if err != nil {
			return err
		}
		if app.DeletedAt != nil {
			return nil
		}
		chans, err := s.channels(ctx, tx, tenant, applicant)
		if err != nil || len(chans) == 0 {
			return err
		}
		ch := chans[0]
		stored := map[string]any{}
		for k, v := range vars {
			stored[k] = v
		}
		n := &store.Notification{ID: ids.New(), TenantID: tenant, ApplicantID: &applicant, ContactID: ch.contactID, Channel: ch.channel,
			TemplateID: template, TemplateVars: stored, Status: ports.DeliveryQueued, IdempotencyKey: keyBase + ":" + ch.channel, Kind: "transactional"}
		if InQuietHours(now, app.QuietHours) {
			n.Status = "suppressed_quiet_hours"
		}
		created, err := store.InsertNotification(ctx, tx, n)
		if err != nil || !created || n.Status != ports.DeliveryQueued {
			return err
		}
		p = &pending{tenant: tenant, n: n, to: ch.to, lang: app.Language, vars: vars}
		return nil
	})
	if err != nil || p == nil {
		return nil, err
	}
	s.deliver(ctx, "transactional", keyBase, []pending{*p})
	return p.n, nil
}

// OnCaseEvent sends the W02 real-time milestone message for some client events (LL issued,
// payment pending, test result, approval). Test results carry no outcome words in the template
// preview (MD-131).
func (s *Service) OnCaseEvent(ctx context.Context, n cases.EventNotice) {
	templates := map[string]string{"ll_issued": "milestone_ll_issued_v1", "payment_pending": "milestone_payment_pending_v1",
		"test_failed": "milestone_test_result_v1", "test_passed": "milestone_test_result_v1", "approved": "milestone_approved_v1"}
	tpl, ok := templates[n.Event]
	if !ok {
		return
	}
	vars := map[string]string{"link": strings.TrimRight(s.WebBaseURL, "/") + "/case"}
	if _, err := s.transactional(ctx, n.Tenant, n.ApplicantID, fmt.Sprintf("%s:event:%d", n.CaseRef, n.Seq), tpl, vars); err != nil {
		s.Log.WarnContext(ctx, "milestone message failed", "event", n.Event, "err", err)
	}
}

// PlanCardResult is the API-04 answer.
type PlanCardResult struct {
	NotificationID string
	Status         string
	Channel        string
	TemplateID     string
	PlanURL        string
	ShareURL       string
}

// ErrConsentRequired is returned when the user did not opt in.
var ErrConsentRequired = errors.New("clock: consent required")

// SendPlanCard is API-04 (MD-104): the opted-in user's phone is stored encrypted (E-14), a
// whatsapp_updates consent artefact is recorded, and the approved plan_card_v1 template goes to
// n8n. Without consent nothing is stored; the client uses the wa.me share link instead.
func (s *Service) SendPlanCard(ctx context.Context, p *accounts.Principal, tenant, planRef, phone, notice, lang string, granted bool) (*PlanCardResult, error) {
	planURL := strings.TrimRight(s.WebBaseURL, "/") + "/plan/" + planRef
	res := &PlanCardResult{Channel: "whatsapp", TemplateID: "plan_card_v1", PlanURL: planURL,
		ShareURL: "https://wa.me/?text=" + url.QueryEscape("My driving licence plan (Margdarshak): "+planURL)}
	if !granted {
		return res, ErrConsentRequired
	}
	phone = privacy.NormalizeContact("phone", phone)
	blind := s.Vault.BlindIndex(tenant, "phone", phone)
	var pend *pending
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		enc, err := s.Vault.EncryptString(tenant, "contacts.value", phone)
		if err != nil {
			return err
		}
		ct := &store.Contact{ID: ids.New(), TenantID: tenant, ApplicantID: p.ApplicantID, Kind: "phone", ValueEnc: enc, BlindIndex: blind}
		if err := store.UpsertContact(ctx, tx, ct); err != nil {
			return err
		}
		if _, err := s.Accounts.RecordConsent(ctx, tx, p, "whatsapp_updates", notice, []string{"phone", "plan_summary", "case_milestones"}, nil); err != nil {
			return err
		}
		status := ports.DeliveryQueued
		if slices.Contains(ct.OptedOutChannels, "whatsapp") {
			status = ports.DeliveryOptedOut // EC-30: STOP is honoured even for a new request
		}
		cid := ct.ID
		vars := map[string]string{"plan_link": planURL}
		n := &store.Notification{ID: ids.New(), TenantID: tenant, ApplicantID: &p.ApplicantID, ContactID: &cid, Channel: "whatsapp",
			TemplateID: "plan_card_v1", TemplateVars: map[string]any{"plan_link": planURL}, Status: status,
			IdempotencyKey: "plan:" + planRef + ":" + blindHex(blind)[:16], Kind: "transactional"}
		created, err := store.InsertNotification(ctx, tx, n)
		if err != nil {
			return err
		}
		res.NotificationID, res.Status = ids.Encode(ids.Notification, n.ID), n.Status
		if created && n.Status == ports.DeliveryQueued {
			pend = &pending{tenant: tenant, n: n, to: phone, lang: lang, vars: vars}
		}
		_, err = audit.Append(ctx, tx, s.now(), audit.Entry{Tenant: tenant, Actor: p.Subject(), ActorScope: p.Scope, Action: "plan.whatsapp_requested",
			Target: planRef, Purpose: "whatsapp_updates", Meta: map[string]any{"status": n.Status, "replay": !created}})
		return err
	})
	if err != nil {
		return nil, err
	}
	if pend != nil {
		s.deliver(ctx, "plan_card", planRef, []pending{*pend})
		res.Status = pend.n.Status
	}
	return res, nil
}

// ---- n8n callbacks (API-66, /internal/notifications/seen) -------------------------------------

// Receipt is one W02 delivery receipt.
type Receipt struct {
	NotificationID    string
	Status            string
	ProviderMessageID string
	ErrorCode         string
}

// ApplyReceipts updates E-13 from W02's batched receipts. Unknown IDs are counted, not fatal.
func (s *Service) ApplyReceipts(ctx context.Context, tenant string, list []Receipt) (applied, unknown int, err error) {
	order := map[string]int{"queued": 0, "sent": 1, "failed": 1, "delivered": 2, "read": 3}
	err = s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		for _, r := range list {
			if r.Status == "backend_channel" {
				continue // e-mail / web push: the backend sent and recorded it
			}
			id, derr := ids.Decode(ids.Notification, r.NotificationID)
			if derr != nil {
				unknown++
				continue
			}
			n, gerr := store.GetNotification(ctx, tx, id)
			if errors.Is(gerr, store.ErrNotFound) {
				unknown++
				continue
			}
			if gerr != nil {
				return gerr
			}
			if order[r.Status] < order[n.Status] {
				continue // receipts may arrive out of order: never move a message backwards
			}
			provider := "n8n"
			var mid, code *string
			if r.ProviderMessageID != "" {
				mid = &r.ProviderMessageID
			}
			if r.ErrorCode != "" {
				code = &r.ErrorCode
			}
			if err := store.UpdateNotificationStatus(ctx, tx, id, r.Status, &provider, mid, code); err != nil {
				return err
			}
			applied++
		}
		return nil
	})
	return applied, unknown, err
}

// SeenResult is one /internal/notifications/seen answer.
type SeenResult struct {
	NotificationID string `json:"notification_id"`
	Seen           bool   `json:"seen"`
	Status         string `json:"status"`
	Action         string `json:"action"`
}

// fallbackChannel is the channel a WhatsApp message falls back to, if any.
func (s *Service) fallbackChannel(ctx context.Context, tx pgx.Tx, n *store.Notification) (*channel, error) {
	if n.ApplicantID == nil || n.Channel != "whatsapp" {
		return nil, nil
	}
	app, err := store.GetApplicant(ctx, tx, *n.ApplicantID)
	if err != nil || app.DeletedAt != nil {
		return nil, err
	}
	chans, err := s.channels(ctx, tx, n.TenantID, *n.ApplicantID)
	if err != nil {
		return nil, err
	}
	for _, c := range chans {
		if c.channel == "email" || c.channel == "web_push" {
			cc := c
			return &cc, nil
		}
	}
	return nil, nil
}

func fallbackKey(n *store.Notification, ch string) string {
	base := strings.TrimSuffix(n.IdempotencyKey, ":"+n.Channel)
	return base + ":" + ch
}

// Seen tells W02 which WhatsApp messages were read and whether the backend allows a fallback
// (another opted-in channel exists, nothing was sent there yet). n8n only routes on `action`.
func (s *Service) Seen(ctx context.Context, tenant string, refs []string) ([]SeenResult, error) {
	out := make([]SeenResult, 0, len(refs))
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		for _, r := range refs {
			res := SeenResult{NotificationID: r, Action: "none", Status: "unknown"}
			id, err := ids.Decode(ids.Notification, r)
			if err == nil {
				n, err := store.GetNotification(ctx, tx, id)
				if err == nil {
					res.Status = n.Status
					res.Seen = n.Status == "read" || n.SeenAt != nil
					if !res.Seen && (n.Status == "sent" || n.Status == "delivered" || n.Status == "queued") {
						ch, err := s.fallbackChannel(ctx, tx, n)
						if err != nil {
							return err
						}
						if ch != nil {
							if _, err := store.NotificationByKey(ctx, tx, fallbackKey(n, ch.channel)); errors.Is(err, store.ErrNotFound) {
								res.Action = "request_fallback"
							}
						}
					}
				} else if !errors.Is(err, store.ErrNotFound) {
					return err
				}
			}
			out = append(out, res)
		}
		return nil
	})
	return out, err
}

// RequestFallback sends the fallback channel (e-mail / web push) for unseen WhatsApp messages
// (W02 after its 24 h wait). Idempotent per "{eventKey}:{channel}".
func (s *Service) RequestFallback(ctx context.Context, tenant string, refs []string) (int, error) {
	now := s.now()
	var list []pending
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		for _, r := range refs {
			id, err := ids.Decode(ids.Notification, r)
			if err != nil {
				continue
			}
			n, err := store.GetNotification(ctx, tx, id)
			if errors.Is(err, store.ErrNotFound) {
				continue
			}
			if err != nil {
				return err
			}
			if n.Status == "read" || n.SeenAt != nil {
				continue
			}
			ch, err := s.fallbackChannel(ctx, tx, n)
			if err != nil {
				return err
			}
			if ch == nil {
				continue
			}
			app, err := store.GetApplicant(ctx, tx, *n.ApplicantID)
			if err != nil {
				return err
			}
			vars := map[string]string{}
			for k, v := range n.TemplateVars {
				vars[k] = fmt.Sprint(v)
			}
			fb := &store.Notification{ID: ids.New(), TenantID: tenant, ApplicantID: n.ApplicantID, ContactID: ch.contactID, TimelineEventID: n.TimelineEventID,
				Channel: ch.channel, TemplateID: n.TemplateID, TemplateVars: n.TemplateVars, Status: ports.DeliveryQueued,
				IdempotencyKey: fallbackKey(n, ch.channel), Kind: "fallback"}
			if InQuietHours(now, app.QuietHours) {
				fb.Status = "suppressed_quiet_hours"
			}
			created, err := store.InsertNotification(ctx, tx, fb)
			if err != nil {
				return err
			}
			if created && fb.Status == ports.DeliveryQueued {
				list = append(list, pending{tenant: tenant, n: fb, to: ch.to, lang: app.Language, vars: vars})
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	sent, _, _ := s.deliver(ctx, "fallback", "fallback:"+now.UTC().Format(time.RFC3339), list)
	return sent, nil
}

// OptOut handles STOP (EC-30): the channel is opted out for every contact with that blind index,
// the dependent consent is withdrawn, and one confirmation is sent once per contact.
func (s *Service) OptOut(ctx context.Context, tenant, kind string, blind []byte, ch string) (int64, error) {
	var changed int64
	type target struct {
		applicant uuid.UUID
		contact   uuid.UUID
		to        string
		lang      string
	}
	var targets []target
	now := s.now()
	err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
		var err error
		if changed, err = store.OptOutByBlindIndex(ctx, tx, kind, blind, ch); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT contact_id, applicant_id, value_enc FROM privacy.contacts WHERE kind = $1 AND blind_index = $2`, kind, blind)
		if err != nil {
			return err
		}
		var found []struct {
			id, app uuid.UUID
			enc     []byte
		}
		for rows.Next() {
			var f struct {
				id, app uuid.UUID
				enc     []byte
			}
			if err := rows.Scan(&f.id, &f.app, &f.enc); err != nil {
				rows.Close()
				return err
			}
			found = append(found, f)
		}
		rows.Close()
		for _, f := range found {
			if purpose := purposeOf[ch]; purpose != "" {
				if c, err := store.ActiveConsent(ctx, tx, f.app, purpose, nil, nil); err == nil {
					if err := store.RevokeConsent(ctx, tx, c.ID, now); err != nil {
						return err
					}
					cid := c.ID
					if _, err := audit.Append(ctx, tx, now, audit.Entry{Tenant: tenant, Actor: "n8n", ActorScope: "internal", Action: "consent.revoke",
						Target: ids.Encode(ids.Consent, c.ID), Purpose: purpose, ConsentID: &cid, Meta: map[string]any{"via": "stop_keyword"}}); err != nil {
						return err
					}
				} else if !errors.Is(err, store.ErrNotFound) {
					return err
				}
			}
			app, err := store.GetApplicant(ctx, tx, f.app)
			if err != nil {
				return err
			}
			to, err := s.Vault.DecryptString(tenant, "contacts.value", f.enc)
			if err != nil {
				return err
			}
			targets = append(targets, target{applicant: f.app, contact: f.id, to: to, lang: app.Language})
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	if ch != "whatsapp" {
		return changed, nil
	}
	for _, t := range targets {
		var p *pending
		err := s.DB.Tenant(ctx, tenant, func(tx pgx.Tx) error {
			app, cid := t.applicant, t.contact
			n := &store.Notification{ID: ids.New(), TenantID: tenant, ApplicantID: &app, ContactID: &cid, Channel: "whatsapp",
				TemplateID: "stop_confirmation_v1", TemplateVars: map[string]any{}, Status: ports.DeliveryQueued,
				IdempotencyKey: "optout:" + cid.String() + ":whatsapp", Kind: "transactional"}
			created, err := store.InsertNotification(ctx, tx, n)
			if err == nil && created {
				p = &pending{tenant: tenant, n: n, to: t.to, lang: t.lang, vars: map[string]string{}}
			}
			return err
		})
		if err != nil {
			return changed, err
		}
		if p != nil {
			s.deliver(ctx, "stop_confirmation", p.n.IdempotencyKey, []pending{*p})
		}
	}
	return changed, nil
}
