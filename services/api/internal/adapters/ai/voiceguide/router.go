package voiceguide

import (
	"regexp"
	"strings"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/guard"
)

// Intent is the deterministic router's decision (AGENTS.md §3.1 synonym_router).
type Intent struct {
	// Kind is pii, refuse, navigate or none.
	Kind       string
	ResponseID string
	ScreenID   string
	PIIKind    string
}

var (
	accidentRe = regexp.MustCompile(`(?i)\baccident\b|एक्सीडेंट|दुर्घटना|हादसा|chot lagi|injured`)
	settingRe  = regexp.MustCompile(`(?i)\bsetting\b|सेटिंग|\bagent\b|एजेंट|\bdalal\b|दलाल|rishwat|रिश्वत|bribe|bina test`)
	payRe      = regexp.MustCompile(`(?i)\bpay\b|payment kar|पैसे भर|भुगतान कर|₹|\bupi\b|paise bhar|fees? bhar|फीस भर|submit|जमा कर|jama kar`)
	bookRe     = regexp.MustCompile(`(?i)\bbook\b|बुक|booking`)
	legalRe    = regexp.MustCompile(`(?i)challan .*maaf|चालान .*माफ़|चालान .*माफ|court|vakil|वकील`)
	familyRe   = regexp.MustCompile(`(?i)\b(papa|mummy|maa|father|mother|bhai|behen|beti|beta ke liye)\b|पापा|मम्मी|माँ के|पिता|माता|बेटी|भाई के`)
	affirmRe   = regexp.MustCompile(`(?i)^(haan|ha|haa|yes|yeah|ok|okay|sahi hai|theek hai|ठीक है|हाँ|हां|हाँ जी|हां जी|सही है|आं|ji haan)[\s.!,।]*(सही है|sahi hai|ji|जी)?[\s.!।]*$`)
)

// Affirmative reports a clear yes ("haan", "हाँ सही है", "yes", Dogri "आं").
func Affirmative(s string) bool {
	return affirmRe.MatchString(strings.TrimSpace(s))
}

// Route decides what must happen before (or instead of) the model: identity numbers and banned
// intents are answered with canned lines; a clear screen synonym is a navigation.
func Route(text string) Intent {
	if kind, refuse := guard.MustRefuse(text); refuse {
		return Intent{Kind: "pii", ResponseID: "PII_REFUSAL", PIIKind: kind}
	}
	switch {
	case accidentRe.MatchString(text):
		return Intent{Kind: "refuse", ResponseID: "CALL_112"}
	case guard.Injection(text) != "":
		return Intent{Kind: "refuse", ResponseID: "CANNOT_ACT_ON_SARATHI"}
	case settingRe.MatchString(text):
		return Intent{Kind: "refuse", ResponseID: "NO_AGENTS_NO_SETTING", ScreenID: "SCR_SCAM_CHECK"}
	case payRe.MatchString(text):
		return Intent{Kind: "refuse", ResponseID: "CANNOT_ACT_ON_SARATHI", ScreenID: "SCR_HANDOFF_SARATHI"}
	case bookRe.MatchString(text):
		return Intent{Kind: "refuse", ResponseID: "CANNOT_ACT_ON_SARATHI", ScreenID: "SCR_SLOT_FINDER"}
	case legalRe.MatchString(text):
		return Intent{Kind: "refuse", ResponseID: "UNKNOWN_WHO_DECIDES"}
	case familyRe.MatchString(text):
		// "Mere papa 52 saal ke hain…": someone else's licence is the family helper, never the
		// caller's own plan (and the age is never written into FLD_DOB).
		return Intent{Kind: "navigate", ScreenID: "SCR_FAMILY_HELPER"}
	}
	if s := Lookup(text); len(s) > 0 {
		return Intent{Kind: "navigate", ScreenID: s[0]}
	}
	return Intent{Kind: "none"}
}

// Lookup returns screens whose synonyms occur in the query, longest synonym first (the
// lookup_screen tool and the text fallback).
func Lookup(query string) []string {
	q := strings.ToLower(query)
	type hit struct {
		id string
		n  int
	}
	var hits []hit
	for _, s := range Screens {
		best := 0
		for _, syn := range s.Syn {
			if strings.Contains(q, syn) && len(syn) > best {
				best = len(syn)
			}
		}
		if best > 0 {
			hits = append(hits, hit{s.ID, best})
		}
	}
	for i := 1; i < len(hits); i++ {
		for j := i; j > 0 && hits[j].n > hits[j-1].n; j-- {
			hits[j], hits[j-1] = hits[j-1], hits[j]
		}
	}
	out := make([]string, 0, len(hits))
	for _, h := range hits {
		out = append(out, h.id)
	}
	return out
}
