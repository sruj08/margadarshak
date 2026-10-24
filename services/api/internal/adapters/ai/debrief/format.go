package debrief

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

var placeholderRe = regexp.MustCompile(`\{\{fact:([a-z0-9_]+)\}\}`)

type unitText struct{ sec, m, kmh, times, once, yes, no, clip string }

var units = map[string]unitText{
	"en": {sec: "s", m: "m", kmh: "km/h", times: "times", once: "once", yes: "yes", no: "no", clip: "clip"},
	"hi": {sec: "सेकंड", m: "मीटर", kmh: "किमी/घंटा", times: "बार", once: "एक बार", yes: "हाँ", no: "नहीं", clip: "क्लिप"},
}

func trimFloat(v float64, dec int) string {
	s := strconv.FormatFloat(v, 'f', dec, 64)
	if dec > 0 {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s
}

// formatFact renders one fact value with its unit (DEBRIEF_SPEC §5.2). The second result is false
// when the value does not fit its kind, so the caller can drop that clause.
func formatFact(key string, v any, kind, locale string) (string, bool) {
	u, ok := units[locale]
	if !ok {
		u = units["en"]
	}
	switch kind {
	case "enum", "enum_list":
		s, ok := v.(string)
		if !ok {
			return "", false
		}
		return strings.ReplaceAll(strings.ReplaceAll(s, "_", " "), ",", ", "), true
	case "boolean":
		b, ok := v.(bool)
		if !ok {
			return "", false
		}
		if b {
			return u.yes, true
		}
		return u.no, true
	}
	n, ok := v.(float64)
	if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
		return "", false
	}
	switch kind {
	case "seconds":
		return trimFloat(n, 1) + " " + u.sec, true
	case "metres":
		return "≈ " + trimFloat(math.Round(n), 0) + " " + u.m, true
	case "kmh":
		return trimFloat(math.Round(n), 0) + " " + u.kmh, true
	case "percent":
		return trimFloat(math.Round(n), 0) + "%", true
	case "times":
		if n == 1 {
			return u.once, true
		}
		return trimFloat(n, 0) + " " + u.times, true
	case "ordinal":
		return trimFloat(n, 0), true // templates already say "clip" / "क्लिप"
	case "centimetres":
		return trimFloat(n, 0) + " cm", true
	case "rate_per_min":
		return trimFloat(n, 1) + "/min", true
	default: // number, ratio
		return trimFloat(n, 2), true
	}
}

// fill replaces every {{fact:key}}. A sentence whose placeholder has no usable value is dropped, so
// a template with an optional fact still reads well; "" means nothing readable is left.
func fill(text string, facts map[string]any, kinds map[string]string, locale string) string {
	segs := regexp.MustCompile(`[^.;!?।]+[.;!?।]*\s*`).FindAllString(text, -1)
	var out []string
	for _, seg := range segs {
		okSeg := true
		seg = placeholderRe.ReplaceAllStringFunc(seg, func(m string) string {
			key := placeholderRe.FindStringSubmatch(m)[1]
			val, has := facts[key]
			if !has {
				okSeg = false
				return ""
			}
			s, good := formatFact(key, val, kinds[key], locale)
			if !good {
				okSeg = false
			}
			return s
		})
		if okSeg {
			out = append(out, seg)
		}
	}
	return strings.TrimSpace(strings.Join(out, ""))
}
