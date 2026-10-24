package journey

import (
	"errors"
	"testing"

	"github.com/sruj08/margadarshak/services/api/internal/rules"
)

func d(s string) rules.Date {
	x, err := rules.ParseDate(s)
	if err != nil {
		panic(err)
	}
	return x
}

func dp(s string) *rules.Date { x := d(s); return &x }

var actionIDs = map[string]bool{"START_PLAN": true, "RESUME_STEP": true, "OPEN_HANDOFF": true, "CHECK_PAYMENT": true, "TAKE_MOCK_TEST": true,
	"PRACTISE_NAZAR": true, "BOOK_TEST": true, "OPEN_TEST_DAY": true, "SEE_RETEST_PLAN": true, "CHASE_APPROVAL": true, "SHOW_CARD": true, "RENEW": true}

// MD-121: every (state, event) pair has a defined outcome: a valid next state or a typed
// rejection, never a panic or an unknown state.
func TestMachineEveryStateEventPairHasAnOutcome(t *testing.T) {
	f := Facts{Today: d("2026-10-24")}
	defined := 0
	for _, s := range States {
		for _, ev := range AllEvents {
			next, err := Apply(s, f, Input{Event: ev, On: f.Today})
			if err != nil {
				var je *Error
				if !errors.As(err, &je) {
					t.Fatalf("%s/%s: untyped error %v", s, ev, err)
				}
				switch je.Code {
				case CodeInvalidTransition, CodeTooEarly, CodeRemedialRequired:
				default:
					t.Fatalf("%s/%s: unknown code %s", s, ev, je.Code)
				}
				if next != s {
					t.Fatalf("%s/%s: a rejected event changed the state to %s", s, ev, next)
				}
				continue
			}
			defined++
			if !next.Valid() {
				t.Fatalf("%s/%s: invalid target %s", s, ev, next)
			}
		}
	}
	if defined < 30 {
		t.Fatalf("only %d transitions defined", defined)
	}
}

