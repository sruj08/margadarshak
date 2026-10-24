package study

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// KMin is the smallest sample the public Nazar figures are shown for (as lab.KMin).
const KMin = 5

// ScriptStats is what nazar_stats.mjs prints, parsed. Nil pointers mean "nan" or a line the
// script did not print.
type ScriptStats struct {
	N, Of            int
	BelowK           int
	BelowPct         *float64
	BelowCI          [2]*float64
	R                *float64
	RCI              [2]*float64
	MedianLateS      *float64
	MedianMetres     *float64
	MedianSpeedKmh   *float64
	H3MeanGain       *float64
	H3P              *float64
	TestRetestR      *float64
	TestRetestN      int
	H4MedianOnsetS   *float64
	H4Clips          int
	HasH4, HasRetest bool
}

const numRe = `([+-]?(?:\d+(?:\.\d+)?|nan|inf))`

var (
	reN      = regexp.MustCompile(`^N after pre-registered exclusions: (\d+) \(of (\d+)\)$`)
	reH1     = regexp.MustCompile(`^H1  below 60/100: (\d+)/(\d+) = ` + numRe + `%  \(95% CI ` + numRe + `-` + numRe + `%\)$`)
	reH2     = regexp.MustCompile(`^H2  r\(LL mock, Nazar\) = ` + numRe + `  \(95% CI ` + numRe + ` to ` + numRe + `\)$`)
	reLate   = regexp.MustCompile(`^    median late = ` + numRe + ` s  \(~` + numRe + ` m at ` + numRe + ` km/h\)$`)
	reH3     = regexp.MustCompile(`^H3  mean gain after feedback = ` + numRe + `/10 per clip, one-sided Wilcoxon p = ` + numRe + `$`)
	reRetest = regexp.MustCompile(`^    test-retest r = ` + numRe + ` \(n=(\d+)\)$`)
	reH4     = regexp.MustCompile(`^H4  inter-rater median \|d onset\| = ` + numRe + ` s over (\d+) clips$`)
)

func fnum(s string) *float64 {
	if s == "nan" || s == "+nan" || strings.HasSuffix(s, "inf") {
		return nil
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(v) {
		return nil
	}
	return &v
}

// ParseScriptOutput parses the stdout of `node nazar_stats.mjs sessions.csv [raters.csv]`.
func ParseScriptOutput(stdout string) (*ScriptStats, error) {
	st := &ScriptStats{}
	seenN := false
	for _, line := range strings.Split(strings.ReplaceAll(stdout, "\r\n", "\n"), "\n") {
		switch {
		case line == "":
		case reN.MatchString(line):
			m := reN.FindStringSubmatch(line)
			st.N, _ = strconv.Atoi(m[1])
			st.Of, _ = strconv.Atoi(m[2])
			seenN = true
		case reH1.MatchString(line):
			m := reH1.FindStringSubmatch(line)
			st.BelowK, _ = strconv.Atoi(m[1])
			st.BelowPct, st.BelowCI = fnum(m[3]), [2]*float64{fnum(m[4]), fnum(m[5])}
		case reH2.MatchString(line):
			m := reH2.FindStringSubmatch(line)
			st.R, st.RCI = fnum(m[1]), [2]*float64{fnum(m[2]), fnum(m[3])}
		case reLate.MatchString(line):
			m := reLate.FindStringSubmatch(line)
			st.MedianLateS, st.MedianMetres, st.MedianSpeedKmh = fnum(m[1]), fnum(m[2]), fnum(m[3])
		case reH3.MatchString(line):
			m := reH3.FindStringSubmatch(line)
			st.H3MeanGain, st.H3P = fnum(m[1]), fnum(m[2])
		case reRetest.MatchString(line):
			m := reRetest.FindStringSubmatch(line)
			st.TestRetestR = fnum(m[1])
			st.TestRetestN, _ = strconv.Atoi(m[2])
			st.HasRetest = true
		case reH4.MatchString(line):
			m := reH4.FindStringSubmatch(line)
			st.H4MedianOnsetS = fnum(m[1])
			st.H4Clips, _ = strconv.Atoi(m[2])
			st.HasH4 = true
		default:
			return nil, fmt.Errorf("%w: %q", ErrUnparsableOutput, line)
		}
	}
	if !seenN {
		return nil, ErrUnparsableOutput
	}
	return st, nil
}

// Steps returns the study job steps for jobs.Steps(…, extra).
func (s *Service) Steps() map[string]StepFunc {
	return map[string]StepFunc{
		"study.export_csv":          s.stepExportCSV,
		"stats.field_study_publish": s.stepFieldStudyPublish,
	}
}

func decode(args map[string]any, v any) error {
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return &ValidationError{"/args", "invalid"}
	}
	return nil
}

