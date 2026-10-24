package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/audit"
	clocksvc "github.com/sruj08/margadarshak/services/api/internal/clock"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/jobs"
	"github.com/sruj08/margadarshak/services/api/internal/journey"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

func principalFor(a *store.Applicant) *accounts.Principal {
	scope := "anon"
	if a.Kind == "account" {
		scope = "user"
	}
	return &accounts.Principal{ApplicantID: a.ID, Tenant: a.TenantID, Scope: scope, Kind: a.Kind, UserBand: a.UserBand, AgeBand: a.AgeBand}
}

// auditInternal writes one audit row for an internal-channel call (MD-050: every machine and
// admin action is audited).
func (s *Server) auditInternal(r *http.Request, tenant, action, target string, meta map[string]any) error {
	return s.deps.DB.Tenant(r.Context(), tenant, func(tx pgx.Tx) error {
		_, err := audit.Append(r.Context(), tx, s.now(), audit.Entry{Tenant: tenant, Actor: "n8n", ActorScope: "internal", Action: action,
			Target: target, Meta: meta, TraceID: traceID(r.Context())})
		return err
	})
}

func jobRunOut(run jobs.Run) gen.JobRun {
	replay := run.Replayed
	return gen.JobRun{Job: gen.JobRunJob(run.Job), RunId: run.RunID, Runner: gen.JobRunRunner(run.Runner), Status: gen.JobRunStatus(run.Status), IdempotentReplay: &replay}
}

// TriggerClockSweep is API-65: n8n's schedule starts case_clock_sweep. The as-of date is the
// server's IST date, never the caller's clock (EC-15).
func (s *Server) TriggerClockSweep(w http.ResponseWriter, r *http.Request, params gen.TriggerClockSweepParams) {
	var req gen.ClockSweepRequest
	if !decodeJSON(w, r, &req, false) {
		return
	}
	if req.SweepId == "" || len(req.SweepId) > 64 {
		validation(w, r, "/sweep_id", "required")
		return
	}
	tenants := []string{}
	if req.Tenants != nil {
		for _, t := range *req.Tenants {
			if _, err := s.deps.Tenants.Get(r.Context(), string(t)); err != nil {
				validation(w, r, "/tenants", "unknown_tenant")
				return
			}
			tenants = append(tenants, string(t))
		}
	}
	if len(tenants) == 0 {
		tenants = []string{tenantFrom(r.Context()).TenantID}
	}
	asOf := servertime.DateIST(s.now())
	dry := req.DryRun != nil && *req.DryRun
	key := "sweep:" + strings.Join(tenants, ",") + ":" + asOf
	if params.IdempotencyKey != nil {
		key = "sweep:" + *params.IdempotencyKey
	}
	run, err := s.deps.Jobs.Start(r.Context(), nil, "case_clock_sweep",
		[]any{map[string]any{"tenants": tenants, "as_of": asOf, "dry_run": dry, "sweep_id": req.SweepId, "caller_as_of": req.AsOf}}, key)
	if err != nil {
		s.adapterError(w, r, err)
		return
	}
	for _, t := range tenants {
		if err := s.auditInternal(r, t, "internal.clock_sweep", req.SweepId, map[string]any{"run_id": run.RunID, "as_of": asOf, "replay": run.Replayed}); err != nil {
			internalError(w, r)
			return
		}
	}
	writeJSON(w, http.StatusAccepted, jobRunOut(run))
}

// StartInternalJob is API-67: n8n starts an allow-listed job (IDs-only args, max 4 KB).
func (s *Server) StartInternalJob(w http.ResponseWriter, r *http.Request, job gen.StartInternalJobParamsJob, params gen.StartInternalJobParams) {
	if !job.Valid() || !jobs.InternalJobs[string(job)] {
		validation(w, r, "/job", "unknown_job")
		return
	}
	var req gen.StartInternalJobJSONBody
	if !decodeJSON(w, r, &req, true) {
		return
	}
	args := map[string]any{}
	if req.Args != nil {
		args = *req.Args
	}
	if b, _ := json.Marshal(args); len(b) > 4096 {
		validation(w, r, "/args", "too_large")
		return
	}
	key := ""
	if params.IdempotencyKey != nil {
		key = string(job) + ":" + *params.IdempotencyKey
	}
	run, err := s.deps.Jobs.Start(r.Context(), nil, string(job), []any{args}, key)
	if err != nil {
		s.adapterError(w, r, err)
		return
	}
	if err := s.auditInternal(r, tenantFrom(r.Context()).TenantID, "internal.job_start", string(job), map[string]any{"run_id": run.RunID, "replay": run.Replayed}); err != nil {
		internalError(w, r)
		return
	}
	writeJSON(w, http.StatusAccepted, jobRunOut(run))
}

