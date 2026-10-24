package guard

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"strings"
)

// injection patterns (P4). Free text that matches is dropped before the model sees it; the
// pipeline carries on with the remaining structured facts.
var injection = []bannedRule{
	{"instruction_override", regexp.MustCompile(`(?i)\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|all|the|your|system)\b.{0,20}\b(instructions?|rules?|prompts?)\b|सारे नियम भूल|नियम भूल जाओ|niyam bhool|instructions? ignore`)},
	{"role_play", regexp.MustCompile(`(?i)\byou are now\b|\bact as\b|\bpretend (to be|you)\b|\bjailbreak\b|\bdeveloper mode\b|\bdan mode\b|tum ab .{0,20} ho`)},
	{"data_exfiltration", regexp.MustCompile(`(?i)\bsystem prompt\b|\breveal (your|the)\b|\bprint (your|the) (instructions|prompt)\b|\bcanary\b|MD-CANARY`)},
	{"answer_key_request", regexp.MustCompile(`(?i)\banswer key\b|\ball (the )?(correct )?answers\b|सारे सही उत्तर|sab sahi jawab`)},
	{"fee_or_rule_override", regexp.MustCompile(`(?i)\bfee is (zero|0|free|nil)\b|फीस शून्य|फीस माफ़|\bsay (it'?s|this is|that it'?s) (safe|official|verified)\b|\bpass mark is\b`)},
}

// Injection returns the category of the first injection pattern in s, or "".
func Injection(s string) string {
	for _, b := range injection {
		if b.re.MatchString(s) {
			return b.category
		}
	}
	return ""
}

// Canary is a per-process marker put in every system instruction. A reply that contains it means
// the instruction leaked; the reply is discarded (P6) and the event logged for W12.
var Canary = newCanary()

func newCanary() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "MD-CANARY-" + hex.EncodeToString(b)
}

// Leaked reports whether s contains the canary.
func Leaked(s string) bool { return strings.Contains(s, Canary) }
