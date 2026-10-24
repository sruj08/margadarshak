// Package journey is the authoritative journey state machine (MD-121, F-08, BACKEND §5) and the
// case-clock schedule (MD-125, F-09). It is pure: no I/O, no clock reads (the caller passes the
// server's IST date, EC-15), only plain values in and out, so every decision is table-driven and
// testable.
//
// Persisted: the 14 journey states. Derived per request: the product stage (S0..S9, S6F), the
// display stage (LL_EXPIRING overrides the state view) and the alerts, and the single primary
// action.
package journey

import (
	"fmt"
	"sort"

	"github.com/sruj08/margadarshak/services/api/internal/rules"
)

// State is a persisted journey state.
type State string

// The 14 persisted states (api/openapi.yaml JourneyState).
const (
	Plan             State = "PLAN"
	LLApplying       State = "LL_APPLYING"
	HandedOff        State = "HANDED_OFF"
	PaymentPending   State = "PAYMENT_PENDING"
	LLTest           State = "LL_TEST"
	Bridge           State = "BRIDGE"
	DLBookable       State = "DL_BOOKABLE"
	TestBooked       State = "TEST_BOOKED"
	TestFailed       State = "TEST_FAILED"
	AwaitingApproval State = "AWAITING_APPROVAL"
	DLIssued         State = "DL_ISSUED"
	DLHolder         State = "DL_HOLDER"
	LLExpired        State = "LL_EXPIRED"
	RenewalDue       State = "RENEWAL_DUE"
)

// States lists every persisted state.
var States = []State{Plan, LLApplying, HandedOff, PaymentPending, LLTest, Bridge, DLBookable, TestBooked, TestFailed,
	AwaitingApproval, DLIssued, DLHolder, LLExpired, RenewalDue}

// Valid reports whether s is a persisted state.
func (s State) Valid() bool {
	for _, x := range States {
		if x == s {
			return true
		}
	}
	return false
}

// Event is a journey event type.
type Event string

// Client events (API-15, PROJECT_BRIEF §15) and system (clock) events.
const (
	LLApplicationStarted Event = "ll_application_started"
	HandoffDone          Event = "handoff_done"
	PaymentPendingEv     Event = "payment_pending"
	PaymentConfirmed     Event = "payment_confirmed"
	LLTestFailedEv       Event = "ll_test_failed"
	LLIssued             Event = "ll_issued"
	SlotBooked           Event = "slot_booked"
	TestFailedEv         Event = "test_failed"
	TestPassed           Event = "test_passed"
	Approved             Event = "approved"
	CardReceived         Event = "card_received"
	Reapply              Event = "reapply"
	Renewed              Event = "renewed"

	// System events written by the case clock (never accepted from a client).
	DLUnlocked           Event = "dl_unlocked"
	LLExpiredEv          Event = "ll_expired"
	RenewalWindowOpened  Event = "renewal_window_opened"
	CaseStarted          Event = "case_started"
	AnswersSaved         Event = "answers_saved"
	ApplicationStartedV1 Event = "application_started" // alias of ll_application_started (openapi CaseEventType)
)

// ClientEvents are the events API-15 accepts.
var ClientEvents = []Event{LLApplicationStarted, HandoffDone, PaymentPendingEv, PaymentConfirmed, LLTestFailedEv, LLIssued,
	SlotBooked, TestFailedEv, TestPassed, Approved, CardReceived, Reapply, Renewed}

// SystemEvents are written by the case clock.
var SystemEvents = []Event{DLUnlocked, LLExpiredEv, RenewalWindowOpened}

// AllEvents is every event the machine knows.
var AllEvents = append(append([]Event{}, ClientEvents...), SystemEvents...)

// Normalize maps aliases to the canonical event name.
func Normalize(e Event) Event {
	if e == ApplicationStartedV1 {
		return LLApplicationStarted
	}
	return e
}

// IsClient reports whether a client may send e.
func IsClient(e Event) bool {
	e = Normalize(e)
	for _, x := range ClientEvents {
		if x == e {
			return true
		}
	}
	return false
}