// RunJobStep runs one business step for a Render Workflows task (POST /internal/job-steps/{step}).
// The result is returned under `result` and flattened at the top level: the TypeScript client
// (services/workflows/src/lib/api.ts) reads the step result fields directly. A batch with a
// retryable delivery failure answers 503 after committing what it could, so the task retries.
func (s *Server) RunJobStep(w http.ResponseWriter, r *http.Request, step gen.RunJobStepParamsStep, _ gen.RunJobStepParams) {
	if !step.Valid() {
		validation(w, r, "/step", "unknown_step")
		return
	}
	var req struct {
		RunID *string        `json:"run_id"`
		Args  map[string]any `json:"args"`
	}
	if !decodeJSON(w, r, &req, true) {
		return
	}
	if b, _ := json.Marshal(req.Args); len(b) > 16<<10 {
		validation(w, r, "/args", "too_large")
		return
	}
	if req.Args == nil {
		req.Args = map[string]any{}
	}
	out, err := s.deps.Jobs.RunStep(r.Context(), string(step), req.Args)
	var sie *clocksvc.StepInputError
	switch {
	case errors.Is(err, jobs.ErrUnknownStep):
		validation(w, r, "/step", "unknown_step")
		return
	case errors.As(err, &sie):
		validation(w, r, "/args/"+sie.Field, sie.Code)
		return
	case errors.Is(err, clocksvc.ErrRetryable):
		s.deps.Log.WarnContext(r.Context(), "job step partly failed; asking for a retry", "step", step, "result", out)
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Retryable: true, RetryAfter: 5 * time.Second,
			Detail: "some messages could not be handed to n8n; the rest are recorded and will not be sent twice"})
		return
	case err != nil:
		s.deps.Log.ErrorContext(r.Context(), "job step failed", "step", step, "err", err)
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Retryable: true})
		return
	}
	runID := ""
	if req.RunID != nil {
		runID = *req.RunID
	}
	if err := s.auditInternal(r, tenantFrom(r.Context()).TenantID, "internal.job_step", string(step), map[string]any{"run_id": runID}); err != nil {
		internalError(w, r)
		return
	}
	body := map[string]any{}
	for k, v := range out {
		body[k] = v
	}
	body["step"], body["result"] = string(step), out
	writeJSON(w, http.StatusOK, body)
}

var receiptStatus = map[string]string{"sent": "sent", "delivered": "delivered", "read": "read", "failed": "failed"}

