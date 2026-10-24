// Package dsr implements the data principal rights of the privacy centre (MD-133/134/137,
// F-54, PRIVACY §3 and §9): export (API-61), account erasure (API-62, EC-26) and the retention
// job (MD-137). Export contains every row tied to the account and nothing else, P2 game,
// learning, study and declaration rows included; erasure cancels timers and pending messages,
// crypto-shreds contacts, erases the P2 rows (store.P2Erase) and keeps only consent proofs and the
// content-free audit log for a year.
package dsr

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/audit"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// ExportTTL is the life of an export link (PRIVACY §9: link valid 24 h).
const ExportTTL = 24 * time.Hour

// Errors.
var (
	ErrNotFound = errors.New("dsr: not found")
	ErrExpired  = errors.New("dsr: export link expired")
)

// Service runs the rights flows.
type Service struct {
	DB    *store.DB
	Vault *privacy.Vault
	Clock servertime.Clock
	Log   *slog.Logger
}

// ExportRef is the API-61 answer.
type ExportRef struct {
	ExportID  string
	ExpiresAt time.Time
}

// Export collects the bundle, stores it encrypted for 24 h and returns its reference.
func (s *Service) Export(ctx context.Context, p *accounts.Principal) (*ExportRef, error) {
	now := s.Clock.Now()
	id := ids.New()
	ref := ids.Encode(ids.Export, id)
	var out *ExportRef
	err := s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		bundle, err := s.collect(ctx, tx, p, ref, now)
		if err != nil {
			return err
		}
		raw, err := json.Marshal(bundle)
		if err != nil {
			return err
		}
		enc, err := s.Vault.Encrypt(p.Tenant, "exports.bundle", raw)
		if err != nil {
			return err
		}
		exp := now.Add(ExportTTL)
		if err := store.InsertExport(ctx, tx, id, p.Tenant, p.ApplicantID, enc, now, exp); err != nil {
			return err
		}
		out = &ExportRef{ExportID: ref, ExpiresAt: exp}
		_, err = audit.Append(ctx, tx, now, audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope, Action: "privacy.export",
			Target: ref, Meta: map[string]any{"sections": len(bundle["sections"].(map[string]any))}})
		return err
	})
	return out, err
}

// Download returns a stored bundle of the caller.
func (s *Service) Download(ctx context.Context, p *accounts.Principal, exportRef string) (json.RawMessage, error) {
	id, err := ids.Decode(ids.Export, exportRef)
	if err != nil {
		return nil, ErrNotFound
	}
	var raw []byte
	err = s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		enc, _, err := store.GetExport(ctx, tx, id, p.ApplicantID, s.Clock.Now())
		if err != nil {
			return err
		}
		raw, err = s.Vault.Decrypt(p.Tenant, "exports.bundle", enc)
		return err
	})
	switch {
	case errors.Is(err, store.ErrNotFound):
		return nil, ErrNotFound
	case errors.Is(err, store.ErrExpired):
		return nil, ErrExpired
	case err != nil:
		return nil, err
	}
	return raw, nil
}

func dec(v *privacy.Vault, tenant, field string, b []byte) any {
	if len(b) == 0 {
		return nil
	}
	s, err := v.DecryptString(tenant, field, b)
	if err != nil {
		return nil
	}
	return s
}

