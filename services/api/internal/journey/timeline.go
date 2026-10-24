package journey

import (
	"sort"

	"github.com/sruj08/margadarshak/services/api/internal/rules"
)

// Milestone codes (BACKEND §7.1, api/openapi.yaml TimelineEvent.code).
const (
	MLLDay25Prep    = "LL_DAY_25_PREP"
	MLLDay30Unlock  = "LL_DAY_30_UNLOCK"
	MLLExpiryM30    = "LL_EXPIRY_M30"
	MLLExpiryM7     = "LL_EXPIRY_M7"
	MLLExpiry       = "LL_EXPIRY"
	MTestEve        = "TEST_EVE"
	MRetestEligible = "RETEST_ELIGIBLE"
	MApprovalChase  = "APPROVAL_CHASE"
	MForm1AAt40     = "FORM_1A_AT_40"
	MDLRenewalM60   = "DL_RENEWAL_M60"
	MDLExpired      = "DL_EXPIRED"
	MDLExpiredY1    = "DL_EXPIRED_Y1"
)

// More product-reminder offsets (BACKEND §7.1).
const (
	PrepDaysBeforeUnlock   = 5  // LL_DAY_25_PREP = unlock - 5
	RenewalReminderDays    = 60 // DL_RENEWAL_M60; also the renewal window shown on My Licence
	LLExpiryFinalReminder  = 7  // LL_EXPIRY_M7
	DLLateRetestAfterYears = 1  // EC-16: more than 1 year late means a retest [verify, P4]
)

// Product rule IDs for reminders that have no rule-pack row (they schedule messages; the legal
// facts behind them are the pack rows named in the comments).
const (
	RuleTestEve       = "TL-TEST-EVE"
	RuleApprovalChase = "TL-APPROVAL-CHASE"
	RuleDLRenewal     = "TL-DL-RENEWAL"
)

// Kinds of timeline rows.
const (
	KindMilestone = "milestone"
	KindReminder  = "reminder"
	KindDeadline  = "deadline"
)

// Milestone is one scheduled TimelineEvent (E-12).
type Milestone struct {
	Code   string
	Kind   string
	DueOn  rules.Date
	RuleID string
}

// RuleIDs are the effective rule-pack row IDs behind the dates (state overrides apply).
type RuleIDs struct {
	MinWait, Validity, RetestGap, Form1A string
}

// ScheduleInput is the dated state of a case.
type ScheduleInput struct {
	State        State
	LLIssuedOn   *rules.Date
	LLExpiresOn  *rules.Date
	DLTestUnlock *rules.Date
	SlotDate     *rules.Date
	LastFailOn   *rules.Date
	PassedOn     *rules.Date
	DLValidTo    *rules.Date
	Form1ADue    *rules.Date // EC-04: 40th birthday inside the LL window (rules engine WRN-TURNING-40)
	RetestGap    int
	Rules        RuleIDs
}

// Schedule computes every milestone that applies to the case in its current state. It is pure:
// the same input always gives the same list (sorted by date, then code), so recomputation is
// idempotent by key "{caseId}:{code}:{dueOn}".
func Schedule(in ScheduleInput) []Milestone {
	var out []Milestone
	add := func(code, kind, rule string, d *rules.Date) {
		if d != nil {
			out = append(out, Milestone{Code: code, Kind: kind, DueOn: *d, RuleID: rule})
		}
	}
	shift := func(d *rules.Date, n int) *rules.Date {
		if d == nil {
			return nil
		}
		x := d.AddDays(n)
		return &x
	}
	if (in.State == Bridge || in.State == DLBookable) && in.DLTestUnlock != nil {
		add(MLLDay25Prep, KindMilestone, in.Rules.MinWait, shift(in.DLTestUnlock, -PrepDaysBeforeUnlock))
		add(MLLDay30Unlock, KindMilestone, in.Rules.MinWait, in.DLTestUnlock)
	}
	if LLLive(in.State) && in.LLExpiresOn != nil {
		add(MLLExpiryM30, KindReminder, in.Rules.Validity, shift(in.LLExpiresOn, -LLExpiringWindowDays))
		add(MLLExpiryM7, KindReminder, in.Rules.Validity, shift(in.LLExpiresOn, -LLExpiryFinalReminder))
		add(MLLExpiry, KindDeadline, in.Rules.Validity, shift(in.LLExpiresOn, 1)) // first day it is expired
	}
	if in.State == TestBooked && in.SlotDate != nil {
		add(MTestEve, KindMilestone, RuleTestEve, shift(in.SlotDate, -1))
	}
	if in.State == TestFailed && in.LastFailOn != nil && in.RetestGap > 0 {
		add(MRetestEligible, KindMilestone, in.Rules.RetestGap, shift(in.LastFailOn, in.RetestGap))
	}
	if in.State == AwaitingApproval && in.PassedOn != nil {
		add(MApprovalChase, KindMilestone, RuleApprovalChase, shift(in.PassedOn, ApprovalChaseDays))
	}
	if in.Form1ADue != nil && beforeDL(in.State) {
		add(MForm1AAt40, KindMilestone, in.Rules.Form1A, in.Form1ADue)
	}
	if (in.State == DLHolder || in.State == RenewalDue) && in.DLValidTo != nil {
		add(MDLRenewalM60, KindReminder, RuleDLRenewal, shift(in.DLValidTo, -RenewalReminderDays))
		add(MDLExpired, KindDeadline, RuleDLRenewal, shift(in.DLValidTo, 1))
		y1 := in.DLValidTo.AddMonths(12 * DLLateRetestAfterYears).AddDays(1)
		add(MDLExpiredY1, KindDeadline, RuleDLRenewal, &y1)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].DueOn != out[j].DueOn {
			return out[i].DueOn.Before(out[j].DueOn)
		}
		return out[i].Code < out[j].Code
	})
	return out
}

func beforeDL(s State) bool {
	switch s {
	case Plan, LLApplying, HandedOff, PaymentPending, LLTest, Bridge, DLBookable, TestBooked, TestFailed:
		return true
	}
	return false
}

// RenewalWindowOpens is the date the renewal reminder and the RENEWAL_DUE state start.
func RenewalWindowOpens(validTo rules.Date) rules.Date { return validTo.AddDays(-RenewalReminderDays) }

// ClockEvent is the system event a milestone applies when the sweep fires it.
func ClockEvent(code string) (Event, bool) {
	switch code {
	case MLLDay30Unlock:
		return DLUnlocked, true
	case MLLExpiry:
		return LLExpiredEv, true
	case MDLRenewalM60:
		return RenewalWindowOpened, true
	}
	return "", false
}

// Priority orders milestones for the daily nudge cap (deadlines first). Lower is more urgent.
func Priority(code string) int {
	switch code {
	case MLLExpiry, MDLExpired, MDLExpiredY1:
		return 0
	case MLLExpiryM7:
		return 1
	case MTestEve:
		return 2
	case MLLExpiryM30:
		return 3
	case MLLDay30Unlock:
		return 4
	case MRetestEligible:
		return 5
	case MApprovalChase:
		return 6
	case MForm1AAt40:
		return 7
	case MDLRenewalM60:
		return 8
	case MLLDay25Prep:
		return 9
	}
	return 10
}

// TemplateID is the approved message template for a milestone (n8n/templates.md, MD-131).
func TemplateID(code string) string {
	b := make([]byte, 0, len(code)+3)
	for i := 0; i < len(code); i++ {
		c := code[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b = append(b, c)
	}
	return string(b) + "_v1"
}