// N8nWebhook is API-66: delivery receipts (single or W02 batches), fallback requests, inbound
// replies, STOP opt-outs (EC-30) and approvals. Idempotent by (event, id).
func (s *Server) N8nWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		badRequest(w, r, "unreadable body")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	var req gen.N8nCallback
	if !decodeJSON(w, r, &req, false) {
		return
	}
	t := tenantFrom(r.Context())
	sum := sha256.Sum256(body)
	eventID := firstNonEmpty(ptr(req.NotificationId), ptr(req.ProviderMessageId), ptr(req.ReportId), ptr(req.LetterId), ptr(req.BookingId),
		ptr(req.PhoneBlindIndex)+"@"+req.At.UTC().Format("20060102T150405"))
	if req.Receipts != nil || req.NotificationIds != nil {
		eventID = "body:" + hex.EncodeToString(sum[:16])
	}
	var dup bool
	if err := s.deps.DB.Tenant(r.Context(), t.TenantID, func(tx pgx.Tx) error {
		var err error
		dup, err = store.SeenInbound(r.Context(), tx, "n8n", string(req.Event), eventID)
		return err
	}); err != nil {
		internalError(w, r)
		return
	}
	if dup {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	meta := map[string]any{"event": string(req.Event)}
	if req.Workflow != nil {
		meta["workflow"] = *req.Workflow
	}
	switch req.Event {
	case gen.N8nCallbackEventDeliveryReceipt:
		var list []clocksvc.Receipt
		if req.Receipts != nil {
			for _, rc := range *req.Receipts {
				list = append(list, clocksvc.Receipt{NotificationID: rc.NotificationId, Status: string(rc.Status), ProviderMessageID: ptrS(rc.ProviderMessageId),
					ErrorCode: ptrS(rc.ErrorCode)})
			}
		} else {
			if req.NotificationId == nil || req.Status == nil {
				validation(w, r, "/notification_id", "required")
				return
			}
			st, ok := receiptStatus[string(*req.Status)]
			if _, err := ids.Decode(ids.Notification, *req.NotificationId); err != nil || !ok {
				validation(w, r, "/notification_id", "invalid")
				return
			}
			list = append(list, clocksvc.Receipt{NotificationID: *req.NotificationId, Status: st, ProviderMessageID: ptrS(req.ProviderMessageId)})
		}
		applied, unknown, err := s.deps.CaseClock.ApplyReceipts(r.Context(), t.TenantID, list)
		if err != nil {
			internalError(w, r)
			return
		}
		if req.Receipts == nil && unknown > 0 {
			notFound(w, r)
			return
		}
		meta["applied"], meta["unknown"] = applied, unknown
	case gen.N8nCallbackEventRequestFallback:
		if req.NotificationIds == nil || len(*req.NotificationIds) == 0 {
			validation(w, r, "/notification_ids", "required")
			return
		}
		sent, err := s.deps.CaseClock.RequestFallback(r.Context(), t.TenantID, *req.NotificationIds)
		if err != nil {
			internalError(w, r)
			return
		}
		meta["fallback_sent"] = sent
	case gen.N8nCallbackEventInboundOptOut:
		if req.PhoneBlindIndex == nil || req.Channel == nil {
			validation(w, r, "/phone_blind_index", "required")
			return
		}
		blind, err := hex.DecodeString(strings.TrimPrefix(*req.PhoneBlindIndex, "hmac:"))
		if err != nil || len(blind) != 32 {
			validation(w, r, "/phone_blind_index", "invalid")
			return
		}
		n, err := s.deps.CaseClock.OptOut(r.Context(), t.TenantID, "phone", blind, string(*req.Channel))
		if err != nil {
			internalError(w, r)
			return
		}
		meta["channel"], meta["contacts_updated"] = string(*req.Channel), n
	default:
		// inbound_reply, school_lead_decision, letter_approval, field_form_submitted: recorded now,
		// acted on by the owning features (P2+).
	}
	if err := s.auditInternal(r, t.TenantID, "n8n."+string(req.Event), eventID, meta); err != nil {
		internalError(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func ptrS(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// NotificationsSeen answers W02's 24 h "seen?" check; the backend decides the fallback.
func (s *Server) NotificationsSeen(w http.ResponseWriter, r *http.Request) {
	var req gen.NotificationsSeenJSONBody
	if !decodeJSON(w, r, &req, false) {
		return
	}
	if len(req.NotificationIds) == 0 || len(req.NotificationIds) > 500 {
		validation(w, r, "/notification_ids", "invalid_length")
		return
	}
	res, err := s.deps.CaseClock.Seen(r.Context(), tenantFrom(r.Context()).TenantID, req.NotificationIds)
	if err != nil {
		internalError(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": res})
}

// AnalyticsDigest is the W13 read (MD-141): aggregates only, k >= 5, no minor's case.
func (s *Server) AnalyticsDigest(w http.ResponseWriter, r *http.Request, params gen.AnalyticsDigestParams) {
	period := "week"
	if params.Period != nil {
		period = string(*params.Period)
	}
	d, err := s.deps.Analytics.BuildDigest(r.Context(), tenantFrom(r.Context()).TenantID, period)
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "digest failed", "err", err)
		internalError(w, r)
		return
	}
	if err := s.auditInternal(r, tenantFrom(r.Context()).TenantID, "internal.analytics_digest", period,
		map[string]any{"publishable": d.Publishable, "suppressed_cells": d.SuppressedCells}); err != nil {
		internalError(w, r)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// PaymentCallback is API-24: the gateway's signed status callback. The signature is checked by
// the tenant's PaymentPort (adapter-specific secret, timestamp window, replay cache); unsigned
// or replayed callbacks are rejected. Reconciliation is by intent and receipt number only.
func (s *Server) PaymentCallback(w http.ResponseWriter, r *http.Request, adapter gen.PaymentCallbackParamsAdapter) {
	t := tenantFrom(r.Context())
	body, err := io.ReadAll(r.Body)
	if err != nil {
		badRequest(w, r, "unreadable body")
		return
	}
	if string(adapter) != t.Adapters.Payment.Mode() {
		writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Detail: "callback adapter does not match the tenant's payment adapter"})
		return
	}
	cb, err := t.Adapters.Payment.VerifyCallback(r.Context(), r.Header.Get(hmacsig.Header), body)
	if err != nil {
		if ports.KindOf(err) == ports.KindUnsupported {
			s.adapterError(w, r, err)
			return
		}
		s.deps.Log.WarnContext(r.Context(), "payment callback rejected", "reason", err.Error())
		writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Detail: "callback signature rejected"})
		return
	}
	pid, err := ids.Decode(ids.PaymentIntent, cb.IntentRef)
	if err != nil {
		validation(w, r, "/payment_intent_id", "invalid")
		return
	}
	var receipt []byte
	if cb.ReceiptNumber != "" {
		if receipt, err = s.deps.Vault.EncryptString(t.TenantID, "payment_intents.receipt", cb.ReceiptNumber); err != nil {
			internalError(w, r)
			return
		}
	}
	err = s.deps.DB.Tenant(r.Context(), t.TenantID, func(tx pgx.Tx) error {
		if err := store.ReconcilePaymentIntent(r.Context(), tx, pid, cb.Status, receipt, s.now()); err != nil {
			return err
		}
		_, err := audit.Append(r.Context(), tx, s.now(), audit.Entry{Tenant: t.TenantID, Actor: "payment:" + string(adapter), ActorScope: "internal",
			Action: "payment.callback", Target: cb.IntentRef, Meta: map[string]any{"status": cb.Status}})
		return err
	})
	if errors.Is(err, store.ErrNotFound) {
		notFound(w, r)
		return
	}
	if err != nil {
		internalError(w, r)
		return
	}
	// MD-117 / EC-09: the gateway status moves the case (payment confirmed, or pending guidance).
	if s.deps.Cases != nil {
		var intent *store.PaymentIntent
		_ = s.deps.DB.Tenant(r.Context(), t.TenantID, func(tx pgx.Tx) error {
			var err error
			intent, err = store.GetPaymentIntent(r.Context(), tx, pid)
			return err
		})
		ev := map[string]journey.Event{"success": journey.PaymentConfirmed, "pending": journey.PaymentPendingEv}[cb.Status]
		if intent != nil && intent.CaseID != nil && ev != "" {
			if _, err := s.deps.Cases.ApplySystemEvent(r.Context(), t.TenantID, *intent.CaseID, ev, "payment:"+cb.IntentRef+":"+cb.Status, "adapter"); err != nil {
				s.deps.Log.WarnContext(r.Context(), "payment event not applied", "err", err)
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func ptr[T ~string](p *T) string {
	if p == nil {
		return ""
	}
	return string(*p)
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" && s != "@" {
			return s
		}
	}
	return "unknown"
}

// dispatchInternal delivers a request to this API in-process (the fake payment gateway's
// callback): it goes through the full router, middleware and signature checks.
func (s *Server) dispatchInternal(r *http.Request, method, path string, headers map[string]string, body []byte) int {
	// A fresh chi route context: the outer request's routing state must not leak in.
	ctx := context.WithValue(r.Context(), chi.RouteCtxKey, nil)
	req, _ := http.NewRequestWithContext(ctx, method, path, bytes.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req.Host = r.Host
	req.RemoteAddr = "127.0.0.1:0"
	rec := &recorder{header: http.Header{}}
	s.root.ServeHTTP(rec, req)
	return rec.status
}

type recorder struct {
	header http.Header
	status int
}

func (r *recorder) Header() http.Header { return r.header }
func (r *recorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return len(b), nil
}
func (r *recorder) WriteHeader(code int) {
	if r.status == 0 {
		r.status = code
	}
}