// collect builds the bundle (every row tied to the applicant).
func (s *Service) collect(ctx context.Context, tx pgx.Tx, p *accounts.Principal, ref string, now time.Time) (map[string]any, error) {
	t := p.Tenant
	app, err := store.GetApplicant(ctx, tx, p.ApplicantID)
	if err != nil {
		return nil, err
	}
	profile := map[string]any{"subject": p.Subject(), "kind": app.Kind, "user_band": app.UserBand, "age_band": app.AgeBand, "language": app.Language,
		"a11y": app.A11y, "quiet_hours": app.QuietHours, "flags": app.Flags, "dob": dec(s.Vault, t, "applicants.dob", app.DOBEnc),
		"dob_precision": app.DOBPrecision, "created_at": app.CreatedAt.UTC()}
	contacts := []any{}
	cs, err := store.ContactsFor(ctx, tx, p.ApplicantID)
	if err != nil {
		return nil, err
	}
	for _, c := range cs {
		contacts = append(contacts, map[string]any{"kind": c.Kind, "value": dec(s.Vault, t, "contacts.value", c.ValueEnc), "opted_out_channels": c.OptedOutChannels})
	}
	consents := []any{}
	cl, err := store.ListConsents(ctx, tx, p.ApplicantID)
	if err != nil {
		return nil, err
	}
	for _, c := range cl {
		m := map[string]any{"consent_id": ids.Encode(ids.Consent, c.ID), "purpose": c.Purpose, "data_categories": c.DataCategories, "recipient": c.Recipient,
			"notice_version": c.NoticeVersion, "language": c.Language, "granted_at": c.GrantedAt.UTC(), "expires_at": c.ExpiresAt, "revoked_at": c.RevokedAt,
			"signature": base64.RawURLEncoding.EncodeToString(c.Signature), "canonical": string(accounts.ConsentCanonical(c))}
		if c.SubjectMemberID != nil {
			m["family_member_id"] = ids.Encode(ids.FamilyMember, *c.SubjectMemberID)
		}
		consents = append(consents, m)
	}
	members := []any{}
	ms, err := store.ListFamilyMembers(ctx, tx, p.ApplicantID)
	if err != nil {
		return nil, err
	}
	for _, m := range ms {
		members = append(members, map[string]any{"member_id": ids.Encode(ids.FamilyMember, m.ID), "relation": m.Relation,
			"label": dec(s.Vault, t, "family_members.label", m.LabelEnc), "dob": dec(s.Vault, t, "family_members.dob", m.DOBEnc),
			"dob_precision": m.DOBPrecision, "age_band": m.AgeBand, "is_minor": m.IsMinor, "parental_consent_status": m.ParentalConsentStatus})
	}
	caseOut := []any{}
	refs, err := store.OpenCasesFor(ctx, tx, p.ApplicantID)
	if err != nil {
		return nil, err
	}
	for _, r := range refs {
		c, err := store.GetCase(ctx, tx, r.ID)
		if err != nil {
			return nil, err
		}
		cm := map[string]any{"case_id": ids.Encode(ids.Case, c.ID), "state": c.State, "path": c.Path, "classes": c.Classes, "answers": c.Answers,
			"facts": c.Facts, "key_dates": c.KeyDates, "flags": c.Flags, "rule_pack": c.RulePackID + "@" + c.RulePackVersion,
			"dob": dec(s.Vault, t, "cases.dob", c.DOBEnc), "created_at": c.CreatedAt.UTC(), "updated_at": c.UpdatedAt.UTC()}
		if c.FamilyMemberID != nil {
			cm["family_member_id"] = ids.Encode(ids.FamilyMember, *c.FamilyMemberID)
		}
		evs, err := store.ListCaseEvents(ctx, tx, c.ID)
		if err != nil {
			return nil, err
		}
		var events []any
		for _, e := range evs {
			events = append(events, map[string]any{"seq": e.Seq, "type": e.Type, "occurred_on": e.OccurredOn, "recorded_at": e.RecordedAt.UTC(),
				"actor_kind": e.ActorKind, "payload": e.Payload, "from_state": e.FromState, "to_state": e.ToState})
		}
		cm["events"] = events
		tl, err := store.ListTimeline(ctx, tx, c.ID)
		if err != nil {
			return nil, err
		}
		var timeline []any
		for _, e := range tl {
			timeline = append(timeline, map[string]any{"code": e.Code, "kind": e.Kind, "due_on": e.DueOn, "status": e.Status, "rule_id": e.RuleID})
		}
		cm["timeline"] = timeline
		if ll, err := store.GetLLMirror(ctx, tx, c.ID); err == nil {
			cm["learner_licence"] = map[string]any{"issued_on": ll.IssuedOn, "expires_on": ll.ExpiresOn, "classes": ll.Classes,
				"number_last4": dec(s.Vault, t, "ll_mirrors.number_last4", ll.NumberLast4Enc), "source": ll.Source}
		}
		if dl, err := store.GetDLMirror(ctx, tx, c.ID); err == nil {
			cm["driving_licence"] = map[string]any{"issued_on": dl.IssuedOn, "valid_to_non_transport": dl.ValidToNT, "classes": dl.Classes,
				"number_last4": dec(s.Vault, t, "dl_mirrors.number_last4", dl.NumberLast4Enc), "renewal_window_opens": dl.RenewalWindowOpens, "source": dl.Source}
		}
		sel, err := store.ListClassSelections(ctx, tx, c.ID)
		if err != nil {
			return nil, err
		}
		cm["class_selections"] = sel
		caseOut = append(caseOut, cm)
	}
	planOut := []any{}
	pl, err := store.PlansForApplicant(ctx, tx, p.ApplicantID)
	if err != nil {
		return nil, err
	}
	for _, x := range pl {
		planOut = append(planOut, map[string]any{"plan_id": ids.Encode(ids.Plan, x.ID), "state": x.State, "request": x.Request, "created_at": x.CreatedAt.UTC(),
			"expires_at": x.ExpiresAt.UTC()})
	}
	notes := []any{}
	ns, err := store.NotificationsForApplicant(ctx, tx, p.ApplicantID)
	if err != nil {
		return nil, err
	}
	for _, n := range ns {
		notes = append(notes, map[string]any{"notification_id": ids.Encode(ids.Notification, n.ID), "channel": n.Channel, "template_id": n.TemplateID,
			"status": n.Status, "kind": n.Kind, "created_at": n.CreatedAt.UTC()})
	}
	pays := []any{}
	ps, err := store.PaymentIntentsForApplicant(ctx, tx, p.ApplicantID)
	if err != nil {
		return nil, err
	}
	for _, x := range ps {
		pays = append(pays, map[string]any{"payment_intent_id": ids.Encode(ids.PaymentIntent, x.ID), "amount_paise": x.AmountPaise, "status": x.Status,
			"adapter": x.Adapter, "created_at": x.CreatedAt.UTC()})
	}
	sections := map[string]any{"profile": profile, "contacts": contacts, "consents": consents, "family_members": members, "cases": caseOut,
		"plans": planOut, "notifications": notes, "payment_intents": pays}
	// P2: games, learning, the online study and declarations (the account's and its family
	// members' rows).
	p2, err := store.P2Export(ctx, tx, p.ApplicantID)
	if err != nil {
		return nil, err
	}
	for section, tables := range p2 {
		for _, rows := range tables {
			for _, row := range rows {
				encodeMember(row)
			}
		}
		if section == "records" {
			sections["declarations"] = tables["declarations"]
			continue
		}
		sections[section] = tables
	}
	return map[string]any{"export_id": ref, "generated_at": now.UTC(), "expires_at": now.Add(ExportTTL).UTC(), "subject": p.Subject(), "tenant": t,
		"format_version": "md-export-2",
		"sections":       sections,
		"not_included": []string{
			"analytics_events: pseudonymous with a key that rotates daily, so they cannot be linked to you",
			"audit_log: security log without content, kept 1 year (DPDP Rules 2025 r.8)",
			"lab_trials: pseudonymous participant codes held by the study owner",
		}}, nil
}

