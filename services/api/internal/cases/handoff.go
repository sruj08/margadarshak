package cases

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/journey"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/rulekit"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/tenant"
)

// HandoffField is one copy-pack field. Personal values are never returned: vault_key names the
// on-device vault entry (brief §15).
type HandoffField struct {
	LabelKey string  `json:"label_key"`
	VaultKey *string `json:"vault_key"`
	Value    *string `json:"value"`
	Copyable bool    `json:"copyable"`
}

// HandoffStep is one Sarathi screen.
type HandoffStep struct {
	Order         int            `json:"order"`
	ScreenHintKey string         `json:"screen_hint_key"`
	NoteKey       string         `json:"note_key,omitempty"`
	Fields        []HandoffField `json:"fields"`
}

// HandoffOut is the API-16 response (HandoffPack).
type HandoffOut struct {
	CaseID            string         `json:"case_id"`
	Step              string         `json:"step"`
	Mode              string         `json:"mode"`
	Adapter           string         `json:"adapter"`
	Simulated         bool           `json:"simulated"`
	TargetURL         string         `json:"target_url"`
	ProhibitedNoteKey string         `json:"prohibited_note_key,omitempty"`
	Steps             []HandoffStep  `json:"steps"`
	ExpiresAt         *time.Time     `json:"expires_at,omitempty"`
	Flags             []string       `json:"flags"`
	Prefill           map[string]any `json:"prefill"`
}

var officeRe = regexp.MustCompile(`^[A-Za-z0-9_-]{2,40}$`)

func defaultStep(state journey.State) string {
	switch state {
	case journey.Bridge, journey.DLBookable, journey.TestFailed, journey.TestBooked:
		return "slot_booking"
	case journey.AwaitingApproval, journey.DLIssued, journey.DLHolder, journey.RenewalDue:
		return "dl_application"
	}
	return "ll_application"
}

// modeB reports whether the tenant runs the government-hosted Mode B (MD-116): the tenant flag
// sarathi_mode_b (or a government-hosted tenant) and an adapter that can push a prefill.
func modeB(t *tenant.Tenant) (ports.SarathiPrefill, bool) {
	if t == nil || t.Adapters.Sarathi == nil {
		return nil, false
	}
	if !t.Feature("sarathi_mode_b") && t.HostingMode != "government_hosted" {
		return nil, false
	}
	pf, ok := t.Adapters.Sarathi.(ports.SarathiPrefill)
	return pf, ok
}

