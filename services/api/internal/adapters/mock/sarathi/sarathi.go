// Package sarathi holds the two hackathon SarathiPort implementations (MD-037):
//
//   - Deeplink (Mode A, works today, needs no permission): builds the hand-off pack, a deep
//     link to sarathi.parivahan.gov.in and an ordered copy-pack template. It has no HTTP client
//     at all, so it can never call a government system, and it never submits anything.
//   - Mock: an in-memory application state machine with fault injection (outage, pending
//     payment) for the demo and for the EC-11 / EC-09 screens. Every value is simulated.
//
// The real Mode B adapter (NIC-granted API, api/adapters.openapi.yaml) is not part of this build.
package sarathi

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// BaseURL is the public Sarathi entry point. The state-selection path and its stateCd query
// parameter are taken from the public site as observed in research [unverified for every state].
const BaseURL = "https://sarathi.parivahan.gov.in"

const port = "sarathi"

// Deeplink is SarathiPort Mode A.
type Deeplink struct {
	Now func() time.Time
}

// NewDeeplink returns a Mode A adapter.
func NewDeeplink(now func() time.Time) *Deeplink { return &Deeplink{Now: now} }

// Mode implements ports.SarathiPort.
func (d *Deeplink) Mode() string { return "deeplink" }

// BuildHandoff implements ports.SarathiPort.
func (d *Deeplink) BuildHandoff(_ context.Context, req ports.HandoffRequest) (ports.HandoffPack, error) {
	steps, ok := templates[req.Step]
	if !ok {
		return ports.HandoffPack{}, ports.E(port, "BuildHandoff", ports.KindInvalid, "unknown step "+req.Step)
	}
	return ports.HandoffPack{
		CaseRef:           req.CaseRef,
		Step:              req.Step,
		Mode:              "A",
		Adapter:           "deeplink",
		Simulated:         false,
		TargetURL:         TargetURL(req.State),
		ProhibitedNoteKey: "handoff.note.never_share_aadhaar_otp_with_margdarshak",
		Steps:             fill(steps, req),
		ExpiresAt:         d.Now().Add(24 * time.Hour),
	}, nil
}

// ApplicationStatus implements ports.SarathiPort. Mode A cannot read status: the answer is
// "unknown", which is a valid answer (the screen decoder F-32 helps the user read Sarathi).
func (d *Deeplink) ApplicationStatus(_ context.Context, appRef string) (ports.ApplicationStatus, error) {
	return ports.ApplicationStatus{AppRef: appRef, Stage: "unknown", Payment: "none", AsOf: d.Now()}, nil
}

// Health implements ports.SarathiPort. Mode A has nothing to probe.
func (d *Deeplink) Health(context.Context) ports.Health {
	return ports.Health{Implementation: "deeplink", Status: "ok"}
}

// TargetURL is the deep link for a state.
func TargetURL(state string) string {
	u := BaseURL + "/sarathiservice/stateSelectionBased.do"
	if state != "" {
		u += "?stateCd=" + url.QueryEscape(state)
	}
	return u
}

type fieldTpl struct {
	label, vault, from string // from: "state" | "classes" | "office" | "" (vault only)
}

type stepTpl struct {
	hint, note string
	fields     []fieldTpl
}

