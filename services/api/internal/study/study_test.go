package study

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

var t0 = time.Date(2026, 10, 24, 6, 0, 0, 0, time.UTC)

type fakeConsents struct {
	calls int
	ok    bool
}

func (f *fakeConsents) ActiveConsent(context.Context, string, uuid.UUID, string) (uuid.UUID, bool, error) {
	f.calls++
	return uuid.MustParse("01929000-0000-7000-8000-000000000001"), f.ok, nil
}

func newSvc() (*Service, *MemStore, *fakeConsents) {
	st, fc := NewMemStore(), &fakeConsents{ok: true}
	return &Service{Store: st, Consents: fc, Clock: servertime.NewFixed(t0)}, st, fc
}

func subj() Subject { return Subject{Tenant: "JK", ApplicantID: uuid.New()} }

var okEnrol = EnrolInput{ConsentGiven: true, AgeOK: true, AgeBand: "21_24", LicenceHeld: "2w", YearsDriving: "1_3"}

// ---- enrolment ------------------------------------------------------------------------------

func TestDeclinedConsent_NothingStored(t *testing.T) {
	svc, st, fc := newSvc()
	_, err := svc.Enrol(context.Background(), subj(), EnrolInput{ConsentGiven: false, AgeOK: true, AgeBand: "21_24", LicenceHeld: "2w", YearsDriving: "1_3"})
	if !errors.Is(err, ErrDeclined) {
		t.Fatalf("declined: %v", err)
	}
	if st.Writes != 0 || st.Reads != 0 || fc.calls != 0 {
		t.Fatalf("declining touched storage: writes=%d reads=%d consent calls=%d", st.Writes, st.Reads, fc.calls)
	}
	// Under 18 is refused the same way.
	_, err = svc.Enrol(context.Background(), subj(), EnrolInput{ConsentGiven: true, AgeOK: false})
	if !errors.Is(err, ErrUnder18) || st.Writes != 0 || st.Reads != 0 {
		t.Fatalf("under 18: %v writes=%d", err, st.Writes)
	}
}

func TestEnrol_NeedsFieldStudyConsent(t *testing.T) {
	svc, st, fc := newSvc()
	fc.ok = false
	if _, err := svc.Enrol(context.Background(), subj(), okEnrol); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("no consent: %v", err)
	}
	if st.Writes != 0 {
		t.Fatalf("stored without consent: %d writes", st.Writes)
	}
}

func TestCounterbalancing(t *testing.T) {
	svc, st, _ := newSvc()
	ctx := context.Background()
	var forms []string
	for i := 0; i < 7; i++ {
		p, err := svc.Enrol(ctx, subj(), okEnrol)
		if err != nil {
			t.Fatal(err)
		}
		forms = append(forms, p.Form)
		if want := fmt.Sprintf("P-%03d", i+1); p.Code != want {
			t.Fatalf("code %s, want %s", p.Code, want)
		}
	}
	if want := []string{"A", "B", "C", "A", "B", "C", "A"}; !reflect.DeepEqual(forms, want) {
		t.Fatalf("forms %v, want %v", forms, want)
	}
	// Enrolling twice returns the same participant (no new arrival number).
	s := subj()
	a, _ := svc.Enrol(ctx, s, okEnrol)
	b, _ := svc.Enrol(ctx, s, okEnrol)
	if a.Code != b.Code {
		t.Fatalf("re-enrol made %s and %s", a.Code, b.Code)
	}
	// Each block is "fresh" exactly once across the three forms, and test+fresh cover all 15.
	blocks := testBlocks()
	st.SetBlocks("JK", blocks)
	freshCount := map[string]int{}
	for _, f := range Forms {
		test, err := ItemsFor(blocks, f, PhaseTest)
		if err != nil {
			t.Fatal(err)
		}
		fresh, _ := ItemsFor(blocks, f, PhaseFresh)
		fb, _ := ItemsFor(blocks, f, PhaseFeedback)
		if len(test) != 10 || len(fresh) != 5 || !reflect.DeepEqual(fb, test[:2]) {
			t.Fatalf("form %s: %d test, %d fresh, feedback %v", f, len(test), len(fresh), fb)
		}
		all := map[string]bool{}
		for _, r := range append(test, fresh...) {
			all[r] = true
		}
		if len(all) != 15 {
			t.Fatalf("form %s covers %d clips", f, len(all))
		}
		freshCount[fresh[0]]++
	}
	for _, b := range [][]string{blocks.B1, blocks.B2, blocks.B3} {
		if freshCount[b[0]] != 1 {
			t.Fatalf("block %v fresh %d times", b, freshCount[b[0]])
		}
	}
	items, err := svc.FormItems(ctx, "JK", "P-002", PhaseFresh) // P-002 has form B → fresh B1
	if err != nil || !reflect.DeepEqual(items, blocks.B1) {
		t.Fatalf("FormItems: %v %v", items, err)
	}
	ll, _ := svc.FormItems(ctx, "JK", "P-001", PhaseLLMock)
	if len(ll) != 15 {
		t.Fatalf("LL set %d", len(ll))
	}
}