// Handoff builds the Sarathi hand-off pack (API-16). Mode A: deep link + copy-pack template
// (labels, order and non-personal values only). Mode B: the adapter receives a non-personal
// prefill once and the state system takes over. Aadhaar eKYC, OTP, payment and submission always
// happen on Sarathi or the state gateway (D-07).
func (s *Service) Handoff(ctx context.Context, p *accounts.Principal, t *tenant.Tenant, caseRef, step string) (*HandoffOut, error) {
	id, err := decodeRef(caseRef)
	if err != nil {
		return nil, err
	}
	var out *HandoffOut
	err = s.DB.Tenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		sn, err := s.load(ctx, tx, p, id, true)
		if err != nil {
			return err
		}
		if step == "" {
			step = defaultStep(journey.State(sn.Case.State))
		}
		office := ""
		for _, k := range []string{"preferred_office", "preferred_office_id"} {
			if v, ok := sn.Case.Answers[k].(string); ok && officeRe.MatchString(v) {
				office = v
				break
			}
		}
		req := ports.HandoffRequest{CaseRef: sn.Ref, Step: step, State: sn.Pack.PackID, Classes: rulekit.SarathiCodes(sn.Pack, sn.Case.Classes), Office: office}
		pack, err := t.Adapters.Sarathi.BuildHandoff(ctx, req)
		if err != nil {
			return err
		}
		out = &HandoffOut{CaseID: sn.Ref, Step: pack.Step, Mode: "A", Adapter: adapterName(pack.Adapter), Simulated: pack.Simulated, TargetURL: pack.TargetURL,
			ProhibitedNoteKey: pack.ProhibitedNoteKey, Steps: []HandoffStep{}, Flags: []string{}}
		if !pack.ExpiresAt.IsZero() {
			e := pack.ExpiresAt.UTC()
			out.ExpiresAt = &e
		}
		for _, st := range pack.Steps {
			hs := HandoffStep{Order: st.Order, ScreenHintKey: st.ScreenHintKey, NoteKey: st.NoteKey, Fields: []HandoffField{}}
			for _, f := range st.Fields {
				hf := HandoffField{LabelKey: f.LabelKey, Copyable: f.Copyable}
				if f.VaultKey != "" {
					vk := f.VaultKey
					hf.VaultKey = &vk // filled on the device, never by the server
				} else if f.Value != "" {
					v := f.Value
					hf.Value = &v
				}
				hs.Fields = append(hs.Fields, hf)
			}
			out.Steps = append(out.Steps, hs)
		}
		if h := t.Adapters.Sarathi.Health(ctx); h.Status != "ok" {
			out.Flags = append(out.Flags, "outage_banner")
		}
		if pf, ok := modeB(t); ok && step == "ll_application" {
			out.Mode = "B"
			status := "already_sent"
			if len(sn.Case.AppRefEnc) == 0 {
				rec, err := pf.PushPrefill(ctx, ports.PrefillRequest{CaseRef: sn.Ref, State: sn.Pack.PackID, Classes: req.Classes, Office: office})
				if err != nil {
					return err
				}
				enc, err := s.Vault.EncryptString(sn.Case.TenantID, "cases.app_ref", rec.AppRef)
				if err != nil {
					return err
				}
				sn.Case.AppRefEnc = enc
				sn.Case.AppStatus = map[string]any{"mode": "B", "stage": "S2", "payment": "none", "reference_last4": last4(rec.AppRef),
					"simulated": rec.Simulated, "as_of": s.now().UTC().Format(time.RFC3339)}
				sn.dirty = true
				status = "sent"
				out.Flags = append(out.Flags, "mode_b_prefill_sent")
				if err := store.SaveCase(ctx, tx, sn.Case); err != nil {
					return err
				}
				sn.dirty = false
				if err := s.auditCase(ctx, tx, sn, actor{kind: "applicant", subject: p.Subject(), scope: p.Scope}, "adapter.sarathi.prefill",
					map[string]any{"adapter": t.Adapters.Modes["sarathi"], "simulated": rec.Simulated}); err != nil {
					return err
				}
			}
			out.Prefill = map[string]any{"status": status, "reference_last4": sn.Case.AppStatus["reference_last4"], "simulated": pack.Simulated}
		}
		return nil
	})
	return out, err
}

func adapterName(a string) string {
	switch a {
	case "mock", "deeplink", "nic":
		return a
	}
	return "deeplink"
}

func last4(s string) string {
	if len(s) <= 4 {
		return s
	}
	return s[len(s)-4:]
}

// refreshModeB mirrors the application status read through the adapter (MD-117), Mode B only.
func (s *Service) refreshModeB(ctx context.Context, sn *Snapshot, t *tenant.Tenant) {
	if len(sn.Case.AppRefEnc) == 0 || t == nil || t.Adapters.Sarathi == nil {
		return
	}
	appRef, err := s.Vault.DecryptString(sn.Case.TenantID, "cases.app_ref", sn.Case.AppRefEnc)
	if err != nil {
		return
	}
	cctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	st, err := t.Adapters.Sarathi.ApplicationStatus(cctx, appRef)
	if err != nil {
		return
	}
	payment := st.Payment
	switch payment {
	case "none", "pending", "confirmed":
	default:
		payment = "none"
	}
	next := map[string]any{"mode": "B", "stage": st.Stage, "payment": payment, "reference_last4": last4(appRef), "simulated": st.Simulated,
		"as_of": st.AsOf.UTC().Format(time.RFC3339)}
	if sn.Case.AppStatus == nil || sn.Case.AppStatus["stage"] != next["stage"] || sn.Case.AppStatus["payment"] != next["payment"] {
		sn.Case.AppStatus = next
		sn.dirty = true
	}
}

// ---- Payment intents (API-19, EC-09) ---------------------------------------------------------

// PaymentOut is the API-19 response.
type PaymentOut struct {
	PaymentIntentID    string `json:"payment_intent_id"`
	Adapter            string `json:"adapter"`
	RedirectURL        string `json:"redirect_url"`
	AmountPaise        int64  `json:"amount_paise"`
	CollectedBy        string `json:"collected_by"`
	Status             string `json:"status"`
	PendingGuidanceKey string `json:"pending_guidance_key"`
}

var returnPathRe = regexp.MustCompile(`^/[A-Za-z0-9/_\-]{0,120}$`)

