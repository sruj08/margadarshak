package journey

import "github.com/sruj08/margadarshak/services/api/internal/rules"

// Alerts (api/openapi.yaml Case.alerts). They are derived per request and never stored.
const (
	AlertLLExpiring         = "LL_EXPIRING"
	AlertDOBYearOnly        = "DOB_YEAR_ONLY"
	AlertRulesChanged       = "RULES_CHANGED"
	AlertSarathiDown        = "SARATHI_DOWN"
	AlertPaymentPendingLong = "PAYMENT_PENDING_LONG"
	AlertApprovalStalled    = "APPROVAL_STALLED"
)

// DisplayLLExpiring is the display-only stage that overrides the state view (brief §15).
const DisplayLLExpiring = "LL_EXPIRING"

// Product-reminder offsets (BACKEND §7.1). They schedule reminders; they are not legal rules.
const (
	LLExpiringWindowDays = 30 // LL_EXPIRING display stage and LL_EXPIRY_M30
	ApprovalChaseDays    = 3  // EC-23: no approval SMS 3 days after a pass
	NewRiderMonths       = 12 // S8 for the first 12 months after the DL
)

// ViewInput is what the derived view needs.
type ViewInput struct {
	State              State
	Today              rules.Date
	LLExpiresOn        *rules.Date
	DLTestUnlock       *rules.Date
	SlotDate           *rules.Date
	PassedOn           *rules.Date
	DLIssuedOn         *rules.Date
	DOBYearOnly        bool
	RulesChanged       bool
	SarathiDown        bool
	PaymentPendingLong bool
}

// NextAction is the single primary action (closed enum, BACKEND §5.2).
type NextAction struct {
	ActionID string
	Stage    string
	TitleKey string
	DeepLink string
	DueOn    *rules.Date
}

// View is the derived, per-request part of a case.
type View struct {
	Stage        string
	DisplayStage string
	Alerts       []string
	Next         NextAction
}

// ProductStage maps a state to S0..S9 / S6F (BACKEND §5.1 table).
func ProductStage(s State, today rules.Date, dlIssuedOn *rules.Date) string {
	switch s {
	case Plan:
		return "S1"
	case LLApplying, HandedOff, PaymentPending, LLExpired:
		return "S2"
	case LLTest:
		return "S3"
	case Bridge:
		return "S4"
	case DLBookable:
		return "S5"
	case TestBooked:
		return "S6"
	case TestFailed:
		return "S6F"
	case AwaitingApproval, DLIssued:
		return "S7"
	case DLHolder:
		if dlIssuedOn != nil && today.Before(dlIssuedOn.AddMonths(NewRiderMonths)) {
			return "S8"
		}
		return "S9"
	case RenewalDue:
		return "S9"
	}
	return "S0"
}

// LLLive reports whether the LL clock matters in this state.
func LLLive(s State) bool {
	return s == Bridge || s == DLBookable || s == TestBooked || s == TestFailed
}

// Derive computes stage, display stage, alerts and the primary action.
func Derive(in ViewInput) View {
	v := View{Stage: ProductStage(in.State, in.Today, in.DLIssuedOn), DisplayStage: string(in.State), Alerts: []string{}}
	expiring := false
	if LLLive(in.State) && in.LLExpiresOn != nil {
		d := in.Today.DaysUntil(*in.LLExpiresOn)
		if d >= 0 && d <= LLExpiringWindowDays {
			expiring = true
			v.Alerts = append(v.Alerts, AlertLLExpiring)
			v.DisplayStage = DisplayLLExpiring
		}
	}
	if in.DOBYearOnly {
		v.Alerts = append(v.Alerts, AlertDOBYearOnly)
	}
	if in.RulesChanged {
		v.Alerts = append(v.Alerts, AlertRulesChanged)
	}
	if in.SarathiDown {
		v.Alerts = append(v.Alerts, AlertSarathiDown)
	}
	if in.State == PaymentPending && in.PaymentPendingLong {
		v.Alerts = append(v.Alerts, AlertPaymentPendingLong)
	}
	if in.State == AwaitingApproval && in.PassedOn != nil && !in.Today.Before(in.PassedOn.AddDays(ApprovalChaseDays)) {
		v.Alerts = append(v.Alerts, AlertApprovalStalled)
	}
	v.Next = primary(in, v.Stage, expiring)
	return v
}

func primary(in ViewInput, stage string, expiring bool) NextAction {
	a := func(id, title, link string, due *rules.Date) NextAction {
		return NextAction{ActionID: id, Stage: stage, TitleKey: title, DeepLink: link, DueOn: due}
	}
	if expiring && (in.State == Bridge || in.State == DLBookable) {
		return a("BOOK_TEST", "next.book_before_ll_expiry", "/slots", in.LLExpiresOn)
	}
	switch in.State {
	case Plan:
		return a("RESUME_STEP", "next.start_application", "/apply", nil)
	case LLApplying:
		return a("RESUME_STEP", "next.resume_application", "/apply", nil)
	case HandedOff:
		return a("OPEN_HANDOFF", "next.open_handoff", "/apply/handoff", nil)
	case PaymentPending:
		return a("CHECK_PAYMENT", "next.check_payment", "/apply/payment-pending", nil)
	case LLTest:
		return a("TAKE_MOCK_TEST", "next.take_mock_test", "/learn/ll-simulator", nil)
	case Bridge:
		return a("PRACTISE_NAZAR", "next.practise_hazard", "/bridge/play/nazar", in.DLTestUnlock)
	case DLBookable:
		return a("BOOK_TEST", "next.book_dl_test", "/slots", nil)
	case TestBooked:
		return a("OPEN_TEST_DAY", "next.open_test_day", "/test-day", in.SlotDate)
	case TestFailed:
		return a("SEE_RETEST_PLAN", "next.see_retest_plan", "/recover", nil)
	case AwaitingApproval:
		return a("CHASE_APPROVAL", "next.chase_approval", "/track", nil)
	case DLIssued:
		return a("SHOW_CARD", "next.card_on_the_way", "/licence", nil)
	case DLHolder:
		return a("SHOW_CARD", "next.show_licence", "/licence", nil)
	case RenewalDue:
		return a("RENEW", "next.renew_licence", "/renew", nil)
	case LLExpired:
		return a("RESUME_STEP", "next.reapply_ll", "/apply/reapply", nil)
	}
	return a("START_PLAN", "next.start_plan", "/plan", nil)
}
