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
	"sort"
	"strconv"
	"strings"
	"time"
)

// Export file names and columns: exactly FIELD_STUDY §7.1 and the header nazar_stats.mjs reads.
const (
	FileSessions    = "sessions.csv"
	FileSessionsAlt = "sessions_alt.csv"
	FileRaters      = "raters.csv"
	// FileClipResponses feeds analysis/nazar_secondary.mjs (FIELD_STUDY §7.1, D-22).
	FileClipResponses = "clip_responses.csv"
	// TrustMin is the pre-registered integrity exclusion (FIELD_STUDY §4.5).
	TrustMin = 0.6
)

// SessionColumns is the sessions.csv / sessions_alt.csv header.
var SessionColumns = []string{"anon_id", "ll_score", "hpt_score", "pre_mean", "post_mean", "median_late_s", "speed_kmh",
	"total_s", "max_taps_per_s", "age_ok", "retake_of"}

// RaterColumns is the raters.csv header.
var RaterColumns = []string{"clip_id", "rater_a_onset_s", "rater_b_onset_s"}

// ClipResponseColumns is the clip_responses.csv header (FIELD_STUDY §7.1, nazar_secondary.mjs):
// one row per test or fresh clip of every participant written to sessions.csv.
var ClipResponseColumns = []string{"anon_id", "form", "clip_id", "block", "phase", "score_primary", "score_alt", "first_tap_s",
	"n_taps", "timing_mode", "trust"}

// ScriptExclusionNote documents the one exclusion the export applies itself.
const ScriptExclusionNote = "nazar_stats.mjs applies age_ok = 1, total_s >= 60, max_taps_per_s <= 3 and retake_of " +
	"(FIELD_STUDY §4.5). It has no integrity rule, so the export drops sessions with trust < 0.6 before writing the " +
	"CSVs (pre-registered deviation from the field-kit draft; HYPOTHESES.md must list it). Dropped codes are reported " +
	"in ExportSummary.ExcludedLowTrust."

// Row is one participant row (the same in both session files except the three score columns).
type Row struct {
	AnonID       string
	LLScore      int
	HPTScore     float64 // primary: sum of Kerala 5-band marks over the test clips (0–100)
	PreMean      float64 // primary: mean marks per test clip (0–10)
	PostMean     float64 // primary: mean marks per fresh clip (0–10)
	HPTScoreAlt  float64 // sensitivity: field-kit linear rule
	PreMeanAlt   float64
	PostMeanAlt  float64
	MedianLateS  float64 // NaN when no clip had an in-window tap
	SpeedKmh     float64 // NaN with MedianLateS
	TotalS       float64
	MaxTapsPerS  int
	AgeOK        bool
	RetakeOf     string
	MinClipTrust float64
}

// KeptByScript reports whether nazar_stats.mjs keeps the row (its own exclusions, verbatim).
func (r Row) KeptByScript() bool {
	return r.AgeOK && r.TotalS >= 60 && r.MaxTapsPerS <= 3 && r.RetakeOf == ""
}

// ExportSummary explains what was and was not exported.
type ExportSummary struct {
	Rows             int      `json:"rows"`
	KeptByScript     int      `json:"kept_by_script"`
	RaterRows        int      `json:"rater_rows"`
	ExcludedLowTrust []string `json:"excluded_low_trust"`
	Incomplete       []string `json:"incomplete"`
	Withdrawn        int      `json:"withdrawn"`
	NoInWindowTap    []string `json:"no_in_window_tap"`
	Note             string   `json:"note"`
}

// Export is the four CSV files with their hashes.
type Export struct {
	Files   map[string][]byte
	SHA256  map[string]string
	Rows    []Row
	Summary ExportSummary
}

// ExportInput is everything BuildExport needs; it does no I/O.
type ExportInput struct {
	Participants []*Participant
	Sessions     []*Session
	Speeds       map[string]float64 // clip ref (with or without "clip:") → km/h
	Raters       []RaterRow
	// Blocks maps clip refs to B1/B2/B3 in clip_responses.csv (the block column is empty without it).
	Blocks *Blocks
}

// latest returns each participant's latest session per phase.
func latest(sessions []*Session) map[string]map[string]*Session {
	out := map[string]map[string]*Session{}
	for _, s := range sessions {
		m := out[s.ParticipantCode]
		if m == nil {
			m = map[string]*Session{}
			out[s.ParticipantCode] = m
		}
		if prev, ok := m[s.Phase]; !ok || !s.VerifiedAt.Before(prev.VerifiedAt) {
			m[s.Phase] = s
		}
	}
	return out
}