// encodeMember renders a raw family_member_id as the API's fam_ ID.
func encodeMember(row map[string]any) {
	if v, ok := row["family_member_id"].(string); ok {
		if id, err := uuid.Parse(v); err == nil {
			row["family_member_id"] = ids.Encode(ids.FamilyMember, id)
		}
	}
}

// ---- Erasure (API-62, EC-26) ----------------------------------------------------------------

// DeleteAccount erases the account now: timers and pending messages cancelled, contacts
// crypto-shredded (deleted), consents withdrawn (artefacts kept as proof), family members and
// plans removed, sessions revoked; rows are hard-deleted by the retention job within 30 days.
func (s *Service) DeleteAccount(ctx context.Context, p *accounts.Principal) (map[string]int64, error) {
	now := s.Clock.Now()
	counts := map[string]int64{}
	err := s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		refs, err := store.OpenCasesFor(ctx, tx, p.ApplicantID)
		if err != nil {
			return err
		}
		for _, r := range refs {
			n, err := store.CancelScheduledTimeline(ctx, tx, r.ID)
			if err != nil {
				return err
			}
			counts["timeline_cancelled"] += n
		}
		n, err := store.CancelQueuedNotifications(ctx, tx, p.ApplicantID, nil)
		if err != nil {
			return err
		}
		counts["notifications_cancelled"] = n
		exec := func(name, q string) error {
			tag, err := tx.Exec(ctx, q, p.ApplicantID, now)
			if err != nil {
				return err
			}
			counts[name] = tag.RowsAffected()
			return nil
		}
		for _, x := range []struct{ name, q string }{
			{"contacts_shredded", `DELETE FROM privacy.contacts WHERE applicant_id = $1 AND $2::timestamptz IS NOT NULL`},
			{"consents_withdrawn", `UPDATE privacy.consent_artefacts SET revoked_at = $2 WHERE applicant_id = $1 AND revoked_at IS NULL`},
			{"family_members_removed", `UPDATE core.family_members SET deleted_at = $2 WHERE applicant_id = $1 AND deleted_at IS NULL`},
			{"plans_deleted", `DELETE FROM core.plans WHERE applicant_id = $1 AND $2::timestamptz IS NOT NULL`},
			{"exports_deleted", `DELETE FROM privacy.exports WHERE applicant_id = $1 AND $2::timestamptz IS NOT NULL`},
			{"cases_deleted", `UPDATE core.cases SET deleted_at = $2, flags = array_append(flags, 'deleted_pending') WHERE applicant_id = $1 AND deleted_at IS NULL`},
		} {
			if err := exec(x.name, x.q); err != nil {
				return err
			}
		}
		// P2 rows (games, learning, squads, share cards, study, declarations): see store.P2Erase.
		p2, err := store.P2Erase(ctx, tx, p.Tenant, p.ApplicantID, now)
		if err != nil {
			return err
		}
		for k, v := range p2 {
			counts[k] = v
		}
		if err := store.SoftDeleteApplicant(ctx, tx, p.ApplicantID); err != nil {
			return err
		}
		if _, err := store.RevokeAllSessions(ctx, tx, p.ApplicantID, "account_deleted"); err != nil {
			return err
		}
		meta := map[string]any{}
		for k, v := range counts {
			meta[k] = v
		}
		_, err = audit.Append(ctx, tx, now, audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope, Action: "account.erasure_requested",
			Target: p.Subject(), Meta: meta})
		return err
	})
	return counts, err
}

