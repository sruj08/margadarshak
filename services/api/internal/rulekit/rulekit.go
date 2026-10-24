// Package rulekit is a read-only helper around the authoritative rules engine (internal/rules,
// owned by the RULES agent). It never changes rule semantics: it reads effective parameter rows
// from a compiled pack (state overrides applied by the engine) and maps API vocabulary to the
// engine's (picture IDs, DOB precision).
package rulekit

import (
	"github.com/sruj08/margadarshak/services/api/internal/rules"
)

// Param returns the effective value and row of a parameter (by base ID, e.g. PRM-MIN-WAIT-DAYS).
func Param(c *rules.Compiled, id string) (any, *rules.Rule) {
	var found *rules.Rule
	for _, r := range c.Rules {
		if r.Kind != "param" {
			continue
		}
		if r.ID == id || r.Overrides == id {
			found = r
			if r.Overrides == id {
				break // a state override wins over the base row
			}
		}
	}
	if found == nil {
		return nil, nil
	}
	return found.Output["value"], found
}

// Int returns an integer parameter (0 and "" when absent).
func Int(c *rules.Compiled, id string) (int, string) {
	v, r := Param(c, id)
	if r == nil {
		return 0, ""
	}
	switch n := v.(type) {
	case int64:
		return int(n), r.ID
	case int:
		return n, r.ID
	case float64:
		return int(n), r.ID
	}
	return 0, r.ID
}

// Bool returns a boolean parameter.
func Bool(c *rules.Compiled, id string) bool {
	v, _ := Param(c, id)
	b, _ := v.(bool)
	return b
}

// Params are the timeline parameters of a pack.
type Params struct {
	MinWaitDays      int
	LLValidityMonths int
	RetestGapDays    int
	Form1AAge        int
	RemedialAfter    bool
	MinWaitRule      string
	ValidityRule     string
	RetestGapRule    string
}

// ParamsOf reads the timeline parameters.
func ParamsOf(c *rules.Compiled) Params {
	var p Params
	p.MinWaitDays, p.MinWaitRule = Int(c, "PRM-MIN-WAIT-DAYS")
	p.LLValidityMonths, p.ValidityRule = Int(c, "PRM-LL-VALIDITY-MONTHS")
	p.RetestGapDays, p.RetestGapRule = Int(c, "PRM-RETEST-GAP-DAYS")
	p.Form1AAge, _ = Int(c, "PRM-FORM1A-AGE")
	p.RemedialAfter = Bool(c, "PRM-REMEDIAL-AFTER-FAIL")
	return p
}

// EffectiveID returns the effective row ID for a base rule ID (the state override, if any).
func EffectiveID(c *rules.Compiled, base string) string {
	for _, r := range c.Rules {
		if r.Overrides == base {
			return r.ID
		}
	}
	return base
}

// LLDates computes the LL window from an issue date with the pack's parameters, exactly as the
// engine's planner does (issue + min_wait_days; issue + validity months).
func LLDates(c *rules.Compiled, issued rules.Date) (unlock, expires rules.Date) {
	p := ParamsOf(c)
	return issued.AddDays(p.MinWaitDays), issued.AddMonths(p.LLValidityMonths)
}

// vehicleAliases maps the original API-01 picture names to the rule-pack picture IDs.
var vehicleAliases = map[string]string{
	"scooter_gearless": "scooter",
	"motorcycle":       "bike_gear",
	"light_goods":      "goods_light",
}

// Vehicle maps an API vehicle picture to the rule-pack picture ID.
func Vehicle(v string) string {
	if a, ok := vehicleAliases[v]; ok {
		return a
	}
	return v
}

// Disability maps API disability needs to the engine's vocabulary.
func Disability(v string) string {
	if v == "adapted_controls" {
		return "locomotor"
	}
	return v
}

// Precision maps the API DOB precision (day | year_only) to the engine's (day | year).
func Precision(p string) string {
	if p == "year_only" || p == "year" {
		return "year"
	}
	return "day"
}

// ClassRow returns the classes.json row of a class code.
func ClassRow(c *rules.Compiled, code string) *rules.ClassRow {
	for _, cr := range c.Classes.Classes {
		if cr.Code == code {
			return cr
		}
	}
	return nil
}

// SarathiCodes maps class codes to Sarathi's own class codes (classes.json sarathiCode).
func SarathiCodes(c *rules.Compiled, codes []string) []string {
	out := make([]string, 0, len(codes))
	for _, code := range codes {
		if cr := ClassRow(c, code); cr != nil && cr.SarathiCode != "" {
			out = append(out, cr.SarathiCode)
		} else {
			out = append(out, code)
		}
	}
	return out
}
