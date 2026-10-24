package guard

import (
	"regexp"
	"strings"
	"unicode"
)

// bannedRule is one row of the banned-terms list (PROMPTS §4.1).
type bannedRule struct {
	category string
	re       *regexp.Regexp
}

// dw matches a Devanagari word on letter boundaries (Go's \b is ASCII-only, and "शर्म" must not
// match inside "शर्मा" nor "लाश" inside "तलाश").
func dw(word string) string { return `(?:^|[^\p{L}\p{M}])` + word + `(?:$|[^\p{L}\p{M}])` }

var banned = []bannedRule{
	{"claim", regexp.MustCompile(`(?i)\bofficial(ly)?\b|` + dw("आधिकारिक") + `|\bfirst[- ]ever\b|\bdpdp[- ]compliant\b|\bstqc[- ]certified\b|\bintegrated with (sarathi|aadhaar|uidai)\b|\bverified licen[cs]e\b|\blives saved\b|\bsaarthi\b|\bguarantee(d)?\b|\bverified\b`)},
	{"scam_verdict", regexp.MustCompile(`(?i)\bsafe\b|सुरक्षित है`)},
	{"fear_shame", regexp.MustCompile(`(?i)\byou would( have)? (crash|die|died)\b|\bunsafe driver\b|आप मर|\bbeta\b|\bstupid\b|\bidiot\b|` + dw("बेवकूफ") + `|\bshame(ful)?\b|` + dw("शर्म") + `|\blazy\b|\bdisappoint`)},
	{"gore", regexp.MustCompile(`(?i)\bblood\b|\bgore\b|\bdead body\b|` + dw("लाश") + `|\bdeaths?\b|` + dw("मौत"))},
	{"speed", regexp.MustCompile(`(?i)\bfastest\b|\bspeed king\b|\brecord time\b|सबसे तेज़|सबसे तेज`)},
	{"nag", regexp.MustCompile(`(?i)\bstreak (will be )?lost\b|\bdon'?t break (your|the) streak\b|\bbehind your friends\b|\beveryone else (has|is)\b|\blast chance\b|\bhurry\b`)},
	{"money", moneyRe},
}

// Banned returns the category and text of the first banned term in s, or "", "".
func Banned(s string) (category, term string) {
	for _, b := range banned {
		if m := b.re.FindString(s); m != "" {
			return b.category, m
		}
	}
	return "", ""
}

// ScriptOK is V9: the share of letters in the locale's script. Placeholders ({late_s}) are
// ignored. hi and doi need ≥70 % Devanagari, en ≥90 % Latin, hinglish ≥60 % Latin.
func ScriptOK(s, locale string) bool {
	var deva, latin int
	for _, r := range placeholderRe.ReplaceAllString(s, " ") {
		switch {
		case unicode.Is(unicode.Devanagari, r) && unicode.IsLetter(r):
			deva++
		case unicode.Is(unicode.Latin, r):
			latin++
		}
	}
	total := deva + latin
	if total == 0 {
		return true
	}
	switch locale {
	case "hi", "doi":
		return float64(deva)/float64(total) >= 0.70
	case "hinglish":
		return float64(latin)/float64(total) >= 0.60
	default:
		return float64(latin)/float64(total) >= 0.90
	}
}

// placeholderRe matches both placeholder styles: {{fact:key}} (debrief) and {key} (coach, voice).
var placeholderRe = regexp.MustCompile(`\{\{fact:([a-z0-9_]+)\}\}|\{([a-z0-9_]+)\}`)

// Placeholders returns the keys of the placeholders used in s.
func Placeholders(s string) []string {
	var out []string
	for _, m := range placeholderRe.FindAllStringSubmatch(s, -1) {
		out = append(out, m[1]+m[2])
	}
	return out
}

// StripPlaceholders removes every placeholder, leaving the free text a validator checks.
func StripPlaceholders(s string) string {
	return strings.TrimSpace(placeholderRe.ReplaceAllString(s, ""))
}