// scoredClips are the analysis clips that carry a hazard (no-hazard clips measure false alarms
// only and are not part of the 100-mark score, FIELD_STUDY §4.4).
func scoredClips(a NazarAnalysis) []ClipAnalysis {
	var out []ClipAnalysis
	for _, c := range a.Clips {
		if len(c.Hazards) > 0 {
			out = append(out, c)
		}
	}
	return out
}

func sumMarks(cs []ClipAnalysis) float64 {
	var s float64
	for _, c := range cs {
		s += c.Marks
	}
	return s
}

func round6(x float64) float64 { return math.Round(x*1e6) / 1e6 }

// pyMedian is Python statistics.median.
func pyMedian(xs []float64) float64 {
	d := append([]float64{}, xs...)
	sort.Float64s(d)
	n := len(d)
	if n == 0 {
		return math.NaN()
	}
	if n%2 == 1 {
		return d[n/2]
	}
	return (d[n/2-1] + d[n/2]) / 2
}

// lateOf returns a clip's late seconds: the credited hazard with the earliest crediting tap.
func lateOf(c ClipAnalysis) (float64, bool) {
	if c.Voided != nil {
		return 0, false
	}
	best, found := 0.0, false
	var bestTap float64
	for _, h := range c.Hazards {
		if h.LateS == nil || h.TapMt == nil {
			continue
		}
		if !found || *h.TapMt < bestTap {
			best, bestTap, found = *h.LateS, *h.TapMt, true
		}
	}
	return best, found
}

func speedFor(speeds map[string]float64, ref string) (float64, bool) {
	if v, ok := speeds[ref]; ok {
		return v, true
	}
	if v, ok := speeds[strings.TrimPrefix(ref, "clip:")]; ok {
		return v, true
	}
	v, ok := speeds["clip:"+ref]
	return v, ok
}