// ---- Retention (MD-137) ----------------------------------------------------------------------

// Retention periods (PRIVACY §2, DATA_MODEL §1.2).
const (
	IdempotencyTTL    = 24 * time.Hour
	AnalyticsRawTTL   = 30 * 24 * time.Hour
	NotificationTTL   = 90 * 24 * time.Hour
	SoftDeleteGrace   = 30 * 24 * time.Hour
	ConsentProofAfter = 365 * 24 * time.Hour
	MagicLinkKeep     = 24 * time.Hour
	// P2 (DATA_MODEL §1.2, §4.4, §4.5). RT-90D: the replay inputs stored on game.sessions (the
	// stand-in for E-17 raw game events, which are deferred) and raw learn.answers (folded into
	// card state). E-19 debrief drafts (RT-7D) are not built yet, so there is nothing to sweep.
	ReplayInputsTTL = 90 * 24 * time.Hour
	LearnAnswersTTL = 90 * 24 * time.Hour
	// DATA_MODEL gives no retention for an expired or withdrawn share card or a disbanded squad
	// (only the 90-day link and 7-day invite lifetimes): the rows are kept SoftDeleteGrace (30
	// days, the RT-ACCOUNT hard-delete bound) after they stop working, then deleted.
	ShareCardKeep      = SoftDeleteGrace
	DisbandedSquadKeep = SoftDeleteGrace
)