// PaymentIntent issues a redirect to the state's gateway (or Sarathi) for a quote of this case.
// The amount comes from the stored fee quote, re-checked against fees.json; Margdarshak never
// collects the fee (D-07). A payment still pending at the gateway blocks a second one (EC-09).
func (s *Service) PaymentIntent(ctx context.Context, p *accounts.Principal, t *tenant.Tenant, caseRef, quoteRef, stage, returnPath string) (*PaymentOut, error) {
	id, err := decodeRef(caseRef)
	if err != nil {
		return nil, err
	}
	qid, err := ids.Decode(ids.Quote, quoteRef)
	if err != nil {
		return nil, &ValidationError{Pointer: "/quote_id", Code: "unknown_quote"}
	}
	if stage == "" {
		stage = "all"
	}
	if returnPath == "" {
		returnPath = "/case/payment-return"
	}
	if !returnPathRe.MatchString(returnPath) || strings.Contains(returnPath, "//") {
		return nil, &ValidationError{Pointer: "/return_path", Code: "invalid_path"}
	}
	var out *PaymentOut
	err = s.DB.Tenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		sn, err := s.load(ctx, tx, p, id, true)
		if err != nil {
			return err
		}
		q, err := store.GetFeeQuote(ctx, tx, qid)
		if errors.Is(err, store.ErrNotFound) {
			return &ValidationError{Pointer: "/quote_id", Code: "unknown_quote"}
		}
		if err != nil {
			return err
		}
		mine := (q.CaseID != nil && *q.CaseID == id) || (q.PlanID != nil && sn.Case.PlanID != nil && *q.PlanID == *sn.Case.PlanID)
		if !mine {
			return &ValidationError{Pointer: "/quote_id", Code: "unknown_quote"}
		}
		fresh := sn.Pack.FeeQuote(q.Classes)
		if fresh.TotalPaise != q.TotalPaise || q.RulePackVersion != sn.Pack.Version {
			return &ConflictError{Code: "QUOTE_STALE", Detail: "the fee table changed; fetch the case for a fresh quote", Pointer: "/quote_id"}
		}
		if pending, err := store.OpenPaymentForCase(ctx, tx, id); err == nil {
			return &ConflictError{Code: "PAYMENT_PENDING", Detail: "a payment is still pending at the gateway: do not pay twice (" +
				ids.Encode(ids.PaymentIntent, pending.ID) + ")", Reason: "payment.pending.do_not_pay_twice"}
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		var amount int64
		switch stage {
		case "all":
			amount = fresh.TotalPaise
		case "ll":
			amount = fresh.LLStagePaise
		case "dl":
			amount = fresh.TotalPaise - fresh.LLStagePaise
		default:
			return &ValidationError{Pointer: "/stage", Code: "invalid_enum"}
		}
		pid := ids.New()
		pref := ids.Encode(ids.PaymentIntent, pid)
		red, err := t.Adapters.Payment.StartPayment(ctx, ports.PaymentRequest{IntentRef: pref, AmountPaise: int(amount),
			ReturnURL:   strings.TrimRight(s.WebBaseURL, "/") + returnPath,
			CallbackURL: strings.TrimRight(s.PublicBaseURL, "/") + "/internal/webhooks/payment/" + t.Adapters.Payment.Mode()})
		if err != nil {
			return err
		}
		st := stage
		row := &store.PaymentIntent{ID: pid, TenantID: t.TenantID, ApplicantID: sn.Case.ApplicantID, CaseID: &id, QuoteID: &qid, Stage: &st,
			Adapter: t.Adapters.Payment.Mode(), RedirectURL: red.URL, ReturnPath: returnPath, AmountPaise: int(amount), Status: "redirected"}
		if err := store.InsertPaymentIntent(ctx, tx, row); err != nil {
			return err
		}
		if err := s.auditCase(ctx, tx, sn, actor{kind: "applicant", subject: p.Subject(), scope: p.Scope}, "payment.intent_created",
			map[string]any{"amount_paise": amount, "adapter": row.Adapter, "stage": stage}); err != nil {
			return err
		}
		out = &PaymentOut{PaymentIntentID: pref, Adapter: row.Adapter, RedirectURL: red.URL, AmountPaise: amount, CollectedBy: "state_gateway",
			Status: "redirected", PendingGuidanceKey: "payment.pending.do_not_pay_twice"}
		return nil
	})
	return out, err
}