func TestBalanceBlocks(t *testing.T) {
	var cs []BlockClip
	for i := 0; i < 15; i++ {
		cs = append(cs, BlockClip{Ref: fmt.Sprintf("clip:JMU-%04d@1", i+1), Difficulty: 1 + i%5})
	}
	b, err := BalanceBlocks(cs)
	if err != nil {
		t.Fatal(err)
	}
	diff := map[string]int{}
	for _, c := range cs {
		diff[c.Ref] = c.Difficulty
	}
	var sums []int
	for _, blk := range b {
		if len(blk) != 5 {
			t.Fatalf("block size %d", len(blk))
		}
		s := 0
		for _, r := range blk {
			s += diff[r]
		}
		sums = append(sums, s)
	}
	for _, s := range sums {
		if s < sums[0]-2 || s > sums[0]+2 {
			t.Fatalf("unbalanced sums %v", sums)
		}
	}
	if _, err := BalanceBlocks(cs[:14]); !errors.Is(err, ErrNotEnoughBlocks) {
		t.Fatal("14 clips accepted")
	}
}

func TestNearMiss_PrivacyScanned(t *testing.T) {
	svc, _, _ := newSvc()
	s := subj()
	p, _ := svc.Enrol(context.Background(), s, okEnrol)
	var ve *ValidationError
	if err := svc.NearMiss(context.Background(), s, p.Code, "Call me on 9876543210 about it"); !errors.As(err, &ve) {
		t.Fatalf("phone number accepted: %v", err)
	}
	if err := svc.NearMiss(context.Background(), s, p.Code, strings.Repeat("a", 141)); !errors.As(err, &ve) {
		t.Fatal("141 chars accepted")
	}
	if err := svc.NearMiss(context.Background(), s, p.Code, "A bus pulled out without signalling"); err != nil {
		t.Fatal(err)
	}
}

// ---- export fixtures ------------------------------------------------------------------------

func testBlocks() *Blocks {
	b := &Blocks{}
	for i := 0; i < 15; i++ {
		ref := fmt.Sprintf("clip:JMU-%04d@1", i+1)
		switch i / 5 {
		case 0:
			b.B1 = append(b.B1, ref)
		case 1:
			b.B2 = append(b.B2, ref)
		default:
			b.B3 = append(b.B3, ref)
		}
	}
	for i := 0; i < 15; i++ {
		b.LLSet = append(b.LLSet, fmt.Sprintf("C-LL1-%03d:v1", i+1))
	}
	return b
}

func fp(x float64) *float64 { return &x }