func TestMachineTransitions(t *testing.T) {
	unlock, expires := dp("2026-11-23"), dp("2027-04-24")
	f := Facts{Today: d("2026-11-25"), DLTestUnlock: unlock, LLExpiresOn: expires, RetestGap: 7, RemedialRule: true}
	cases := []struct {
		name string
		from State
		ev   Event
		on   string
		slot string
		f    *Facts
		want State
		code string
	}{
		{"start application", Plan, LLApplicationStarted, "2026-10-24", "", nil, LLApplying, ""},
		{"alias application_started", Plan, ApplicationStartedV1, "2026-10-24", "", nil, LLApplying, ""},
		{"hand-off", LLApplying, HandoffDone, "2026-10-24", "", nil, HandedOff, ""},
		{"EC-09 payment pending", HandedOff, PaymentPendingEv, "2026-10-24", "", nil, PaymentPending, ""},
		{"payment confirmed", PaymentPending, PaymentConfirmed, "2026-10-24", "", nil, LLTest, ""},
		{"LL test retake", LLTest, LLTestFailedEv, "2026-10-24", "", nil, LLTest, ""},
		{"LL issued", LLTest, LLIssued, "2026-10-24", "", nil, Bridge, ""},
		{"EC-22 LL already held", Plan, LLIssued, "2026-09-10", "", nil, Bridge, ""},
		{"day-30 unlock", Bridge, DLUnlocked, "2026-11-23", "", nil, DLBookable, ""},
		{"book in bridge for a date after day 30 (EC-07)", Bridge, SlotBooked, "2026-11-20", "2026-11-28", nil, TestBooked, ""},
		{"book in bridge for a date before day 30", Bridge, SlotBooked, "2026-11-20", "2026-11-21", nil, Bridge, CodeTooEarly},
		{"book", DLBookable, SlotBooked, "2026-11-24", "2026-12-01", nil, TestBooked, ""},
		{"fail", TestBooked, TestFailedEv, "2026-12-01", "", nil, TestFailed, ""},
		{"pass", TestBooked, TestPassed, "2026-12-01", "", nil, AwaitingApproval, ""},
		{"approved", AwaitingApproval, Approved, "2026-12-05", "", nil, DLIssued, ""},
		{"card", DLIssued, CardReceived, "2026-12-20", "", nil, DLHolder, ""},
		{"renewal window", DLHolder, RenewalWindowOpened, "2046-10-01", "", nil, RenewalDue, ""},
		{"renewed", RenewalDue, Renewed, "2046-11-01", "", nil, DLHolder, ""},
		{"EC-07 reapply after expiry", LLExpired, Reapply, "2027-05-01", "", nil, LLApplying, ""},
		{"LL expiry is a clock event", Bridge, LLExpiredEv, "2027-04-25", "", nil, LLExpired, ""},
		{"LL expiry before the date is refused", Bridge, LLExpiredEv, "2027-04-24", "", nil, Bridge, CodeTooEarly},
		{"test passed in PLAN is illegal", Plan, TestPassed, "2026-10-24", "", nil, Plan, CodeInvalidTransition},
		{"EC-08 retest inside the gap", TestFailed, SlotBooked, "2026-12-02", "2026-12-05",
			&Facts{Today: d("2026-12-02"), DLTestUnlock: unlock, LastFailOn: dp("2026-12-01"), RetestGap: 7, RemedialRule: true, Fails: 1}, TestFailed, CodeTooEarly},
		{"EC-08 retest after the gap", TestFailed, SlotBooked, "2026-12-02", "2026-12-08",
			&Facts{Today: d("2026-12-02"), DLTestUnlock: unlock, LastFailOn: dp("2026-12-01"), RetestGap: 7, RemedialRule: true, Fails: 1}, TestBooked, ""},
		{"EC-08 third fail needs remedial training", TestFailed, SlotBooked, "2026-12-20", "2026-12-28",
			&Facts{Today: d("2026-12-20"), DLTestUnlock: unlock, LastFailOn: dp("2026-12-01"), RetestGap: 7, RemedialRule: true, Fails: 3}, TestFailed, CodeRemedialRequired},
		{"EC-08 third fail with remedial ack", TestFailed, SlotBooked, "2026-12-20", "2026-12-28",
			&Facts{Today: d("2026-12-20"), DLTestUnlock: unlock, LastFailOn: dp("2026-12-01"), RetestGap: 7, RemedialRule: true, Fails: 3, RemedialAck: true}, TestBooked, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ff := f
			if c.f != nil {
				ff = *c.f
			}
			in := Input{Event: c.ev, On: d(c.on)}
			if c.slot != "" {
				in.SlotDate = dp(c.slot)
			}
			got, err := Apply(c.from, ff, in)
			if c.code != "" {
				var je *Error
				if !errors.As(err, &je) || je.Code != c.code {
					t.Fatalf("want %s, got %v", c.code, err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("state %s, want %s", got, c.want)
			}
		})
	}
}

// EC-22: an LL issued 40 days ago lands in S5 (DL test bookable) with "book DL test".
func TestEC22LLIssuedFortyDaysAgoLandsInS5(t *testing.T) {
	issued := d("2026-09-14")
	today := d("2026-10-24")
	s, err := Apply(Plan, Facts{Today: today}, Input{Event: LLIssued, On: issued})
	if err != nil || s != Bridge {
		t.Fatalf("%v %v", s, err)
	}
	unlock, expires := issued.AddDays(30), issued.AddMonths(6)
	s, applied := CatchUp(s, Facts{Today: today, DLTestUnlock: &unlock, LLExpiresOn: &expires}, nil)
	if s != DLBookable || len(applied) != 1 || applied[0] != DLUnlocked {
		t.Fatalf("catch-up: %s %v", s, applied)
	}
	v := Derive(ViewInput{State: s, Today: today, LLExpiresOn: &expires, DLTestUnlock: &unlock})
	if v.Stage != "S5" || v.Next.ActionID != "BOOK_TEST" {
		t.Fatalf("view %+v", v)
	}
}

// EC-15: only the server date counts. A device clock 40 days ahead changes nothing because the
// machine is given the server's date; with the server date before day 30 nothing unlocks.
func TestEC15ServerDateOnly(t *testing.T) {
	unlock, expires := dp("2026-11-23"), dp("2027-04-24")
	server := d("2026-11-05")
	s, applied := CatchUp(Bridge, Facts{Today: server, DLTestUnlock: unlock, LLExpiresOn: expires}, nil)
	if s != Bridge || len(applied) != 0 {
		t.Fatalf("unlocked early: %s %v", s, applied)
	}
	if _, err := Apply(Bridge, Facts{Today: server, DLTestUnlock: unlock}, Input{Event: DLUnlocked, On: server}); err == nil {
		t.Fatal("dl_unlocked accepted before day 30 by server date")
	}
	v := Derive(ViewInput{State: Bridge, Today: server, DLTestUnlock: unlock, LLExpiresOn: expires})
	if v.Next.ActionID != "PRACTISE_NAZAR" || v.Next.DueOn == nil || *v.Next.DueOn != *unlock {
		t.Fatalf("view %+v", v.Next)
	}
}

// LL_EXPIRING is display-only: it overrides the stage view, never the stored state.
func TestDisplayLLExpiringIsDerived(t *testing.T) {
	exp := dp("2026-11-10")
	v := Derive(ViewInput{State: DLBookable, Today: d("2026-10-24"), LLExpiresOn: exp})
	if v.DisplayStage != DisplayLLExpiring || v.Alerts[0] != AlertLLExpiring || v.Next.ActionID != "BOOK_TEST" || v.Next.TitleKey != "next.book_before_ll_expiry" {
		t.Fatalf("%+v", v)
	}
	v = Derive(ViewInput{State: DLBookable, Today: d("2026-09-01"), LLExpiresOn: exp})
	if v.DisplayStage != string(DLBookable) || len(v.Alerts) != 0 {
		t.Fatalf("%+v", v)
	}
	v = Derive(ViewInput{State: AwaitingApproval, Today: d("2026-12-05"), PassedOn: dp("2026-12-01")})
	if len(v.Alerts) != 1 || v.Alerts[0] != AlertApprovalStalled {
		t.Fatalf("EC-23 approval stalled: %+v", v.Alerts)
	}
}

func TestEveryStateHasOnePrimaryAction(t *testing.T) {
	for _, s := range States {
		v := Derive(ViewInput{State: s, Today: d("2026-10-24")})
		if !actionIDs[v.Next.ActionID] || v.Next.TitleKey == "" || v.Stage == "S0" {
			t.Fatalf("%s: %+v", s, v)
		}
	}
	if ProductStage(DLHolder, d("2026-10-24"), dp("2026-06-01")) != "S8" || ProductStage(DLHolder, d("2026-10-24"), dp("2024-06-01")) != "S9" {
		t.Fatal("S8 for the first 12 months, then S9")
	}
}

// MD-125 golden: LL issued on day 0 (2026-10-24, JK pack: 30-day wait, 6-month validity).
func TestScheduleGoldenLLIssuedDay0(t *testing.T) {
	issued := d("2026-10-24")
	unlock, expires := issued.AddDays(30), issued.AddMonths(6)
	in := ScheduleInput{State: Bridge, LLIssuedOn: &issued, LLExpiresOn: &expires, DLTestUnlock: &unlock,
		Rules: RuleIDs{MinWait: "JK-PRM-MIN-WAIT-DAYS", Validity: "JK-PRM-LL-VALIDITY-MONTHS"}}
	got := map[string]string{}
	for _, m := range Schedule(in) {
		got[m.Code] = m.DueOn.String()
	}
	want := map[string]string{MLLDay25Prep: "2026-11-18", MLLDay30Unlock: "2026-11-23", MLLExpiryM30: "2027-03-25", MLLExpiryM7: "2027-04-17", MLLExpiry: "2027-04-25"}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("%s = %q, want %q (all %v)", k, got[k], v, got)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("extra milestones: %v", got)
	}
	// Idempotent: the same input gives the same schedule.
	a, b := Schedule(in), Schedule(in)
	for i := range a {
		if a[i] != b[i] {
			t.Fatal("schedule is not deterministic")
		}
	}
}