// tenantOr is the step's tenant: the one in args, else DefaultTenant.
func (s *Service) tenantOr(t string) (string, error) {
	if t == "" {
		t = s.DefaultTenant
	}
	if t == "" {
		return "", &ValidationError{"/tenant", "required"}
	}
	return t, nil
}

// ScriptFiles returns the export files to hand to field-kit/nazar_stats.mjs: every file, except
// raters.csv when it has no data row. The pre-registered script (its sha256 is in HYPOTHESES.md,
// so it is never edited) computes median([]) for a header-only raters file and throws; without
// the file it simply prints no H4 line, which is the honest answer when no study clip has two
// agreeing raters yet. The omitted names are returned too.
func ScriptFiles(ex *Export) (files map[string][]byte, omitted []string) {
	files = map[string][]byte{}
	for k, v := range ex.Files {
		if k == FileRaters && ex.Summary.RaterRows == 0 {
			omitted = append(omitted, k)
			continue
		}
		files[k] = v
	}
	return files, omitted
}

// study.export_csv returns the CSV files (as strings), their sha256 and the summary, for the
// nightly_stats task to write next to field-kit/nazar_stats.mjs and run it unmodified. args:
// {tenant?, stats_id?, as_of?} (tenant defaults to DefaultTenant). raters.csv is left out (null)
// while it has no data row: see ScriptFiles; the task then runs the script without it.
func (s *Service) stepExportCSV(ctx context.Context, args map[string]any) (map[string]any, error) {
	var a struct {
		Tenant  string `json:"tenant"`
		StatsID string `json:"stats_id"`
		AsOf    string `json:"as_of"`
	}
	if err := decode(args, &a); err != nil {
		return nil, err
	}
	tenant, err := s.tenantOr(a.Tenant)
	if err != nil {
		return nil, err
	}
	ex, err := s.Export(ctx, tenant)
	if err != nil {
		return nil, err
	}
	kept, omitted := ScriptFiles(ex)
	files, sums := map[string]any{}, map[string]string{}
	for k := range ex.Files {
		files[k] = nil
	}
	for k, v := range kept {
		files[k], sums[k] = string(v), ex.SHA256[k]
	}
	if omitted == nil {
		omitted = []string{}
	}
	out := map[string]any{"tenant": tenant, "files": files, "sha256": sums, "summary": ex.Summary, "omitted": omitted}
	if a.StatsID != "" {
		out["stats_id"] = a.StatsID
	}
	if a.AsOf != "" {
		out["as_of"] = a.AsOf
	}
	return out, nil
}

// publishArgs takes both shapes the callers send: the flat one ({tenant, stdout, script_sha256,
// prereg_commit}) and the Render Workflows nightly_stats one ({stats_id, as_of, script: {name,
// sha256}, inputs_sha256, primary: {argv, stats, stdout}, sensitivity}). The stdout of the
// primary run (sessions.csv [raters.csv]) is what is parsed and stored; the task's own parsed
// numbers are not trusted.
type publishArgs struct {
	Tenant       string `json:"tenant"`
	Stdout       string `json:"stdout"`        // nazar_stats.mjs sessions.csv raters.csv
	ScriptSHA256 string `json:"script_sha256"` // sha256 of the script that ran (pre-registered)
	PreregCommit string `json:"prereg_commit"` // HYPOTHESES.md commit
	Script       *struct {
		SHA256 string `json:"sha256"`
	} `json:"script"`
	Primary *struct {
		Stdout string `json:"stdout"`
	} `json:"primary"`
}