// clip builds one clip analysis: marks, and when lateS >= 0 a credited hazard tapped at tapMt.
func clip(ref string, marks, lateS float64, maxTaps int) ClipAnalysis {
	h := HazardAnalysis{HazardID: "h1", HazardType: "bus_stop_pedestrian", Credit: marks / 2}
	if lateS >= 0 {
		h.LateS, h.TapMt, h.Metres = fp(lateS), fp(10000+lateS*1000), fp(lateS*40/3.6)
	}
	return ClipAnalysis{Ref: ref, Taps: 1, MaxTapsInWindow: maxTaps, Marks: marks, Hazards: []HazardAnalysis{h}}
}

type fixtureP struct {
	code     string
	llRaw    float64
	test     float64 // marks per test clip
	fresh    float64 // marks per fresh clip
	trust    float64
	totalMs  int64
	maxTaps  int
	retakeOf string
	noLate   bool
}

func fixture(t *testing.T, ps []fixtureP) (ExportInput, *Blocks) {
	t.Helper()
	b := testBlocks()
	in := ExportInput{Speeds: map[string]float64{}}
	for i := 0; i < 15; i++ {
		in.Speeds[fmt.Sprintf("clip:JMU-%04d@1", i+1)] = 30 + float64(i)
	}
	for i, f := range ps {
		form := FormFor(i + 1)
		p := &Participant{Code: f.code, Tenant: "JK", ApplicantID: uuid.New(), AgeOK: true, Form: form, Seq: i + 1, RetakeOf: f.retakeOf,
			AgeBand: "21_24", LicenceHeld: "2w", YearsDriving: "1_3", CreatedAt: t0}
		in.Participants = append(in.Participants, p)
		test, _ := ItemsFor(b, form, PhaseTest)
		fresh, _ := ItemsFor(b, form, PhaseFresh)
		mk := func(refs []string, marks float64, phase string, j0 int) *Session {
			var prim, lin []ClipAnalysis
			for j, r := range refs {
				late := 0.2 * float64((i+j+j0)%7)
				if f.noLate {
					late = -1
				}
				taps := 1
				if j == 0 {
					taps = f.maxTaps
				}
				prim = append(prim, clip(r, marks, late, taps))
				lin = append(lin, clip(r, math.Min(10, marks+1.5), late, taps))
			}
			// A no-hazard clip: false alarms only, not part of the score.
			prim = append(prim, ClipAnalysis{Ref: "clip:JMU-0099@1", Taps: 2, MaxTapsInWindow: 1, FalseAlarms: 2, Hazards: []HazardAnalysis{}})
			lin = append(lin, ClipAnalysis{Ref: "clip:JMU-0099@1", Taps: 2, MaxTapsInWindow: 1, FalseAlarms: 2, Hazards: []HazardAnalysis{}})
			return &Session{ParticipantCode: f.code, Phase: phase, SessionID: uuid.New(), Trust: f.trust, DurationMs: f.totalMs / 3,
				Analysis:   map[string]NazarAnalysis{KindPrimary: {Rule: "kerala_5band", Clips: prim}, KindLinear: {Rule: "field_kit_linear", Clips: lin}},
				VerifiedAt: t0}
		}
		in.Sessions = append(in.Sessions,
			&Session{ParticipantCode: f.code, Phase: PhaseLLMock, SessionID: uuid.New(), Trust: 1, DurationMs: f.totalMs - 2*(f.totalMs/3),
				ScoreRaw: f.llRaw, ScoreMax: 15, VerifiedAt: t0},
			mk(test, f.test, PhaseTest, 0), mk(fresh, f.fresh, PhaseFresh, 3))
	}
	for i := 0; i < 15; i++ {
		in.Raters = append(in.Raters, RaterRow{ClipID: fmt.Sprintf("JMU-%04d", i+1), RaterAOnsetMs: 12000 + 100*i, RaterBOnsetMs: 12300 + 50*i})
	}
	return in, b
}