func TestScheduleByState(t *testing.T) {
	slot, fail, pass, valid := dp("2026-12-01"), dp("2026-12-01"), dp("2026-12-01"), dp("2046-10-24")
	cases := []struct {
		in   ScheduleInput
		want string
		due  string
	}{
		{ScheduleInput{State: TestBooked, SlotDate: slot}, MTestEve, "2026-11-30"},
		{ScheduleInput{State: TestFailed, LastFailOn: fail, RetestGap: 7}, MRetestEligible, "2026-12-08"},
		{ScheduleInput{State: AwaitingApproval, PassedOn: pass}, MApprovalChase, "2026-12-04"},
		{ScheduleInput{State: DLHolder, DLValidTo: valid}, MDLRenewalM60, "2046-08-25"},
		{ScheduleInput{State: DLHolder, DLValidTo: valid}, MDLExpiredY1, "2047-10-25"},
	}
	for _, c := range cases {
		found := false
		for _, m := range Schedule(c.in) {
			if m.Code == c.want {
				found = true
				if m.DueOn.String() != c.due {
					t.Fatalf("%s due %s, want %s", c.want, m.DueOn, c.due)
				}
			}
		}
		if !found {
			t.Fatalf("%s missing for %s", c.want, c.in.State)
		}
	}
	if len(Schedule(ScheduleInput{State: DLHolder})) != 0 || len(Schedule(ScheduleInput{State: Plan})) != 0 {
		t.Fatal("no dated facts, no milestones")
	}
}

// EC-04: the 40th birthday inside the LL window schedules FORM_1A_AT_40 before the DL; it is
// dropped once the DL is issued.
func TestEC04Form1AMilestone(t *testing.T) {
	due := dp("2027-01-12")
	got := Schedule(ScheduleInput{State: Bridge, Form1ADue: due, Rules: RuleIDs{Form1A: "WRN-TURNING-40"}})
	if len(got) != 1 || got[0].Code != MForm1AAt40 || got[0].RuleID != "WRN-TURNING-40" {
		t.Fatalf("%+v", got)
	}
	if len(Schedule(ScheduleInput{State: DLHolder, Form1ADue: due})) != 0 {
		t.Fatal("Form 1A milestone after the DL")
	}
}

func TestClockEventsAndTemplates(t *testing.T) {
	if ev, ok := ClockEvent(MLLDay30Unlock); !ok || ev != DLUnlocked {
		t.Fatal("unlock")
	}
	if _, ok := ClockEvent(MTestEve); ok {
		t.Fatal("test eve has no clock transition")
	}
	if TemplateID(MLLExpiryM7) != "ll_expiry_m7_v1" {
		t.Fatal(TemplateID(MLLExpiryM7))
	}
	if Priority(MLLExpiry) >= Priority(MLLDay25Prep) {
		t.Fatal("deadlines first")
	}
	if !IsClient(ApplicationStartedV1) || IsClient(DLUnlocked) {
		t.Fatal("client events")
	}
}