// BuildExport maps sessions onto the FIELD_STUDY §7.1 columns:
//   - ll_score: correct answers in the 15-question LL mock;
//   - hpt_score: sum of per-clip marks over the test-phase hazard clips (0–100); pre_mean and
//     post_mean: mean per-clip marks over the test and fresh clips. sessions.csv uses the
//     verifier's kerala_5band analysis, sessions_alt.csv its field_kit_linear analysis, and the
//     other columns are identical in both files;
//   - median_late_s: median late_s over test and fresh clips with an in-window tap (per clip,
//     the credited hazard with the earliest tap), from the primary analysis; speed_kmh: median
//     curator speed of those same clips. Both are "nan" when there is no such clip;
//   - total_s: summed duration of the participant's study sessions; max_taps_per_s: most taps in
//     any 1 s over the test and fresh clips (game-core maxTapsInWindow);
//   - age_ok: 1 (enrolment refuses under 18); retake_of: the earlier code.
//
// Participants who withdrew, who lack the LL mock, test or fresh session (or either analysis), and
// sessions with trust < 0.6 on a test or fresh session are not written (reported in the summary).
func BuildExport(in ExportInput) (*Export, error) {
	byCode := latest(in.Sessions)
	ps := append([]*Participant{}, in.Participants...)
	sort.Slice(ps, func(i, j int) bool { return ps[i].Seq < ps[j].Seq || ps[i].Seq == ps[j].Seq && ps[i].Code < ps[j].Code })
	ex := &Export{Files: map[string][]byte{}, SHA256: map[string]string{},
		Summary: ExportSummary{ExcludedLowTrust: []string{}, Incomplete: []string{}, NoInWindowTap: []string{}, Note: ScriptExclusionNote}}
	blockOf := blockIndex(in.Blocks)
	clipRows := [][]string{ClipResponseColumns}
	for _, p := range ps {
		if p.WithdrawnAt != nil {
			ex.Summary.Withdrawn++
			continue
		}
		ss := byCode[p.Code]
		ll, test, fresh := ss[PhaseLLMock], ss[PhaseTest], ss[PhaseFresh]
		if ll == nil || test == nil || fresh == nil || !hasKinds(test) || !hasKinds(fresh) {
			ex.Summary.Incomplete = append(ex.Summary.Incomplete, p.Code)
			continue
		}
		minTrust := math.Min(test.Trust, fresh.Trust)
		if minTrust < TrustMin {
			ex.Summary.ExcludedLowTrust = append(ex.Summary.ExcludedLowTrust, p.Code)
			continue
		}
		row := Row{AnonID: p.Code, AgeOK: p.AgeOK, RetakeOf: p.RetakeOf, MinClipTrust: minTrust}
		if ll.ScoreMax == 15 || ll.ScoreMax == 0 {
			row.LLScore = int(math.Round(ll.ScoreRaw))
		} else {
			row.LLScore = int(math.Round(15 * ll.ScoreRaw / ll.ScoreMax))
		}
		tp, fp := scoredClips(test.Analysis[KindPrimary]), scoredClips(fresh.Analysis[KindPrimary])
		tl, fl := scoredClips(test.Analysis[KindLinear]), scoredClips(fresh.Analysis[KindLinear])
		if len(tp) == 0 || len(fp) == 0 || len(tl) == 0 || len(fl) == 0 {
			ex.Summary.Incomplete = append(ex.Summary.Incomplete, p.Code)
			continue
		}
		row.HPTScore, row.PreMean, row.PostMean = round6(sumMarks(tp)), round6(sumMarks(tp)/float64(len(tp))), round6(sumMarks(fp)/float64(len(fp)))
		row.HPTScoreAlt, row.PreMeanAlt, row.PostMeanAlt = round6(sumMarks(tl)), round6(sumMarks(tl)/float64(len(tl))), round6(sumMarks(fl)/float64(len(fl)))

		var lates, speeds []float64
		for _, c := range append(append([]ClipAnalysis{}, tp...), fp...) {
			l, ok := lateOf(c)
			if !ok {
				continue
			}
			sp, ok := speedFor(in.Speeds, c.Ref)
			if !ok {
				return nil, fmt.Errorf("%w: %s", ErrMissingSpeed, c.Ref)
			}
			lates, speeds = append(lates, l), append(speeds, sp)
		}
		row.MedianLateS, row.SpeedKmh = pyMedian(lates), pyMedian(speeds)
		if len(lates) == 0 {
			ex.Summary.NoInWindowTap = append(ex.Summary.NoInWindowTap, p.Code)
		}
		for _, c := range append(append([]ClipAnalysis{}, test.Analysis[KindPrimary].Clips...), fresh.Analysis[KindPrimary].Clips...) {
			if c.MaxTapsInWindow > row.MaxTapsPerS {
				row.MaxTapsPerS = c.MaxTapsInWindow
			}
		}
		var total int64
		for _, s := range ss {
			total += s.DurationMs
		}
		row.TotalS = float64(total) / 1000
		ex.Rows = append(ex.Rows, row)
		clipRows = append(clipRows, clipResponseRows(p, blockOf, test, PhaseTest)...)
		clipRows = append(clipRows, clipResponseRows(p, blockOf, fresh, PhaseFresh)...)
		if row.KeptByScript() {
			ex.Summary.KeptByScript++
		}
	}
	ex.Summary.Rows = len(ex.Rows)

	primary, alt := [][]string{SessionColumns}, [][]string{SessionColumns}
	for _, r := range ex.Rows {
		common := func(hpt, pre, post float64) []string {
			return []string{r.AnonID, strconv.Itoa(r.LLScore), num(hpt), num(pre), num(post), num(r.MedianLateS), num(r.SpeedKmh),
				num(r.TotalS), strconv.Itoa(r.MaxTapsPerS), boolDigit(r.AgeOK), r.RetakeOf}
		}
		primary = append(primary, common(r.HPTScore, r.PreMean, r.PostMean))
		alt = append(alt, common(r.HPTScoreAlt, r.PreMeanAlt, r.PostMeanAlt))
	}
	raters := [][]string{RaterColumns}
	rr := append([]RaterRow{}, in.Raters...)
	sort.Slice(rr, func(i, j int) bool { return rr[i].ClipID < rr[j].ClipID })
	for _, r := range rr {
		raters = append(raters, []string{r.ClipID, num(float64(r.RaterAOnsetMs) / 1000), num(float64(r.RaterBOnsetMs) / 1000)})
	}
	ex.Summary.RaterRows = len(rr)
	for name, recs := range map[string][][]string{FileSessions: primary, FileSessionsAlt: alt, FileRaters: raters, FileClipResponses: clipRows} {
		b, err := writeCSV(recs)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(b)
		ex.Files[name], ex.SHA256[name] = b, hex.EncodeToString(sum[:])
	}
	return ex, nil
}

// blockIndex maps every block ref (and its bare clip ID) to "B1", "B2" or "B3".
func blockIndex(b *Blocks) map[string]string {
	out := map[string]string{}
	if b == nil {
		return out
	}
	for name, refs := range map[string][]string{"B1": b.B1, "B2": b.B2, "B3": b.B3} {
		for _, r := range refs {
			out[r] = name
			if id := clipIDOf(r); id != "" {
				out[id] = name
			}
		}
	}
	return out
}