// standardFixture: 14 participants; P-003 has trust 0.55 (excluded by the export), P-005 a 50 s
// session and P-006 4 taps in a second (both written, excluded by the script), P-014 a retake of
// P-001 (written, excluded by the script), P-007 trust exactly 0.6 (kept).
func standardFixture(t *testing.T) ExportInput {
	t.Helper()
	ps := []fixtureP{
		{"P-001", 12, 6, 7, 1, 300000, 2, "", false},
		{"P-002", 9, 4, 5, 1, 280000, 1, "", false},
		{"P-003", 14, 8, 8, 0.55, 300000, 1, "", false},
		{"P-004", 7, 3, 6, 0.9, 260000, 3, "", false},
		{"P-005", 11, 5, 5, 1, 50000, 1, "", false},
		{"P-006", 10, 6, 4, 1, 300000, 4, "", false},
		{"P-007", 13, 7, 8, 0.6, 310000, 2, "", false},
		{"P-008", 8, 2, 4, 1, 240000, 1, "", false},
		{"P-009", 15, 9, 9, 1, 330000, 1, "", false},
		{"P-010", 6, 4, 3, 1, 250000, 2, "", false},
		{"P-011", 12, 5, 7, 1, 290000, 1, "", false},
		{"P-012", 10, 6, 6, 1, 270000, 1, "", false},
		{"P-013", 9, 3, 5, 0.95, 265000, 1, "", false},
		{"P-014", 12, 7, 7, 1, 300000, 1, "P-001", false},
	}
	in, _ := fixture(t, ps)
	return in
}

func readCSV(t *testing.T, b []byte) [][]string {
	t.Helper()
	recs, err := csv.NewReader(bytes.NewReader(b)).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	return recs
}

// ---- export tests ---------------------------------------------------------------------------

