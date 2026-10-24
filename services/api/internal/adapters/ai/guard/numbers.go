package guard

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// HasDigit reports any decimal digit in any script (Latin, Devanagari, full-width, …): the V4
// "no digits outside placeholders" rule (PROMPTS §5).
func HasDigit(s string) bool {
	return strings.IndexFunc(s, unicode.IsDigit) >= 0
}

var (
	// Number words a narration may not use (PROMPTS §4.1). "एक" and "दो" are left out: they are
	// also the article "a" and the verb "give" ("जगह दो"); the idioms "ek baar"/"एक बार" are fine.
	numberWordEn       = regexp.MustCompile(`(?i)\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|crore|half|double|twice)\b`)
	numberWordHinglish = regexp.MustCompile(`(?i)\b(paanch|saat|aath|das|bees|tees|pachaas|sau|hazaar|hazar|lakh)\b`)
	// "one" inside fixed phrases that carry no quantity.
	numberIdiomEn = regexp.MustCompile(`(?i)\b(one more time|no one|anyone|someone|everyone|one of|the one|this one|that one|each one|one by one|one another)\b`)
)

// Go's \b is ASCII-only, so Devanagari number words are matched as whole tokens.
var numberWordHi = map[string]bool{
	"शून्य": true, "तीन": true, "चार": true, "पाँच": true, "पांच": true, "छह": true, "सात": true, "आठ": true,
	"नौ": true, "दस": true, "बीस": true, "तीस": true, "चालीस": true, "पचास": true, "सौ": true, "हज़ार": true,
	"हजार": true, "लाख": true, "करोड़": true, "आधा": true, "दुगना": true,
}

// NumberWord returns the first number word in s, or "".
func NumberWord(s string) string {
	clean := numberIdiomEn.ReplaceAllString(s, " ")
	if m := numberWordEn.FindString(clean); m != "" {
		return m
	}
	if m := numberWordHinglish.FindString(clean); m != "" {
		return m
	}
	for _, t := range wordTokRe.FindAllString(clean, -1) {
		if numberWordHi[t] {
			return t
		}
	}
	return ""
}

var (
	digitNumRe = regexp.MustCompile(`\d+(?:,\d{2,3})*(?:\.\d+)?`)
	wordTokRe  = regexp.MustCompile(`[\p{L}\p{M}]+`)
)

var enSmall = map[string]float64{
	"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
	"ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
	"seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
	"sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
	"ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "chhe": 6, "saat": 7, "aath": 8, "nau": 9,
	"das": 10, "bees": 20, "tees": 30, "chalis": 40, "pachaas": 50,
	"शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5, "छह": 6, "छः": 6, "सात": 7, "आठ": 8,
	"नौ": 9, "दस": 10, "ग्यारह": 11, "बारह": 12, "पंद्रह": 15, "बीस": 20, "पच्चीस": 25, "तीस": 30, "चालीस": 40,
	"पचास": 50, "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90,
}

var enScale = map[string]float64{
	"hundred": 100, "thousand": 1000, "lakh": 100000, "crore": 10000000,
	"sau": 100, "hazaar": 1000, "hazar": 1000,
	"सौ": 100, "हज़ार": 1000, "हजार": 1000, "लाख": 100000, "करोड़": 10000000,
}

// Units that turn a small number word into a quantity ("दो दिन", "two days", "ek hazaar rupaye").
var quantityUnits = map[string]bool{
	"day": true, "days": true, "din": true, "दिन": true, "week": true, "weeks": true, "हफ़्ते": true, "हफ्ते": true,
	"month": true, "months": true, "महीने": true, "mahine": true, "year": true, "years": true, "साल": true, "saal": true,
	"km": true, "kmh": true, "metres": true, "meters": true, "मीटर": true, "minutes": true, "मिनट": true,
	"seconds": true, "सेकंड": true, "percent": true, "प्रतिशत": true, "rupees": true, "rupee": true, "रुपये": true,
	"रुपए": true, "rupaye": true, "rs": true, "questions": true, "सवाल": true, "marks": true, "अंक": true,
}

// Numbers extracts every number in s: digits in any script (1,500 / ८० / 1.4) and number words in
// English, Hindi and Hinglish. Small words (below ten) count only next to a unit, because "एक"
// and "a"/"one" are also articles; the rest always count.
func Numbers(s string) []float64 {
	n := NormalizeSpoken(s)
	var out []float64
	for _, m := range digitNumRe.FindAllString(n, -1) {
		if v, err := strconv.ParseFloat(strings.ReplaceAll(m, ",", ""), 64); err == nil {
			out = append(out, v)
		}
	}
	toks := wordTokRe.FindAllString(strings.ToLower(n), -1)
	for i := 0; i < len(toks); {
		total, cur, used := 0.0, 0.0, 0
		j := i
		for j < len(toks) {
			if v, ok := enSmall[toks[j]]; ok {
				cur += v
			} else if sc, ok := enScale[toks[j]]; ok {
				if cur == 0 {
					cur = 1
				}
				cur *= sc
				if sc >= 1000 {
					total += cur
					cur = 0
				}
			} else if toks[j] != "and" || used == 0 {
				break
			}
			used++
			j++
		}
		if used == 0 {
			i++
			continue
		}
		v := total + cur
		next := ""
		if j < len(toks) {
			next = toks[j]
		}
		if v >= 10 || quantityUnits[next] || used > 1 {
			out = append(out, v)
		}
		i = j
	}
	return out
}

// Unsupported returns the numbers in text that are not in allowed (P5 provenance: every number a
// model says must come from code). Equality is to four decimal places.
func Unsupported(text string, allowed []float64) []float64 {
	var bad []float64
	for _, v := range Numbers(text) {
		ok := false
		for _, a := range allowed {
			if math.Abs(a-v) < 1e-4 {
				ok = true
				break
			}
		}
		if !ok {
			bad = append(bad, v)
		}
	}
	return bad
}

// MoneyMention reports a currency reference (V8 money row): a fee is never narrated.
func MoneyMention(s string) bool {
	return moneyRe.MatchString(s)
}

var moneyRe = regexp.MustCompile(`(?i)(₹|\brs\.?\s|\brupees?\b|रुपये|रुपए|\binr\b)`)