// stats.field_study_publish parses the script's output, checks its counts against a fresh export
// (RW-4: any mismatch is a bug to fix before reporting), and stores the API-71 Nazar figures.
// Below KMin participants only the count is published.
func (s *Service) stepFieldStudyPublish(ctx context.Context, args map[string]any) (map[string]any, error) {
	var a publishArgs
	if err := decode(args, &a); err != nil {
		return nil, err
	}
	tenant, err := s.tenantOr(a.Tenant)
	if err != nil {
		return nil, err
	}
	if a.Stdout == "" && a.Primary != nil {
		a.Stdout = a.Primary.Stdout
	}
	if a.ScriptSHA256 == "" && a.Script != nil {
		a.ScriptSHA256 = a.Script.SHA256
	}
	if len(a.ScriptSHA256) != 64 {
		return nil, &ValidationError{"/script_sha256", "invalid"}
	}
	st, err := ParseScriptOutput(a.Stdout)
	if err != nil {
		return nil, err
	}
	ex, err := s.Export(ctx, tenant)
	if err != nil {
		return nil, err
	}
	if st.Of != ex.Summary.Rows || st.N != ex.Summary.KeptByScript || (st.HasH4 && st.H4Clips != ex.Summary.RaterRows) {
		return nil, fmt.Errorf("%w: script N=%d of %d (H4 %d clips), export kept %d of %d (%d rater rows)",
			ErrStatsMismatch, st.N, st.Of, st.H4Clips, ex.Summary.KeptByScript, ex.Summary.Rows, ex.Summary.RaterRows)
	}
	payload := map[string]any{"participants": st.N, "sample": "convenience", "prereg_hash": a.ScriptSHA256,
		"excluded_low_trust": len(ex.Summary.ExcludedLowTrust)}
	if st.N < KMin {
		payload["status"] = "collecting"
	} else {
		// PublicStats.nazar: status is collecting | published; the H1 share and its CI are 0–1
		// (the script prints percentages); a CI with a nan end is null.
		payload["status"] = "published"
		payload["below_kerala_60_pct"] = scaled(st.BelowPct, 100)
		payload["ci95"] = ciPair(st.BelowCI, 100)
		payload["r_ll_quiz_vs_nazar"] = st.R
		payload["r_ci95"] = ciPair(st.RCI, 1)
		payload["median_late_s"] = st.MedianLateS
		payload["median_metres"] = st.MedianMetres
		payload["h3_mean_gain_per_clip"] = st.H3MeanGain
		payload["h3_wilcoxon_p"] = st.H3P
		if st.HasH4 {
			payload["h4_median_onset_delta_s"] = st.H4MedianOnsetS
		}
	}
	ps := &PublicStats{AsOf: s.now(), Payload: payload, ScriptSHA256: a.ScriptSHA256, PreregCommit: a.PreregCommit}
	if err := s.Store.SavePublicStats(ctx, tenant, ps); err != nil {
		return nil, err
	}
	return map[string]any{"as_of": ps.AsOf, "participants": st.N, "status": payload["status"], "published": true}, nil
}

// scaled divides a parsed figure by d (nil stays nil).
func scaled(v *float64, d float64) *float64 {
	if v == nil {
		return nil
	}
	x := *v / d
	return &x
}

// ciPair is a two-number interval divided by d, or nil when either end is nan.
func ciPair(ci [2]*float64, d float64) []float64 {
	if ci[0] == nil || ci[1] == nil {
		return nil
	}
	return []float64{*ci[0] / d, *ci[1] / d}
}
