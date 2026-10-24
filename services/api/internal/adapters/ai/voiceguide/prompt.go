package voiceguide

import (
	"fmt"
	"slices"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
)

// fieldHints tell the model each wired field's value format (validators in Fields decide).
var fieldHints = map[string]string{
	"FLD_FULL_NAME_LATIN":      "the name in Latin letters (set it together with FLD_FULL_NAME_DEVANAGARI)",
	"FLD_FULL_NAME_DEVANAGARI": "the name in Devanagari (set it together with FLD_FULL_NAME_LATIN)",
	"FLD_RELATION_TYPE":        "S/o, D/o, W/o or C/o",
	"FLD_RELATION_NAME":        "the relative's name in Latin letters",
	"FLD_DOB":                  "YYYY-MM-DD, the user's own date of birth only",
	"FLD_GENDER":               "female, male, transgender or prefer_not_to_say",
	"FLD_ADDR_LINE":            "house and street, no phone numbers",
	"FLD_ADDR_DISTRICT":        "district name",
	"FLD_ADDR_PIN":             "six-digit postal PIN code",
	"FLD_STATE":                "two-letter state code, e.g. JK",
	"FLD_RTO_CODE":             "RTO code, e.g. JK-02",
	"FLD_VEHICLE_KIND":         "scooter_gearless (Activa, Jupiter), motorcycle_geared, moped_le50cc, car or e_rickshaw",
	"FLD_CLASSES":              "comma-separated licence classes: MC50CC, MCWOG, MCWG, LMV-NT, E-RICKSHAW",
	"FLD_HAS_LL":               "true or false",
	"FLD_LL_ISSUE_DATE":        "YYYY-MM-DD",
	"FLD_AADHAAR_ADDR_MATCHES": "true or false (does the Aadhaar address match where the user lives)",
	"FLD_TEST_DATE":            "YYYY-MM-DD",
	"FLD_LANGUAGE":             "en, hi or doi (the app's language)",
}

// catalogueText is the data part of the instruction (PROMPTS state inputs): the closed screen,
// field, rule and drill IDs the tools accept. The tool schemas enforce the same enums.
func catalogueText(cfg Config) string {
	var b strings.Builder
	b.WriteString("SCREENS (screen_id: what the user might say):\n")
	for _, s := range Screens {
		syn := s.Syn
		if len(syn) > 3 {
			syn = syn[:3]
		}
		fmt.Fprintf(&b, "- %s: %s\n", s.ID, strings.Join(syn, " / "))
	}
	b.WriteString("Someone asking for another person's licence (a parent, a child) goes to SCR_FAMILY_HELPER; never write that person's age into FLD_DOB.\n")
	b.WriteString("FIELDS (field_id: value format):\n")
	for _, id := range fieldIDs() {
		fmt.Fprintf(&b, "- %s: %s\n", id, fieldHints[id])
	}
	rules := ruleIDs(cfg)
	if len(rules) == 0 {
		b.WriteString("ALLOWED_RULE_IDS: none yet. For rule questions open the screen that shows the answer, or say the RTO decides.\n")
	} else {
		b.WriteString("ALLOWED_RULE_IDS (rule_id: topic):\n")
		for _, id := range rules {
			fmt.Fprintf(&b, "- %s: %s\n", id, firstWords(cfg.Rules[id].TextEn, 12))
		}
	}
	return b.String()
}

func firstWords(s string, n int) string {
	w := strings.Fields(s)
	if len(w) > n {
		w = w[:n]
	}
	return strings.Join(w, " ")
}

func fieldIDs() []string {
	out := make([]string, 0, len(Fields))
	for id := range Fields {
		out = append(out, id)
	}
	slices.Sort(out)
	return out
}

func ruleIDs(cfg Config) []string {
	out := make([]string, 0, len(cfg.Rules))
	for id := range cfg.Rules {
		out = append(out, id)
	}
	slices.Sort(out)
	return out
}

func drillIDs(cfg Config) []string {
	out := make([]string, 0, len(cfg.Drills))
	for id := range cfg.Drills {
		out = append(out, id)
	}
	slices.Sort(out)
	return out
}

func enum(ids []string) []any {
	out := make([]any, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}

// object builds a tool input schema; a property with an empty enum list is left open.
func object(required []string, props map[string]*jsonschema.Schema) *jsonschema.Schema {
	return &jsonschema.Schema{Type: "object", Properties: props, Required: required}
}

func idString(desc string, ids []string) *jsonschema.Schema {
	s := &jsonschema.Schema{Type: "string", Description: desc}
	if len(ids) > 0 {
		s.Enum = enum(ids)
	}
	return s
}

func screenIDs() []string {
	out := make([]string, len(Screens))
	for i, s := range Screens {
		out[i] = s.ID
	}
	return out
}
