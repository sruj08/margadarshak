package study

import (
	"regexp"
	"strings"

	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// Near-miss privacy scan (FIELD_STUDY §4.3 step 8, D-21). On top of the shared PII guard
// (Aadhaar, VID, OTP, phone, e-mail, PAN) it refuses the study-specific identifiers the consent
// screen promises are never collected: vehicle registration numbers, driving-licence numbers,
// a self-introduced or titled name, and an exact place (house or plot number, PIN code). The web
// masks plates and licence numbers before sending ("[vehicle number]"), so a masked line passes.
var (
	// JK02AB1234, JK 02 AB 1234, KL-7-C-123, 22 BH 1234 AA (the web PLATE_RE, letters and digits required).
	nearMissPlateRe = regexp.MustCompile(`(?i)\b(?:[a-z]{2}[\s-]?\d{1,2}[\s-]?[a-z]{0,3}[\s-]?\d{3,4}|\d{2}[\s-]?bh[\s-]?\d{4}[\s-]?[a-z]{1,2})\b`)
	// JK02 20190001234, DL-1420110012345 (the web LICENCE_RE).
	nearMissLicenceRe = regexp.MustCompile(`(?i)\b[a-z]{2}[\s-]?\d{2}[\s-]?(?:19|20)\d{2}[\s-]?\d{7}\b`)
	// "my name is …", "mera naam …", "मेरा नाम …", or a title followed by a capitalised word.
	nearMissNameRe = regexp.MustCompile(`(?i)\b(?:my name is|i am called|mera naam|naam hai)\b|मेरा नाम|नाम है` +
		`|\b(?:Mr|Mrs|Ms|Miss|Dr|Shri|Smt|Sri)\.?\s+[A-Z][a-z]+`)
	// House / flat / plot numbers and 6-digit PIN codes (first digit 1-8).
	nearMissPlaceRe = regexp.MustCompile(`(?i)\b(?:house|h|flat|plot|ward|gali|lane)\s*(?:no\.?|number|#)\s*\d+|\b[1-8]\d{2}\s?\d{3}\b|मकान\s*(?:नं|नंबर)`)
)

// nearMissFindings lists what the near-miss line must not contain (empty when it is clean).
func nearMissFindings(text string) []string {
	var out []string
	for _, f := range privacy.Detect(text) {
		out = append(out, string(f.Kind))
	}
	n := privacy.Normalize(text)
	if nearMissLicenceRe.MatchString(n) {
		out = append(out, "licence")
	}
	for _, m := range nearMissPlateRe.FindAllString(n, -1) {
		// A plate starts with a state code (or is a BH-series number), so ordinary phrases such
		// as "in 2 min 300 m" are not refused.
		lead := strings.ToUpper(m[:2])
		if nearMissStateCodes[lead] || strings.Contains(strings.ToUpper(m), "BH") && lead[0] >= '0' && lead[0] <= '9' {
			out = append(out, "plate")
			break
		}
	}
	if nearMissNameRe.MatchString(n) {
		out = append(out, "name")
	}
	if nearMissPlaceRe.MatchString(n) {
		out = append(out, "place")
	}
	return out
}

// nearMissStateCodes are the registration state and UT codes.
var nearMissStateCodes = func() map[string]bool {
	out := map[string]bool{}
	for _, c := range strings.Fields("AN AP AR AS BR CG CH DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK TN TR TS UK UP WB") {
		out[c] = true
	}
	return out
}()