// Retention deletes or anonymises rows past their retention as of now and returns the counts
// (logs carry counts only). It runs as mg_jobs across tenants.
func (s *Service) Retention(ctx context.Context, now time.Time) (map[string]int64, error) {
	counts := map[string]int64{}
	steps := []struct {
		name string
		q    string
		arg  time.Time
	}{
		{"plans", `DELETE FROM core.plans WHERE expires_at < $1`, now},
		{"fee_quotes", `DELETE FROM core.fee_quotes WHERE case_id IS NULL AND expires_at < $1
			AND NOT EXISTS (SELECT 1 FROM core.payment_intents p WHERE p.quote_id = fee_quotes.quote_id)`, now},
		{"idempotency_keys", `DELETE FROM ops.idempotency_keys WHERE created_at < $1`, now.Add(-IdempotencyTTL)},
		{"analytics_events", `DELETE FROM ops.analytics_events WHERE created_at < $1`, now.Add(-AnalyticsRawTTL)},
		{"exports", `DELETE FROM privacy.exports WHERE expires_at < $1`, now},
		{"replay_cache", `DELETE FROM ops.replay_cache WHERE expires_at < $1`, now},
		{"magic_links", `DELETE FROM core.magic_links WHERE expires_at < $1`, now.Add(-MagicLinkKeep)},
		{"notifications", `DELETE FROM msg.notifications WHERE created_at < $1`, now.Add(-NotificationTTL)},
		// Cases deleted more than 30 days ago: hard delete (events, timeline, mirrors cascade).
		{"deleted_case_notifications", `DELETE FROM msg.notifications WHERE timeline_event_id IN (SELECT t.timeline_event_id
			FROM core.timeline_events t JOIN core.cases c ON c.case_id = t.case_id WHERE c.deleted_at < $1)`, now.Add(-SoftDeleteGrace)},
		{"deleted_case_payments", `DELETE FROM core.payment_intents WHERE case_id IN (SELECT case_id FROM core.cases WHERE deleted_at < $1)`, now.Add(-SoftDeleteGrace)},
		{"cases", `DELETE FROM core.cases WHERE deleted_at < $1`, now.Add(-SoftDeleteGrace)},
		// Accounts deleted more than 30 days ago: scrubbed to a tombstone (consent proofs still
		// reference it for a year).
		{"applicants_scrubbed", `UPDATE core.applicants SET dob_enc = NULL, auth_subject_hash = NULL, dob_precision = NULL, age_band = NULL,
			a11y = '{}', flags = ARRAY['tombstone'] WHERE deleted_at < $1 AND NOT ('tombstone' = ANY(flags))`, now.Add(-SoftDeleteGrace)},
		{"family_members_scrubbed", `UPDATE core.family_members SET label_enc = NULL, dob_enc = '\x'::bytea WHERE deleted_at < $1 AND octet_length(dob_enc) > 0`, now.Add(-SoftDeleteGrace)},
		{"sessions", `DELETE FROM core.sessions WHERE (revoked_at IS NOT NULL AND revoked_at < $1) OR expires_at < $1`, now.Add(-SoftDeleteGrace)},
		// P2 game data: replay inputs after 90 days (never for a session still waiting for the
		// verifier); raw answers after 90 days; share cards and disbanded squads 30 days after
		// they stopped working.
		{"game_replay_inputs", `UPDATE game.sessions SET replay_inputs = NULL WHERE replay_inputs IS NOT NULL
			AND status <> 'pending_verification' AND coalesce(submitted_at, started_at) < $1`, now.Add(-ReplayInputsTTL)},
		{"learn_answers", `DELETE FROM learn.answers WHERE received_at < $1`, now.Add(-LearnAnswersTTL)},
		{"share_cards", `DELETE FROM game.share_cards WHERE LEAST(coalesce(withdrawn_at, 'infinity'::timestamptz), expires_at) < $1`,
			now.Add(-ShareCardKeep)},
		{"squads_disbanded", `DELETE FROM game.squads WHERE disbanded_at < $1`, now.Add(-DisbandedSquadKeep)},
		// Online study (FIELD_STUDY §6.3, deletion within 7 days of "Delete my data"): a withdrawn
		// participant's pseudonymous rows go at the next sweep (it runs daily).
		{"study_withdrawn_sessions", `DELETE FROM game.sessions s USING study.nazar_participants p
			WHERE s.cohort = 'field_test' AND s.tenant_id = p.tenant_id AND s.study_participant = p.participant_code
			  AND p.withdrawn_at <= $1`, now},
		{"study_withdrawn_participants", `DELETE FROM study.nazar_participants WHERE withdrawn_at <= $1`, now},
		// Consent proofs: kept 1 year after withdrawal, unless something still points at them.
		{"consent_artefacts", `DELETE FROM privacy.consent_artefacts c WHERE c.revoked_at < $1
			AND NOT EXISTS (SELECT 1 FROM core.family_members m WHERE m.parental_consent_id = c.consent_id)
			AND NOT EXISTS (SELECT 1 FROM study.lab_trials l WHERE l.consent_id = c.consent_id)
			AND NOT EXISTS (SELECT 1 FROM study.nazar_participants n WHERE n.consent_id = c.consent_id)
			AND NOT EXISTS (SELECT 1 FROM content.clips k WHERE k.contributor_consent_id = c.consent_id)`, now.Add(-ConsentProofAfter)},
	}
	err := s.DB.System(ctx, func(tx pgx.Tx) error {
		for _, st := range steps {
			tag, err := tx.Exec(ctx, st.q, st.arg)
			if err != nil {
				return err
			}
			counts[st.name] = tag.RowsAffected()
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if s.Log != nil {
		args := []any{}
		for k, v := range counts {
			args = append(args, k, v)
		}
		s.Log.InfoContext(ctx, "retention sweep", args...)
	}
	return counts, nil
}
