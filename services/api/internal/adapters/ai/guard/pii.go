// Package guard holds the deterministic checks every AI pipeline shares (AGENTS.md §2.1, PROMPTS
// §4–§6): the PII gate (P3, EC-20), number provenance (P5), the no-digit and tone rules of the
// schema validator (P6: V4, V8, V9), the prompt-injection screen (P4) and the canary. It is pure
// Go with no I/O, so the same code runs in production, in the eval harness and in the demo.
package guard

import (
	"regexp"
	"slices"
	"strings"

	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// PII kinds the gate reports. The first three are CX data (never stored, logged or sent).
const (
	KindAadhaar     = "aadhaar"
	KindVID         = "vid"
	KindOTP         = "otp"
	KindPhone       = "phone"
	KindEmail       = "email"
	KindPAN         = "pan"
	KindDLNumber    = "dl_number"
	KindApplication = "application_number"
	KindMasked      = "masked_aadhaar"
)

// Hit is one PII span in the text returned by NormalizeSpoken.
type Hit struct {
	Kind       string
	Start, End int
}

var (
	dlNumberRe = regexp.MustCompile(`\b[A-Z]{2}[ -]?\d{2}[ /-]?\d{4,11}\b`)
	// Sarathi application, LL and DL serials are 10, 15, 16 or 20 digits (01-sarathi §G).
	appNumberRe = regexp.MustCompile(`\b(?:\d{20}|\d{16}|\d{15}|\d{10})\b`)
)

// digitWords maps spoken digits (en, hi, Hinglish) to their value. Runs of four or more are read
// as a number ("OTP four eight two one", "चार आठ दो एक"), so a spoken code is caught like a typed one.
var digitWords = map[string]byte{
	"zero": '0', "oh": '0', "one": '1', "two": '2', "three": '3', "four": '4', "five": '5', "six": '6',
	"seven": '7', "eight": '8', "nine": '9',
	"शून्य": '0', "एक": '1', "दो": '2', "तीन": '3', "चार": '4', "पांच": '5', "पाँच": '5', "छह": '6', "छः": '6',
	"सात": '7', "आठ": '8', "नौ": '9',
	"shunya": '0', "ek": '1', "do": '2', "teen": '3', "char": '4', "chaar": '4', "paanch": '5', "panch": '5',
	"chhe": '6', "che": '6', "saat": '7', "aath": '8', "nau": '9',
}

// NormalizeSpoken maps Devanagari digits to ASCII and runs of four or more spoken digit words to
// digits, so "ओटीपी चार आठ दो एक" reads "ओटीपी 4821".
func NormalizeSpoken(s string) string {
	s = privacy.Normalize(s)
	fields := strings.Fields(s)
	if len(fields) < 4 {
		return s
	}
	var out []string
	for i := 0; i < len(fields); {
		j := i
		var digits []byte
		for j < len(fields) {
			d, ok := digitWords[strings.ToLower(strings.Trim(fields[j], ",.;:!?।"))]
			if !ok {
				break
			}
			digits = append(digits, d)
			j++
		}
		if len(digits) >= 4 {
			out = append(out, string(digits))
			i = j
			continue
		}
		out = append(out, fields[i])
		i++
	}
	return strings.Join(out, " ")
}

var (
	// "PIN code" is the postal code: a 6-digit Indian PIN (first digit 1-8) next to it is an
	// address field (FLD_ADDR_PIN), not an OTP.
	postalPINPhrase = regexp.MustCompile(`(?i)pin ?code|पिन ?कोड|पिनकोड|postal code`)
	postalPIN       = regexp.MustCompile(`^[1-8]\d{5}$`)
)

// Scan finds PII in text after NormalizeSpoken. Offsets refer to NormalizeSpoken(text).
func Scan(text string) []Hit {
	n := NormalizeSpoken(text)
	postal := postalPINPhrase.MatchString(n)
	var hits []Hit
	for _, f := range privacy.Detect(n) {
		if postal && f.Kind == privacy.KindOTP && postalPIN.MatchString(n[f.Start:f.End]) {
			continue
		}
		hits = append(hits, Hit{Kind: string(f.Kind), Start: f.Start, End: f.End})
	}
	overlaps := func(a, b int) bool {
		for _, h := range hits {
			if a < h.End && b > h.Start {
				return true
			}
		}
		return false
	}
	for _, m := range dlNumberRe.FindAllStringIndex(n, -1) {
		if !overlaps(m[0], m[1]) {
			hits = append(hits, Hit{Kind: KindDLNumber, Start: m[0], End: m[1]})
		}
	}
	for _, m := range appNumberRe.FindAllStringIndex(n, -1) {
		if !overlaps(m[0], m[1]) {
			hits = append(hits, Hit{Kind: KindApplication, Start: m[0], End: m[1]})
		}
	}
	slices.SortFunc(hits, func(a, b Hit) int { return a.Start - b.Start })
	return hits
}

// Kinds returns the distinct kinds in hits, in order of first appearance.
func Kinds(hits []Hit) []string {
	var out []string
	for _, h := range hits {
		if !slices.Contains(out, h.Kind) {
			out = append(out, h.Kind)
		}
	}
	return out
}

// Redact drops every PII span (P3 drops, it does not mask) and returns the remaining text with the
// kinds found. The span is replaced by "[removed]" so the sentence still reads.
func Redact(text string) (string, []string) {
	n := NormalizeSpoken(text)
	hits := Scan(text)
	if len(hits) == 0 {
		return n, nil
	}
	var b strings.Builder
	last := 0
	for _, h := range hits {
		if h.Start < last {
			continue
		}
		b.WriteString(n[last:h.Start])
		b.WriteString("[removed]")
		last = h.End
	}
	b.WriteString(n[last:])
	return b.String(), Kinds(hits)
}

// MustRefuse reports whether a voice or chat turn has to be answered with PII_REFUSAL: any
// identity number or code (Aadhaar, VID, OTP, phone, DL or application number, PAN).
func MustRefuse(text string) (string, bool) {
	for _, h := range Scan(text) {
		if h.Kind != KindEmail && h.Kind != KindMasked {
			return h.Kind, true
		}
	}
	// A misheard digit breaks the Verhoeff check; any 12-digit run is treated as an Aadhaar number.
	if privacy.HasTwelveDigitRun(NormalizeSpoken(text)) {
		return KindAadhaar, true
	}
	return "", false
}

// PIIRefusal is the canned PII_REFUSAL line (VOICE.md §4.3, EC-20). It is fixed copy, never
// model text.
func PIIRefusal(locale string) string {
	switch locale {
	case "hi", "doi":
		return "यह नंबर मुझे न बताएँ। आधार, ओटीपी या मोबाइल नंबर सिर्फ़ parivahan.gov.in पर खुद टाइप करें।"
	default:
		return "Please don't tell me this number. Type Aadhaar, OTP or phone numbers only on parivahan.gov.in yourself."
	}
}