// Facts are the dated facts guards look at (IST calendar dates; nil = unknown).
type Facts struct {
	Today        rules.Date
	DLTestUnlock *rules.Date // LL issue + min_wait_days (TL-LL-MIN-WAIT)
	LLExpiresOn  *rules.Date
	LastFailOn   *rules.Date
	RetestGap    int // PRM-RETEST-GAP-DAYS
	Fails        int // DL test fails so far (EC-08)
	RemedialAck  bool
	RemedialRule bool // PRM-REMEDIAL-AFTER-FAIL in force
}

// Input is one event to apply.
type Input struct {
	Event    Event
	SlotDate *rules.Date // slot_booked
	On       rules.Date  // occurred_on (or today for system events)
}

// Error is a journey decision error. Code is JOURNEY_INVALID_TRANSITION (409) or a guard code.
type Error struct {
	Code   string
	From   State
	Event  Event
	Detail string
}

func (e *Error) Error() string {
	return fmt.Sprintf("journey: %s (%s in %s): %s", e.Code, e.Event, e.From, e.Detail)
}

// Codes returned by Apply.
const (
	CodeInvalidTransition = "JOURNEY_INVALID_TRANSITION"
	CodeTooEarly          = "JOURNEY_TOO_EARLY"
	CodeRemedialRequired  = "JOURNEY_REMEDIAL_REQUIRED"
)

type guard func(f Facts, in Input) *Error

type transition struct {
	to    State
	guard guard
}

type key struct {
	from State
	ev   Event
}

// slotAfterUnlock: a test slot may be booked during the bridge for a date on or after the
// day-30 unlock (EC-07: "book now for a date after day 30").
func slotAfterUnlock(f Facts, in Input) *Error {
	if f.DLTestUnlock == nil {
		return nil
	}
	day := in.On
	if in.SlotDate != nil {
		day = *in.SlotDate
	}
	if day.Before(*f.DLTestUnlock) {
		return &Error{Code: CodeTooEarly, Detail: "the driving test can be taken from " + f.DLTestUnlock.String() + " (TL-LL-MIN-WAIT)"}
	}
	return nil
}

// retestAfterGap: a retest is booked no earlier than the pack's gap after the fail (EC-08,
// TL-RETEST-GAP); after the pack's remedial rule applies (3 or more fails), the learner confirms
// the remedial training first.
func retestAfterGap(f Facts, in Input) *Error {
	if f.LastFailOn != nil && f.RetestGap > 0 {
		earliest := f.LastFailOn.AddDays(f.RetestGap)
		day := in.On
		if in.SlotDate != nil {
			day = *in.SlotDate
		}
		if day.Before(earliest) {
			return &Error{Code: CodeTooEarly, Detail: "a retest can be taken from " + earliest.String() + " (TL-RETEST-GAP)"}
		}
	}
	if f.RemedialRule && f.Fails >= 3 && !f.RemedialAck {
		return &Error{Code: CodeRemedialRequired, Detail: "after 3 attempts the rules ask for remedial training before the next test"}
	}
	return nil
}

func whenUnlocked(f Facts, in Input) *Error {
	if f.DLTestUnlock != nil && in.On.Before(*f.DLTestUnlock) {
		return &Error{Code: CodeTooEarly, Detail: "not yet day " + f.DLTestUnlock.String()}
	}
	return nil
}

func whenExpired(f Facts, in Input) *Error {
	if f.LLExpiresOn != nil && !in.On.After(*f.LLExpiresOn) {
		return &Error{Code: CodeTooEarly, Detail: "the LL is valid until " + f.LLExpiresOn.String()}
	}
	return nil
}

