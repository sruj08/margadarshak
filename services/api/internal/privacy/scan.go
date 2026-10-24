package privacy

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Violation is prohibited data found in a structured payload.
type Violation struct {
	// Pointer is the RFC 6901 JSON Pointer of the offending value or key.
	Pointer string
	Kind    Kind
}

func (v *Violation) Error() string {
	return fmt.Sprintf("prohibited %s at %s", v.Kind, v.Pointer)
}

// prohibitedKeys are field names the server never accepts (DATA_MODEL §4.1, D-07). Name,
// relation name and address stay in the on-device vault (brief §15).
var prohibitedKeys = []string{"aadhaar", "aadhar", "uid", "vid", "otp", "biometric", "fingerprint", "iris", "face_image", "password"}

// ProhibitedKey reports whether a JSON object key names CX data.
func ProhibitedKey(key string) bool {
	k := strings.ToLower(key)
	for _, p := range prohibitedKeys {
		if k == p || strings.HasPrefix(k, p+"_") || strings.HasSuffix(k, "_"+p) || strings.Contains(k, "aadhaar") {
			return true
		}
	}
	return false
}

// AllowedFactKeys are yes/no questions about what an Aadhaar card shows (F-04 blocker facts,
// api/openapi.yaml PlanRequest/PlanFacts). They are accepted only with a boolean or null value:
// they name the card, they never carry its number.
var AllowedFactKeys = map[string]bool{
	"aadhaar_address_matches_residence": true,
	"aadhaar_has_relation_line":         true,
	"aadhaar_mobile_linked":             true,
	// The web form's answer keys for the same questions (yes | no | not_sure).
	"aadhaar_address_match": true,
	"aadhaar_relation_line": true,
}

func isBoolOrNull(v any) bool {
	switch x := v.(type) {
	case bool, nil:
		return true
	case string:
		return x == "yes" || x == "no" || x == "not_sure"
	}
	return false
}

// ScanJSON decodes raw JSON and returns the first prohibited value or key, if any.
func ScanJSON(raw []byte) (*Violation, error) {
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return ScanValue(v), nil
}

// ScanValue walks a decoded JSON value (maps, slices, strings, numbers).
func ScanValue(v any) *Violation {
	return scan(v, "")
}

func scan(v any, ptr string) *Violation {
	switch t := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			p := ptr + "/" + escapePointer(k)
			if allowed := AllowedFactKeys[k] && isBoolOrNull(t[k]); ProhibitedKey(k) && !allowed {
				return &Violation{Pointer: p, Kind: KindAadhaar}
			}
			if viol := scan(t[k], p); viol != nil {
				return viol
			}
		}
	case []any:
		for i, x := range t {
			if viol := scan(x, ptr+"/"+strconv.Itoa(i)); viol != nil {
				return viol
			}
		}
	case string:
		if kind, ok := FirstProhibited(t); ok {
			return &Violation{Pointer: ptr, Kind: kind}
		}
	case json.Number:
		if kind, ok := FirstProhibited(t.String()); ok {
			return &Violation{Pointer: ptr, Kind: kind}
		}
	case float64:
		if kind, ok := FirstProhibited(strconv.FormatFloat(t, 'f', -1, 64)); ok {
			return &Violation{Pointer: ptr, Kind: kind}
		}
	}
	return nil
}

func escapePointer(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1")
}