// templates are the observed Sarathi sequences as copy-pack templates: field order and labels
// only. Personal values are vault keys filled on the device (brief §15).
var templates = map[string][]stepTpl{
	"ll_application": {
		{hint: "handoff.screen.choose_state", fields: []fieldTpl{{label: "handoff.field.state", from: "state"}}},
		{hint: "handoff.screen.choose_service", note: "handoff.note.choose_apply_ll"},
		{hint: "handoff.screen.aadhaar_ekyc_on_sarathi", note: "handoff.note.aadhaar_happens_on_sarathi_only"},
		{hint: "handoff.screen.personal_details", fields: []fieldTpl{
			{label: "handoff.field.applicant_name", vault: "applicant_name"},
			{label: "handoff.field.relation_type", vault: "relation_type"},
			{label: "handoff.field.relation_name", vault: "relation_name"},
			{label: "handoff.field.date_of_birth", vault: "date_of_birth"},
			{label: "handoff.field.gender", vault: "gender"},
			{label: "handoff.field.blood_group", vault: "blood_group"},
		}},
		{hint: "handoff.screen.address", fields: []fieldTpl{
			{label: "handoff.field.present_address", vault: "present_address"},
			{label: "handoff.field.permanent_address", vault: "permanent_address"},
		}},
		{hint: "handoff.screen.vehicle_classes", fields: []fieldTpl{{label: "handoff.field.classes", from: "classes"}}},
		{hint: "handoff.screen.rto", fields: []fieldTpl{{label: "handoff.field.rto", from: "office"}}},
		{hint: "handoff.screen.upload_photo_signature", note: "handoff.note.use_checked_photo"},
		{hint: "handoff.screen.pay_fee", note: "payment.pending.do_not_pay_twice"},
		{hint: "handoff.screen.book_ll_test", note: "handoff.note.save_application_number"},
	},
	"dl_application": {
		{hint: "handoff.screen.choose_state", fields: []fieldTpl{{label: "handoff.field.state", from: "state"}}},
		{hint: "handoff.screen.choose_service", note: "handoff.note.choose_apply_dl"},
		{hint: "handoff.screen.ll_details", fields: []fieldTpl{
			{label: "handoff.field.ll_number", vault: "ll_number"},
			{label: "handoff.field.date_of_birth", vault: "date_of_birth"},
		}},
		{hint: "handoff.screen.vehicle_classes", fields: []fieldTpl{{label: "handoff.field.classes", from: "classes"}}},
		{hint: "handoff.screen.pay_fee", note: "payment.pending.do_not_pay_twice"},
	},
	"slot_booking": {
		{hint: "handoff.screen.choose_state", fields: []fieldTpl{{label: "handoff.field.state", from: "state"}}},
		{hint: "handoff.screen.slot_booking", note: "handoff.note.slots_booked_on_sarathi", fields: []fieldTpl{
			{label: "handoff.field.application_number", vault: "application_number"},
			{label: "handoff.field.rto", from: "office"},
		}},
	},
	"fee_payment": {
		{hint: "handoff.screen.fee_payment", note: "payment.pending.do_not_pay_twice", fields: []fieldTpl{
			{label: "handoff.field.application_number", vault: "application_number"},
		}},
	},
}

func fill(tpls []stepTpl, req ports.HandoffRequest) []ports.HandoffStep {
	out := make([]ports.HandoffStep, 0, len(tpls))
	for i, s := range tpls {
		step := ports.HandoffStep{Order: i + 1, ScreenHintKey: s.hint, NoteKey: s.note}
		for _, f := range s.fields {
			hf := ports.HandoffField{LabelKey: f.label, VaultKey: f.vault, Copyable: true}
			switch f.from {
			case "state":
				hf.Value = req.State
			case "classes":
				classes := append([]string(nil), req.Classes...)
				sort.Strings(classes)
				hf.Value = strings.Join(classes, ", ")
			case "office":
				hf.Value = req.Office
			}
			step.Fields = append(step.Fields, hf)
		}
		out = append(out, step)
	}
	return out
}

// ---- Mock -------------------------------------------------------------------------------

// Mock application statuses (simulated; modelled on the observed Sarathi vocabulary).
const (
	StatusSubmitted        = "Application Submitted"
	StatusPaymentPending   = "Payment Pending"
	StatusLLTestPending    = "Fee Paid - LL Test Pending"
	StatusLLIssued         = "LL Issued"
	StatusDLTestBooked     = "DL Test Slot Booked"
	StatusDLApprovalWait   = "DL Test Passed - Approval Pending"
	StatusDLApprovedIssued = "DL Approved"
)

var stageOf = map[string]string{
	StatusSubmitted:        "S2",
	StatusPaymentPending:   "S2",
	StatusLLTestPending:    "S3",
	StatusLLIssued:         "S4",
	StatusDLTestBooked:     "S5",
	StatusDLApprovalWait:   "S7",
	StatusDLApprovedIssued: "S7",
}

type application struct {
	status  string
	payment string
	updated time.Time
}

// Mock is the in-memory Sarathi simulator.
type Mock struct {
	mu    sync.Mutex
	apps  map[string]*application
	seq   int
	fault ports.Fault
	now   func() time.Time
	dl    *Deeplink
}

