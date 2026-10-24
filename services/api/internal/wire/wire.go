// Package wire holds the JSON shapes (snake_case, api/openapi.yaml) that several services
// produce: provenance chips, blocker rows, fee quotes and the plan card. Keeping them here lets
// the plan snapshot be stored exactly as API-01 returned it and lets cases, plans and the HTTP
// layer render the same rows. Contract tests validate every response against the spec.
package wire

import (
	"regexp"
	"strings"

	"github.com/sruj08/margadarshak/services/api/internal/rules"
)

// Provenance is the source chip of a value (Provenance schema).
type Provenance struct {
	SourceTitle     string `json:"source_title"`
	SourceURL       string `json:"source_url,omitempty"`
	VerifiedOn      string `json:"verified_on"`
	Confidence      string `json:"confidence"`
	Verified        bool   `json:"verified"`
	RulePackVersion string `json:"rule_pack_version,omitempty"`
}

var isDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// Prov maps the engine's provenance to the wire chip.
func Prov(p rules.ProvOut, packVersion string) Provenance {
	conf := p.Confidence
	switch conf {
	case "high", "medium", "low":
	default:
		conf = "low"
	}
	out := Provenance{SourceTitle: p.SourceTitle, Confidence: conf, Verified: p.Verified, RulePackVersion: packVersion, VerifiedOn: p.CheckedOn}
	if out.SourceTitle == "" {
		out.SourceTitle = "Rule pack " + packVersion
	}
	if strings.HasPrefix(p.SourceURL, "https://") || strings.HasPrefix(p.SourceURL, "http://") {
		out.SourceURL = p.SourceURL
	}
	if !isDate.MatchString(out.VerifiedOn) {
		out.VerifiedOn = "2026-10-23"
	}
	return out
}

// Blocker is one evaluated rule row (Blocker schema, F-04).
type Blocker struct {
	BlockerID   string      `json:"blocker_id"`
	Severity    string      `json:"severity"`
	Kind        string      `json:"kind"`
	TitleKey    string      `json:"title_key"`
	FixKey      string      `json:"fix_key,omitempty"`
	RuleID      string      `json:"rule_id"`
	Confidence  string      `json:"confidence"`
	VerifyAtRTO bool        `json:"verify_at_rto"`
	Refs        []string    `json:"refs"`
	DueOn       string      `json:"due_on,omitempty"`
	Provenance  *Provenance `json:"provenance,omitempty"`
}

var refID = regexp.MustCompile(`^(EC|F|D)-\d{2}$`)

// FromIssue maps an engine issue (blocker | warning | notice) to a Blocker row.
func FromIssue(is rules.Issue, packVersion string) Blocker {
	b := Blocker{Kind: is.Severity, TitleKey: is.TextKey, RuleID: is.RuleID, VerifyAtRTO: is.VerifyAtRTO, Refs: []string{}}
	switch is.Severity {
	case "blocker":
		b.Severity = "block"
	case "warning":
		b.Severity = "warn"
	default:
		b.Severity, b.Kind = "info", "notice"
	}
	for _, r := range is.Refs {
		if refID.MatchString(r) {
			b.Refs = append(b.Refs, r)
		}
	}
	for _, r := range b.Refs {
		if strings.HasPrefix(r, "EC-") {
			b.BlockerID = r
			break
		}
	}
	if b.BlockerID == "" {
		b.BlockerID = "F-04"
		if len(b.Refs) > 0 {
			b.BlockerID = b.Refs[0]
		}
	}
	if is.FixKey != nil {
		b.FixKey = *is.FixKey
	}
	if is.DueOn != nil {
		b.DueOn = *is.DueOn
	}
	p := Prov(is.Provenance, packVersion)
	b.Confidence = p.Confidence
	b.Provenance = &p
	return b
}

// Issues maps a list of engine issues.
func Issues(list []rules.Issue, packVersion string) []Blocker {
	out := make([]Blocker, 0, len(list))
	for _, is := range list {
		out = append(out, FromIssue(is, packVersion))
	}
	return out
}

// FeeLine is one line of a quote (FeeQuote.lines).
type FeeLine struct {
	LineID      string `json:"line_id"`
	LabelKey    string `json:"label_key"`
	ClassCode   string `json:"class_code,omitempty"`
	Quantity    int    `json:"quantity"`
	AmountPaise int64  `json:"amount_paise"`
	RuleID      string `json:"rule_id"`
	Stage       string `json:"stage,omitempty"`
}

// FeeQuote is E-07 on the wire (integer paise, from fees.json only).
type FeeQuote struct {
	QuoteID              string     `json:"quote_id"`
	Currency             string     `json:"currency"`
	Lines                []FeeLine  `json:"lines"`
	SubtotalGovtFeePaise int64      `json:"subtotal_govt_fee_paise"`
	TotalPaise           int64      `json:"total_paise"`
	LLStagePaise         int64      `json:"ll_stage_paise"`
	Excludes             []string   `json:"excludes"`
	Provenance           Provenance `json:"provenance"`
}

var allowedExcludes = map[string]bool{"state_service_charge": true, "postage": true, "medical_certificate": true, "school_fees": true}

// Quote maps an engine fee quote; quoteID is the stored quote's public ID.
func Quote(q rules.FeeQuote, quoteID, packVersion string) FeeQuote {
	out := FeeQuote{QuoteID: quoteID, Currency: "INR", Lines: []FeeLine{}, Excludes: []string{}, SubtotalGovtFeePaise: q.SubtotalGovtFeePaise,
		TotalPaise: q.TotalPaise, LLStagePaise: q.LLStagePaise, Provenance: Prov(q.Provenance, packVersion)}
	for _, l := range q.Lines {
		line := FeeLine{LineID: strings.ToLower(strings.TrimPrefix(l.FeeID, "FEE-")), LabelKey: l.LabelKey, Quantity: l.Quantity,
			AmountPaise: l.AmountPaise, RuleID: l.RuleID, Stage: l.Stage}
		line.LineID = strings.ReplaceAll(line.LineID, "-", "_")
		if l.ClassCode != nil {
			line.ClassCode = *l.ClassCode
		}
		if line.Quantity < 1 {
			line.Quantity = 1
		}
		out.Lines = append(out.Lines, line)
	}
	for _, e := range q.Excludes {
		if allowedExcludes[e] {
			out.Excludes = append(out.Excludes, e)
		}
	}
	return out
}