// table is the transition table. A (state, event) pair that is not here is rejected with
// JOURNEY_INVALID_TRANSITION (409): every pair has a defined outcome.
var table = map[key]transition{
	{Plan, LLApplicationStarted}: {to: LLApplying},
	{Plan, HandoffDone}:          {to: HandedOff},
	{Plan, LLIssued}:             {to: Bridge}, // EC-22: already holds an LL

	{LLApplying, HandoffDone}:      {to: HandedOff},
	{LLApplying, PaymentPendingEv}: {to: PaymentPending},
	{LLApplying, PaymentConfirmed}: {to: LLTest},
	{LLApplying, LLIssued}:         {to: Bridge},

	{HandedOff, PaymentPendingEv}: {to: PaymentPending},
	{HandedOff, PaymentConfirmed}: {to: LLTest},
	{HandedOff, LLIssued}:         {to: Bridge},

	{PaymentPending, PaymentConfirmed}: {to: LLTest},
	{PaymentPending, LLIssued}:         {to: Bridge},

	{LLTest, LLTestFailedEv}: {to: LLTest},
	{LLTest, LLIssued}:       {to: Bridge},

	{Bridge, DLUnlocked}:  {to: DLBookable, guard: whenUnlocked},
	{Bridge, SlotBooked}:  {to: TestBooked, guard: slotAfterUnlock},
	{Bridge, LLExpiredEv}: {to: LLExpired, guard: whenExpired},

	{DLBookable, SlotBooked}:  {to: TestBooked, guard: slotAfterUnlock},
	{DLBookable, LLExpiredEv}: {to: LLExpired, guard: whenExpired},

	{TestBooked, SlotBooked}:   {to: TestBooked, guard: slotAfterUnlock}, // rescheduled
	{TestBooked, TestFailedEv}: {to: TestFailed},
	{TestBooked, TestPassed}:   {to: AwaitingApproval},
	{TestBooked, LLExpiredEv}:  {to: LLExpired, guard: whenExpired},

	{TestFailed, SlotBooked}:  {to: TestBooked, guard: retestAfterGap},
	{TestFailed, TestPassed}:  {to: AwaitingApproval},
	{TestFailed, LLExpiredEv}: {to: LLExpired, guard: whenExpired},

	{AwaitingApproval, Approved}:     {to: DLIssued},
	{AwaitingApproval, CardReceived}: {to: DLHolder},

	{DLIssued, CardReceived}: {to: DLHolder},

	{DLHolder, RenewalWindowOpened}: {to: RenewalDue},
	{RenewalDue, Renewed}:           {to: DLHolder},

	{LLExpired, Reapply}: {to: LLApplying}, // EC-07: a new application number
}

// Apply returns the state after ev, or an *Error. It is pure.
func Apply(from State, f Facts, in Input) (State, error) {
	in.Event = Normalize(in.Event)
	t, ok := table[key{from, in.Event}]
	if !ok {
		return from, &Error{Code: CodeInvalidTransition, From: from, Event: in.Event,
			Detail: fmt.Sprintf("%s is not allowed while the case is in %s", in.Event, from)}
	}
	if t.guard != nil {
		if err := t.guard(f, in); err != nil {
			err.From, err.Event = from, in.Event
			return from, err
		}
	}
	return t.to, nil
}

// Allowed lists the events accepted in a state (sorted), for the client and for tests.
func Allowed(from State) []Event {
	var out []Event
	for k := range table {
		if k.from == from {
			out = append(out, k.ev)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// CatchUp applies the clock events whose dates have passed (day-30 unlock, LL expiry, renewal
// window), in order, and returns the final state and the events applied. It lets the server
// keep a case right even when the daily sweep has not run yet (EC-15: server date only).
func CatchUp(from State, f Facts, renewalWindowOpens *rules.Date) (State, []Event) {
	state := from
	var applied []Event
	for i := 0; i < 4; i++ {
		var ev Event
		switch {
		case (state == Bridge || state == DLBookable || state == TestBooked || state == TestFailed) &&
			f.LLExpiresOn != nil && f.Today.After(*f.LLExpiresOn):
			ev = LLExpiredEv
		case state == Bridge && f.DLTestUnlock != nil && !f.Today.Before(*f.DLTestUnlock):
			ev = DLUnlocked
		case state == DLHolder && renewalWindowOpens != nil && !f.Today.Before(*renewalWindowOpens):
			ev = RenewalWindowOpened
		default:
			return state, applied
		}
		next, err := Apply(state, f, Input{Event: ev, On: f.Today})
		if err != nil {
			return state, applied
		}
		state = next
		applied = append(applied, ev)
	}
	return state, applied
}