// NewMock returns an empty simulator.
func NewMock(now func() time.Time) *Mock {
	return &Mock{apps: map[string]*application{}, now: now, dl: NewDeeplink(now)}
}

// Mode implements ports.SarathiPort.
func (m *Mock) Mode() string { return "mock" }

// InjectFault implements ports.FaultInjector.
func (m *Mock) InjectFault(f ports.Fault) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fault = f
}

func (m *Mock) checkFault(ctx context.Context, op string) error {
	m.mu.Lock()
	f := m.fault
	m.mu.Unlock()
	switch f {
	case ports.FaultOutage:
		return ports.E(port, op, ports.KindUnavailable, "simulated Sarathi outage")
	case ports.FaultTimeout:
		<-ctx.Done()
		return ports.E(port, op, ports.KindTimeout, "simulated timeout")
	}
	return nil
}

// BuildHandoff implements ports.SarathiPort (same pack as Mode A, labelled simulated).
func (m *Mock) BuildHandoff(ctx context.Context, req ports.HandoffRequest) (ports.HandoffPack, error) {
	if err := m.checkFault(ctx, "BuildHandoff"); err != nil {
		return ports.HandoffPack{}, err
	}
	p, err := m.dl.BuildHandoff(ctx, req)
	if err != nil {
		return p, ports.E(port, "BuildHandoff", ports.KindInvalid, "unknown step "+req.Step)
	}
	p.Adapter, p.Simulated = "mock", true
	return p, nil
}

// StartApplication creates a simulated application (demo helper; not on the port).
func (m *Mock) StartApplication(state string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seq++
	ref := fmt.Sprintf("SIM-%s-LL-%06d", state, m.seq)
	status, payment := StatusSubmitted, "none"
	if m.fault == ports.FaultPendingPayment {
		status, payment = StatusPaymentPending, "pending"
	}
	m.apps[ref] = &application{status: status, payment: payment, updated: m.now()}
	return ref
}

// Advance moves a simulated application to a new status (demo helper).
func (m *Mock) Advance(ref, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.apps[ref]
	if !ok {
		return ports.E(port, "Advance", ports.KindNotFound, ref)
	}
	if _, ok := stageOf[status]; !ok {
		return ports.E(port, "Advance", ports.KindInvalid, "unknown status")
	}
	a.status, a.updated = status, m.now()
	switch status {
	case StatusPaymentPending:
		a.payment = "pending"
	case StatusSubmitted:
	default:
		a.payment = "confirmed"
	}
	return nil
}

// ApplicationStatus implements ports.SarathiPort.
func (m *Mock) ApplicationStatus(ctx context.Context, appRef string) (ports.ApplicationStatus, error) {
	if err := m.checkFault(ctx, "ApplicationStatus"); err != nil {
		return ports.ApplicationStatus{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.apps[appRef]
	if !ok {
		return ports.ApplicationStatus{}, ports.E(port, "ApplicationStatus", ports.KindNotFound, "no such simulated application")
	}
	return ports.ApplicationStatus{
		AppRef: appRef, Stage: stageOf[a.status], StatusCode: a.status, Payment: a.payment, AsOf: a.updated, Simulated: true,
	}, nil
}

// Health implements ports.SarathiPort.
func (m *Mock) Health(context.Context) ports.Health {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fault == ports.FaultOutage {
		return ports.Health{Implementation: "mock", Status: "down", Detail: "simulated outage (EC-11)"}
	}
	return ports.Health{Implementation: "mock", Status: "ok"}
}

// PushPrefill implements ports.SarathiPrefill (Mode B skeleton, MD-116): the simulator opens an
// application for the non-personal prefill and returns its simulated reference.
func (m *Mock) PushPrefill(ctx context.Context, req ports.PrefillRequest) (ports.PrefillReceipt, error) {
	if err := m.checkFault(ctx, "PushPrefill"); err != nil {
		return ports.PrefillReceipt{}, err
	}
	if req.State == "" || len(req.Classes) == 0 {
		return ports.PrefillReceipt{}, ports.E(port, "PushPrefill", ports.KindInvalid, "state and classes are required")
	}
	return ports.PrefillReceipt{AppRef: m.StartApplication(req.State), Simulated: true}, nil
}

var _ ports.SarathiPrefill = (*Mock)(nil)