func TestExport_ExactColumns(t *testing.T) {
	ex, err := BuildExport(standardFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	wantSessions := "anon_id,ll_score,hpt_score,pre_mean,post_mean,median_late_s,speed_kmh,total_s,max_taps_per_s,age_ok,retake_of"
	for _, f := range []string{FileSessions, FileSessionsAlt} {
		first := strings.SplitN(string(ex.Files[f]), "\n", 2)[0]
		if first != wantSessions {
			t.Fatalf("%s header %q", f, first)
		}
		for _, rec := range readCSV(t, ex.Files[f])[1:] {
			if len(rec) != 11 {
				t.Fatalf("%s row has %d fields: %v", f, len(rec), rec)
			}
		}
	}
	if first := strings.SplitN(string(ex.Files[FileRaters]), "\n", 2)[0]; first != "clip_id,rater_a_onset_s,rater_b_onset_s" {
		t.Fatalf("raters header %q", first)
	}
	// P-001 (form A): 10 test clips at 6 marks = 60; pre 6; post 7; LL 12; total 300 s; 2 taps/s.
	prim := readCSV(t, ex.Files[FileSessions])
	alt := readCSV(t, ex.Files[FileSessionsAlt])
	if got := prim[1]; got[0] != "P-001" || got[1] != "12" || got[2] != "60" || got[3] != "6" || got[4] != "7" || got[7] != "300" || got[8] != "2" || got[9] != "1" || got[10] != "" {
		t.Fatalf("P-001 primary row %v", got)
	}
	// The alternate file differs only in the three score columns (linear rule: 7.5 per clip here).
	if got := alt[1]; got[2] != "75" || got[3] != "7.5" || got[4] != "8.5" {
		t.Fatalf("P-001 alt row %v", got)
	}
	for i := range prim {
		for _, c := range []int{0, 1, 5, 6, 7, 8, 9, 10} {
			if prim[i][c] != alt[i][c] {
				t.Fatalf("row %d column %d differs between files", i, c)
			}
		}
	}
	// The retake row carries retake_of.
	if last := prim[len(prim)-1]; last[0] != "P-014" || last[10] != "P-001" {
		t.Fatalf("retake row %v", last)
	}
	r := readCSV(t, ex.Files[FileRaters])
	if len(r) != 16 || r[1][0] != "JMU-0001" || r[1][1] != "12" || r[1][2] != "12.3" {
		t.Fatalf("raters %v", r[:2])
	}
	for name, b := range ex.Files {
		sum := sha256.Sum256(b)
		if ex.SHA256[name] != hex.EncodeToString(sum[:]) {
			t.Fatalf("sha256 of %s", name)
		}
	}
}

func TestTrustBelow06_Excluded(t *testing.T) {
	ex, err := BuildExport(standardFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(ex.Summary.ExcludedLowTrust, []string{"P-003"}) {
		t.Fatalf("excluded %v", ex.Summary.ExcludedLowTrust)
	}
	for _, f := range []string{FileSessions, FileSessionsAlt} {
		s := string(ex.Files[f])
		if strings.Contains(s, "P-003") {
			t.Fatalf("%s contains the trust 0.55 session", f)
		}
		if !strings.Contains(s, "P-007") {
			t.Fatalf("%s lost the trust 0.6 session", f)
		}
	}
	if !strings.Contains(ex.Summary.Note, "trust < 0.6") || !strings.Contains(ex.Summary.Note, "no integrity rule") {
		t.Fatal("the summary must document that nazar_stats.mjs lacks the trust rule")
	}
}

func TestExport_NoInWindowTapIsNaNAndWithdrawnSkipped(t *testing.T) {
	in, _ := fixture(t, []fixtureP{{"P-001", 10, 0, 0, 1, 300000, 1, "", true}, {"P-002", 10, 5, 5, 1, 300000, 1, "", false}})
	now := t0
	in.Participants[1].WithdrawnAt = &now
	ex, err := BuildExport(in)
	if err != nil {
		t.Fatal(err)
	}
	if ex.Summary.Rows != 1 || ex.Summary.Withdrawn != 1 || !reflect.DeepEqual(ex.Summary.NoInWindowTap, []string{"P-001"}) {
		t.Fatalf("summary %+v", ex.Summary)
	}
	if row := readCSV(t, ex.Files[FileSessions])[1]; row[5] != "nan" || row[6] != "nan" {
		t.Fatalf("late/speed %v", row)
	}
}

// findStatsScript walks up from the working directory for field-kit/nazar_stats.mjs. The copy
// inside the repo (margdarshak/field-kit) is found before the one above it.
func findStatsScript(t *testing.T) string {
	t.Helper()
	dir, _ := os.Getwd()
	for {
		p := filepath.Join(dir, "field-kit", "nazar_stats.mjs")
		if _, err := os.Stat(p); err == nil {
			return p
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Skip("field-kit/nazar_stats.mjs not found above the working directory")
		}
		dir = parent
	}
}

func runScript(t *testing.T, node, script, dir string, files ...string) string {
	t.Helper()
	cmd := exec.Command(node, append([]string{script}, files...)...)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("node %s %v: %v\n%s", filepath.Base(script), files, err, stderr.String())
	}
	return string(out)
}

func TestExport_RunsNazarStatsUnmodified(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH")
	}
	script := findStatsScript(t)
	before, err := os.ReadFile(script)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(before)
	t.Logf("nazar_stats.mjs %s sha256 %x", script, sum)

	ex, err := BuildExport(standardFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	for name, b := range ex.Files {
		if err := os.WriteFile(filepath.Join(dir, name), b, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	out := runScript(t, node, script, dir, FileSessions, FileRaters)
	t.Logf("nazar_stats.mjs output:\n%s", out)
	st, err := ParseScriptOutput(out)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	// 13 rows written (P-003 dropped for trust); the script then drops P-005 (50 s), P-006
	// (4 taps/s) and the retake P-014: 10 kept.
	if st.Of != 13 || st.Of != ex.Summary.Rows || st.N != 10 || st.N != ex.Summary.KeptByScript {
		t.Fatalf("script N=%d of %d; export kept %d of %d", st.N, st.Of, ex.Summary.KeptByScript, ex.Summary.Rows)
	}
	if !st.HasH4 || st.H4Clips != 15 || st.H4Clips != ex.Summary.RaterRows {
		t.Fatalf("H4 clips %d", st.H4Clips)
	}
	// Below 60/100 among the 10 kept: P-002 (40), P-004 (30), P-008 (20), P-010 (40), P-011 (50),
	// P-012 (60 is not below), P-013 (30) → 6.
	if st.BelowK != 6 || st.MedianLateS == nil || st.R == nil {
		t.Fatalf("H1 k=%d, late=%v, r=%v", st.BelowK, st.MedianLateS, st.R)
	}
	// The sensitivity file runs through the same script unchanged.
	alt, err := ParseScriptOutput(runScript(t, node, script, dir, FileSessionsAlt))
	if err != nil || alt.N != 10 || alt.Of != 13 {
		t.Fatalf("alt: %+v %v", alt, err)
	}
	after, _ := os.ReadFile(script)
	if !bytes.Equal(before, after) {
		t.Fatal("nazar_stats.mjs changed during the test")
	}

	// stats.field_study_publish accepts this output against the same data and stores the figures.
	svc, st2, _ := newSvc()
	in := standardFixture(t)
	for _, p := range in.Participants {
		_ = st2.InsertParticipant(context.Background(), p)
	}
	for _, s := range in.Sessions {
		st2.AddSession("JK", s)
	}
	st2.SetBlocks("JK", testBlocks())
	svc.Speeds, svc.Raters = mapSpeeds(in.Speeds), staticRaters(in.Raters)
	res, err := svc.Steps()["stats.field_study_publish"](context.Background(), map[string]any{"tenant": "JK", "stdout": out,
		"script_sha256": hex.EncodeToString(sum[:]), "prereg_commit": "abc1234"})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if res["participants"] != 10 || res["status"] != "published" || len(st2.Stats["JK"]) != 1 {
		t.Fatalf("publish result %v", res)
	}
	// A count that does not match the export is refused.
	bad := strings.Replace(out, "(of 13)", "(of 14)", 1)
	if _, err := svc.Steps()["stats.field_study_publish"](context.Background(), map[string]any{"tenant": "JK", "stdout": bad,
		"script_sha256": hex.EncodeToString(sum[:])}); !errors.Is(err, ErrStatsMismatch) {
		t.Fatalf("mismatch accepted: %v", err)
	}
}

type mapSpeeds map[string]float64

func (m mapSpeeds) ClipSpeeds(context.Context, []string) (map[string]float64, error) { return m, nil }

type staticRaters []RaterRow

func (s staticRaters) RaterOnsets(context.Context, []string) ([]RaterRow, error) { return s, nil }

func TestParseScriptOutput(t *testing.T) {
	out := "N after pre-registered exclusions: 3 (of 4)\n" +
		"H1  below 60/100: 1/3 = 33%  (95% CI 6-79%)\n" +
		"H2  r(LL mock, Nazar) = nan  (95% CI nan to nan)\n" +
		"    median late = 0.40 s  (~4 m at 40 km/h)\n" +
		"H3  mean gain after feedback = +0.50/10 per clip, one-sided Wilcoxon p = nan\n"
	st, err := ParseScriptOutput(out)
	if err != nil {
		t.Fatal(err)
	}
	if st.N != 3 || st.Of != 4 || st.BelowK != 1 || *st.BelowPct != 33 || st.R != nil || *st.H3MeanGain != 0.5 || st.H3P != nil || st.HasH4 {
		t.Fatalf("%+v", st)
	}
	if _, err := ParseScriptOutput("something else\n"); !errors.Is(err, ErrUnparsableOutput) {
		t.Fatal("junk parsed")
	}
}