// clipIDOf turns a ref (`clip:JMU-0012@3`) into its clip ID.
func clipIDOf(ref string) string {
	id, _, _ := strings.Cut(strings.TrimPrefix(ref, "clip:"), "@")
	return id
}

// clipResponseRows is one clip_responses.csv row per clip of a test or fresh session (no-hazard
// clips included, for false alarms): primary and linear marks, the first crediting tap in media
// seconds ("nan" when no tap was credited), the tap count, the session's timing mode and trust.
func clipResponseRows(p *Participant, blockOf map[string]string, s *Session, phase string) [][]string {
	alt := map[int]ClipAnalysis{}
	for _, c := range s.Analysis[KindLinear].Clips {
		alt[c.Ordinal] = c
	}
	var out [][]string
	for _, c := range s.Analysis[KindPrimary].Clips {
		block := blockOf[c.Ref]
		if block == "" {
			block = blockOf[clipIDOf(c.Ref)]
		}
		scoreAlt := math.NaN()
		if a, ok := alt[c.Ordinal]; ok {
			scoreAlt = a.Marks
		}
		first := math.NaN()
		for _, h := range c.Hazards {
			if h.TapMt != nil && (math.IsNaN(first) || *h.TapMt/1000 < first) {
				first = *h.TapMt / 1000
			}
		}
		out = append(out, []string{p.Code, p.Form, clipIDOf(c.Ref), block, phase, num(round6(c.Marks)), num(round6(scoreAlt)),
			num(round6(first)), strconv.Itoa(c.Taps), s.TimingMode, num(s.Trust)})
	}
	return out
}

func hasKinds(s *Session) bool {
	_, a := s.Analysis[KindPrimary]
	_, b := s.Analysis[KindLinear]
	return a && b
}

// num formats a float the way Python's float() parses it back exactly: plain decimal, no
// exponent, and "nan" for NaN (pyFloat in nazar_stats.mjs accepts it).
func num(x float64) string {
	if math.IsNaN(x) {
		return "nan"
	}
	return strconv.FormatFloat(x, 'f', -1, 64)
}

func boolDigit(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func writeCSV(recs [][]string) ([]byte, error) {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.WriteAll(recs); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Export gathers the tenant's participants, sessions, clip speeds, blocks and rater rows and
// builds the four CSV files (the study.export_csv step and GET /internal/study/exports/{file}).
func (s *Service) Export(ctx context.Context, tenant string) (*Export, error) {
	return s.ExportFrozen(ctx, tenant, time.Time{})
}

// ExportFrozen is Export with the FIELD_STUDY §7.4 data freeze: a non-zero frozenAt leaves out
// sessions verified after it.
func (s *Service) ExportFrozen(ctx context.Context, tenant string, frozenAt time.Time) (*Export, error) {
	ps, err := s.Store.Participants(ctx, tenant)
	if err != nil {
		return nil, err
	}
	all, err := s.Store.Sessions(ctx, tenant)
	if err != nil {
		return nil, err
	}
	sessions := all
	if !frozenAt.IsZero() {
		sessions = make([]*Session, 0, len(all))
		for _, se := range all {
			if !se.VerifiedAt.After(frozenAt) {
				sessions = append(sessions, se)
			}
		}
	}
	refSet := map[string]bool{}
	for _, se := range sessions {
		for _, a := range se.Analysis {
			for _, c := range a.Clips {
				refSet[c.Ref] = true
			}
		}
	}
	refs := make([]string, 0, len(refSet))
	for r := range refSet {
		refs = append(refs, r)
	}
	sort.Strings(refs)
	speeds := map[string]float64{}
	if s.Speeds != nil && len(refs) > 0 {
		if speeds, err = s.Speeds.ClipSpeeds(ctx, refs); err != nil {
			return nil, err
		}
	}
	b, err := s.Store.FormBlocks(ctx, tenant)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	var raters []RaterRow
	if s.Raters != nil && b != nil {
		if raters, err = s.Raters.RaterOnsets(ctx, clipIDs(concat(concat(b.B1, b.B2), b.B3))); err != nil {
			return nil, err
		}
	}
	return BuildExport(ExportInput{Participants: ps, Sessions: sessions, Speeds: speeds, Raters: raters, Blocks: b})
}

// clipIDs turns refs (`clip:JMU-0012@3`) into unique clip IDs.
func clipIDs(refs []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, r := range refs {
		id, _, _ := strings.Cut(strings.TrimPrefix(r, "clip:"), "@")
		if id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
