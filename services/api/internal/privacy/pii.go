// Package privacy holds the PII guard (SECURITY_ARCHITECTURE §10): detection and redaction of
// Aadhaar numbers (Verhoeff-checked), VIDs, OTP-like codes, phone numbers, e-mail addresses and
// PAN, plus field-level encryption for C3/C4 data. The same pattern set is used for logs, error
// reports, inbound request bodies and any text bound for an AI model (EC-20).
package privacy

import (
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// Kind is a class of personal data the guard recognises.
type Kind string

// Kinds recognised by the guard. Aadhaar, VID and OTP are CX (prohibited: never stored or logged).
const (
	KindAadhaar       Kind = "aadhaar"
	KindVID           Kind = "vid"
	KindOTP           Kind = "otp"
	KindPhone         Kind = "phone"
	KindEmail         Kind = "email"
	KindPAN           Kind = "pan"
	KindMaskedAadhaar Kind = "masked_aadhaar"
)

// Prohibited reports whether a kind is CX data that must be rejected at input.
func (k Kind) Prohibited() bool { return k == KindAadhaar || k == KindVID || k == KindOTP }

// Placeholder is the replacement text written in place of a finding.
func (k Kind) Placeholder() string {
	switch k {
	case KindAadhaar:
		return "[aadhaar removed]"
	case KindVID:
		return "[vid removed]"
	case KindOTP:
		return "[otp removed]"
	case KindPhone:
		return "[phone removed]"
	case KindEmail:
		return "[email removed]"
	case KindPAN:
		return "[pan removed]"
	default:
		return ""
	}
}

// Finding is one match, as byte offsets into the normalised text.
type Finding struct {
	Kind       Kind
	Start, End int
}

var (
	digitRunRe     = regexp.MustCompile(`[0-9]+(?:[ .\-][0-9]+)*`)
	emailRe        = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	panRe          = regexp.MustCompile(`\b[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]\b`)
	maskedRe       = regexp.MustCompile(`[Xx]{4}[ \-]?[Xx]{4}[ \-]?[0-9]{4}`)
	urlAuthorityRe = regexp.MustCompile(`https?://[^\s/?#]+`)

	otpKeywords = []string{"otp", "one time", "one-time", "passcode", "password", "code", "pin", "ओटीपी", "कोड", "पासवर्ड", "पिन"}
	vidKeywords = []string{"vid", "virtual id", "virtual-id", "वीआईडी"}
)

const (
	otpWindowRunes = 40
	vidWindowRunes = 30
)

// Normalize maps Devanagari digits (०-९) to ASCII so the same patterns catch Hindi text.
func Normalize(s string) string {
	if !strings.ContainsFunc(s, isDevanagariDigit) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if isDevanagariDigit(r) {
			b.WriteRune('0' + (r - '०'))
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func isDevanagariDigit(r rune) bool { return r >= '०' && r <= '९' }

// Detect returns the non-overlapping findings in the normalised form of s.
// Offsets refer to Normalize(s).
func Detect(s string) []Finding {
	return detect(Normalize(s))
}

func detect(n string) []Finding {
	var out []Finding
	lower := strings.ToLower(n)
	authorities := urlAuthorityRe.FindAllStringIndex(n, -1)
	for _, run := range digitRunRe.FindAllStringIndex(n, -1) {
		for _, f := range classifyRun(n, lower, run[0], run[1]) {
			// A port or IP in a URL authority (http://localhost:3000) is not an OTP or a phone.
			if (f.Kind == KindOTP || f.Kind == KindPhone) && inSpans(authorities, f.Start, f.End) {
				continue
			}
			out = append(out, f)
		}
	}
	taken := func(a, b int) bool {
		for _, f := range out {
			if a < f.End && b > f.Start {
				return true
			}
		}
		return false
	}
	for _, m := range emailRe.FindAllStringIndex(n, -1) {
		// An e-mail swallows any digit findings inside it.
		filtered := out[:0]
		for _, f := range out {
			if f.Start < m[0] || f.End > m[1] {
				filtered = append(filtered, f)
			}
		}
		out = append(filtered, Finding{KindEmail, m[0], m[1]})
	}
	for _, m := range panRe.FindAllStringIndex(n, -1) {
		if !taken(m[0], m[1]) {
			out = append(out, Finding{KindPAN, m[0], m[1]})
		}
	}
	for _, m := range maskedRe.FindAllStringIndex(n, -1) {
		if !taken(m[0], m[1]) {
			out = append(out, Finding{KindMaskedAadhaar, m[0], m[1]})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

type group struct{ start, end int }

// classifyRun looks at one run of digit groups ("98765 43210", "2345-6789-0123") and finds
// Aadhaar (12 digits, first 2-9, Verhoeff), VID (16 digits near a keyword), Indian mobile
// numbers (10 digits starting 6-9, optional 91 prefix) and OTP-like codes (4-8 digits near a
// keyword). Contiguous sub-sequences of groups are tried so a run that merges an age and an
// Aadhaar number ("19 2345 6789 0123") is still caught.
func classifyRun(n, lower string, start, end int) []Finding {
	var groups []group
	gs := start
	for i := start; i < end; i++ {
		if n[i] == ' ' || n[i] == '.' || n[i] == '-' {
			groups = append(groups, group{gs, i})
			gs = i + 1
		}
	}
	groups = append(groups, group{gs, end})

	var out []Finding
	covered := make([]bool, len(groups))
	try := func(kind Kind, want func(d string, a, b int) bool, lengths ...int) {
	outer:
		for i := range groups {
			if covered[i] {
				continue
			}
			var sb strings.Builder
			for j := i; j < len(groups); j++ {
				if covered[j] {
					break
				}
				sb.WriteString(n[groups[j].start:groups[j].end])
				d := sb.String()
				if len(d) > 16 {
					break
				}
				for _, l := range lengths {
					if len(d) == l && want(d, groups[i].start, groups[j].end) {
						for k := i; k <= j; k++ {
							covered[k] = true
						}
						out = append(out, Finding{kind, groups[i].start, groups[j].end})
						continue outer
					}
				}
			}
		}
	}
	try(KindAadhaar, func(d string, _, _ int) bool {
		return d[0] >= '2' && d[0] <= '9' && VerhoeffValid(d)
	}, 12)
	try(KindVID, func(_ string, a, b int) bool { return nearKeyword(lower, a, b, vidKeywords, vidWindowRunes) }, 16)
	try(KindPhone, func(d string, _, _ int) bool {
		if len(d) == 12 && strings.HasPrefix(d, "91") {
			d = d[2:]
		}
		return d[0] >= '6' && d[0] <= '9'
	}, 10, 12)
	try(KindOTP, func(_ string, a, b int) bool { return nearKeyword(lower, a, b, otpKeywords, otpWindowRunes) }, 4, 5, 6, 7, 8)
	return out
}

// nearKeyword reports whether any keyword occurs within window runes of [a, b).
func nearKeyword(lower string, a, b int, keywords []string, window int) bool {
	from := a
	for i := 0; i < window && from > 0; i++ {
		_, size := utf8.DecodeLastRuneInString(lower[:from])
		from -= size
	}
	to := b
	for i := 0; i < window && to < len(lower); i++ {
		_, size := utf8.DecodeRuneInString(lower[to:])
		to += size
	}
	w := lower[from:to]
	for _, k := range keywords {
		if strings.Contains(w, k) {
			return true
		}
	}
	return false
}

// Redact returns s with every finding replaced by its placeholder (masked Aadhaar strings are
// stripped) and the kinds found. Devanagari digits in the output are normalised to ASCII.
func Redact(s string) (string, []Kind) {
	n := Normalize(s)
	findings := detect(n)
	if len(findings) == 0 {
		return n, nil
	}
	var b strings.Builder
	b.Grow(len(n))
	last := 0
	kinds := make([]Kind, 0, len(findings))
	for _, f := range findings {
		if f.Start < last {
			continue
		}
		b.WriteString(n[last:f.Start])
		b.WriteString(f.Kind.Placeholder())
		last = f.End
		kinds = append(kinds, f.Kind)
	}
	b.WriteString(n[last:])
	return b.String(), kinds
}

// RedactString is Redact without the kinds.
func RedactString(s string) string {
	out, _ := Redact(s)
	return out
}

// FirstProhibited returns the first CX finding (Aadhaar, VID, OTP) in s, if any.
func FirstProhibited(s string) (Kind, bool) {
	for _, f := range Detect(s) {
		if f.Kind.Prohibited() {
			return f.Kind, true
		}
	}
	return "", false
}

var twelveDigitsRe = regexp.MustCompile(`[0-9]{12}`)

// HasTwelveDigitRun reports whether s contains 12 digits in a row once separators are removed.
// The Aadhaar-offline adapter uses this stricter test (MD-039): any 12-digit string anywhere in
// its payload is rejected, Verhoeff-valid or not.
func HasTwelveDigitRun(s string) bool {
	n := Normalize(s)
	compact := strings.NewReplacer(" ", "", "-", "", ".", "").Replace(n)
	return twelveDigitsRe.MatchString(compact)
}

func inSpans(spans [][]int, a, b int) bool {
	for _, s := range spans {
		if a >= s[0] && b <= s[1] {
			return true
		}
	}
	return false
}
