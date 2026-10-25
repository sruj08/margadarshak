// Package voiceguide is the VoiceGuideAgent (F-30, M-01, VOICE.md): voice and text navigation
// and field-fill inside Margdarshak only. The agent acts through a closed set of tools over the
// screen and field catalogues below; no tool can submit, pay or book on Sarathi. A deterministic
// router refuses banned intents and identity numbers before any model sees the turn, and is the
// whole text fallback when AI is off (EC-29).
package voiceguide

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// Screen is one ScreenId (VOICE.md §4.1).
type Screen struct {
	ID      string
	Wired   bool // Phase 1-2 builds 8 screens; the rest answer NOT_IN_BUILD
	Confirm bool // a big jump: the agent asks before opening
	Route   string
	Syn     []string
}

// Screens is the closed screen catalogue. Synonyms are lower-case; Dogri ones are drafts
// pending native review.
var Screens = []Screen{
	{"SCR_HOME", true, false, "/", []string{"घर पे चलो", "होम", "home", "शुरू से", "start"}},
	{"SCR_PLAN", true, false, "/plan", []string{"लाइसेंस बनवाना", "licence chahiye", "license chahiye", "licence banwana", "लाइसेंस चाहिए", "मिगी लाइसेंस", "लाइसेंस बनाना", "get a licence", "need a licence", "plan"}},
	{"SCR_PLAN_RESULT", true, false, "/plan/card", []string{"फीस", "fees", "fee kitni", "kaun se kagaz", "कागज़", "कागज", "documents", "what documents"}},
	{"SCR_CLASS_PLANNER", false, false, "/plan/classes", []string{"dono ek saath", "दोनों का एक साथ", "bike aur car", "both together"}},
	{"SCR_BLOCKERS", false, false, "/plan/blockers", []string{"कोई दिक्कत", "address alag", "पता अलग"}},
	{"SCR_LL_APPLY", true, true, "/apply", []string{"ll का फ़ॉर्म", "ll का फॉर्म", "learner apply", "फ़ॉर्म भरना", "form bharna", "apply for learner"}},
	{"SCR_PHOTO_FIXER", false, false, "/apply/photo", []string{"फोटो ठीक", "photo reject", "photo fix"}},
	{"SCR_CHECK_ANSWERS", false, false, "/apply/check", []string{"चेक कर लो", "review my form"}},
	{"SCR_HANDOFF_SARATHI", true, true, "/apply/handoff", []string{"sarathi pe kya", "sarathi पे क्या", "payment kaise", "भुगतान कैसे", "how to pay"}},
	{"SCR_TRACKER", true, false, "/licence", []string{"केस कहाँ", "status", "kahan atka", "कहाँ तक पहुँचा", "my case"}},
	{"SCR_CASE_CLOCK", false, false, "/clock", []string{"कब ख़त्म", "कब खत्म", "kitne din bache", "खत्म होना", "expire"}},
	{"SCR_LEARN_HUB", false, false, "/learn", []string{"पढ़ाई", "signs seekhne", "learn"}},
	{"SCR_LL_SIMULATOR", true, true, "/learn/practise/ll-sim", []string{"मॉक टेस्ट", "mock test", "practice test", "प्रैक्टिस टेस्ट"}},
	{"SCR_READINESS", false, false, "/learn/readiness", []string{"तैयार हूँ", "readiness"}},
	{"SCR_NAZAR", true, true, "/learn/practise/nazar", []string{"नज़र", "नजर", "nazar", "hazard wala", "खतरा पहचानने"}},
	{"SCR_GAMES", false, false, "/learn/practise", []string{"games", "खेल"}},
	{"SCR_SLOT_FINDER", false, true, "/slots", []string{"स्लॉट", "slot", "test ki date", "टेस्ट की तारीख", "टेस्ट दी तरीक"}},
	{"SCR_RTO_INTEL", false, true, "/rto", []string{"rto में कितनी भीड़", "rto mein", "भीड़", "sunday ko test"}},
	{"SCR_TRACK_EXPLAINER", false, false, "/track", []string{"8 वाला ट्रैक", "figure eight", "reverse parking"}},
	{"SCR_TEST_DAY", false, false, "/test-day", []string{"क्या ले जाऊँ", "test day"}},
	{"SCR_FAIL_RECOVER", false, true, "/retest", []string{"फेल हो गया", "fail ho gaya", "retest"}},
	{"SCR_APPROVAL_TRACKER", false, false, "/licence", []string{"approval kab", "कार्ड कब आएगा"}},
	{"SCR_NEW_RIDER", false, false, "/services/new-rider", []string{"नई बाइक", "new rider"}},
	{"SCR_RENEW_FIX", false, true, "/services/renew", []string{"renew", "पता बदलना"}},
	{"SCR_FAMILY_HELPER", false, true, "/services/family", []string{"पापा का लाइसेंस", "papa", "mummy", "माँ का", "family"}},
	{"SCR_PRIVACY", false, false, "/privacy", []string{"डेटा मिटाओ", "privacy"}},
	{"SCR_SCAM_CHECK", false, false, "/services/scam-check", []string{"मैसेज असली", "challan ka message", "scam"}},
	{"SCR_DECODER", false, false, "/services/decode", []string{"स्क्रीनशॉट समझाओ", "ye status kya hai", "screenshot"}},
	{"SCR_PRACTICE_RECORD", false, false, "/learn/me", []string{"प्रैक्टिस रिकॉर्ड", "practice record"}},
	{"SCR_LANGUAGE", false, false, "/language", []string{"भाषा बदलो", "english mein", "change language"}},
}

var screenByID = func() map[string]*Screen {
	m := map[string]*Screen{}
	for i := range Screens {
		m[Screens[i].ID] = &Screens[i]
	}
	return m
}()

// ScreenByID returns a screen or nil.
func ScreenByID(id string) *Screen { return screenByID[id] }

// Field is one FieldId (VOICE.md §4.2) with its validator. Identity numbers are not in the enum.
type Field struct {
	ID       string
	Wired    bool
	Validate func(string) (string, bool)
}

var (
	latinName   = regexp.MustCompile(`^[A-Za-z][A-Za-z .]{1,59}$`)
	devaName    = regexp.MustCompile(`^[\p{Devanagari} ]{2,60}$`)
	dateRe      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	pinRe       = regexp.MustCompile(`^[1-8]\d{5}$`)
	rtoRe       = regexp.MustCompile(`^[A-Z]{2}-?\d{2}$`)
	longDigitRe = regexp.MustCompile(`\d{10,}`)
)

func oneOf(vals ...string) func(string) (string, bool) {
	return func(s string) (string, bool) {
		s = strings.ToLower(strings.TrimSpace(s))
		for _, v := range vals {
			if s == strings.ToLower(v) {
				return v, true
			}
		}
		return "", false
	}
}

func match(re *regexp.Regexp) func(string) (string, bool) {
	return func(s string) (string, bool) {
		s = strings.TrimSpace(s)
		return s, re.MatchString(s)
	}
}

// Fields is the closed field catalogue.
var Fields = map[string]Field{
	"FLD_FULL_NAME_LATIN":      {"FLD_FULL_NAME_LATIN", true, match(latinName)},
	"FLD_FULL_NAME_DEVANAGARI": {"FLD_FULL_NAME_DEVANAGARI", true, match(devaName)},
	"FLD_RELATION_TYPE":        {"FLD_RELATION_TYPE", false, oneOf("S/o", "D/o", "W/o", "C/o")},
	"FLD_RELATION_NAME":        {"FLD_RELATION_NAME", false, match(latinName)},
	"FLD_DOB":                  {"FLD_DOB", true, match(dateRe)},
	"FLD_GENDER":               {"FLD_GENDER", false, oneOf("female", "male", "transgender", "prefer_not_to_say")},
	"FLD_ADDR_LINE": {"FLD_ADDR_LINE", true, func(s string) (string, bool) {
		s = strings.TrimSpace(s)
		n := utf8.RuneCountInString(s)
		return s, n >= 5 && n <= 120 && !longDigitRe.MatchString(s)
	}},
	"FLD_ADDR_DISTRICT":        {"FLD_ADDR_DISTRICT", true, match(regexp.MustCompile(`^[\p{L} ]{2,40}$`))},
	"FLD_ADDR_PIN":             {"FLD_ADDR_PIN", true, match(pinRe)},
	"FLD_STATE":                {"FLD_STATE", true, match(regexp.MustCompile(`^[A-Z]{2}$`))},
	"FLD_RTO_CODE":             {"FLD_RTO_CODE", true, match(rtoRe)},
	"FLD_VEHICLE_KIND":         {"FLD_VEHICLE_KIND", true, oneOf("scooter_gearless", "motorcycle_geared", "moped_le50cc", "car", "e_rickshaw")},
	"FLD_CLASSES":              {"FLD_CLASSES", true, match(regexp.MustCompile(`^(MC50CC|MCWOG|MCWG|LMV-NT|E-RICKSHAW)(,(MC50CC|MCWOG|MCWG|LMV-NT|E-RICKSHAW)){0,3}$`))},
	"FLD_HAS_LL":               {"FLD_HAS_LL", false, oneOf("true", "false")},
	"FLD_LL_ISSUE_DATE":        {"FLD_LL_ISSUE_DATE", false, match(dateRe)},
	"FLD_AADHAAR_ADDR_MATCHES": {"FLD_AADHAAR_ADDR_MATCHES", false, oneOf("true", "false")},
	"FLD_TEST_DATE":            {"FLD_TEST_DATE", false, match(dateRe)},
	"FLD_LANGUAGE":             {"FLD_LANGUAGE", false, oneOf("en", "hi", "doi", "pa", "mr", "gu", "ta")},
}

// Canned replies (VOICE.md §2.4, §4.3). Fixed copy, never model text.
var Canned = map[string]map[string]string{
	"CANNOT_ACT_ON_SARATHI": {
		"hi": "मैं Sarathi पर जमा, भुगतान या बुकिंग नहीं कर सकता। मैं आपको वो पेज दिखा सकता हूँ जहाँ से आप खुद कर सकते हैं।",
		"en": "I can't submit, pay or book on Sarathi. I can show you the page where you can do it yourself."},
	"NO_AGENTS_NO_SETTING": {
		"hi": "Margdarshak किसी एजेंट या 'सेटिंग' के साथ काम नहीं करता। ऐसे मैसेज की जाँच यहाँ करें।",
		"en": "Margdarshak does not work with agents or 'settings'. You can check such a message here."},
	"UNKNOWN_WHO_DECIDES": {
		"hi": "यह हमें अभी पक्का नहीं पता। यह RTO तय करता है।",
		"en": "We don't know this for sure yet. The RTO decides this."},
	"CALL_112": {
		"hi": "तुरंत 112 पर कॉल करें।",
		"en": "Call 112 right away."},
	"PULL_OVER": {
		"hi": "पहले गाड़ी रोकिए, फिर बात करते हैं।",
		"en": "Please stop the vehicle first, then we can talk."},
	"NOT_IN_BUILD": {
		"hi": "यह हिस्सा अभी बन रहा है। मैं आपको सबसे पास वाला पेज दिखाता हूँ।",
		"en": "This part is still being built. I'll show you the nearest page."},
	"NOT_UNDERSTOOD": {
		"hi": "मैं समझ नहीं पाया। चलिए लिखकर ढूँढते हैं।",
		"en": "I didn't catch that. Let's find it by typing."},
	"OPENING": {
		"hi": "यह पेज खोल रहा हूँ।",
		"en": "Opening that page."},
	"CONFIRM_OPEN": {
		"hi": "यह पेज खोल रहा हूँ, ठीक है?",
		"en": "I'll open this page. OK?"},
	"NUMBER_ON_SCREEN": {
		"hi": "सही जानकारी स्क्रीन पर दिख रही है।",
		"en": "The exact details are on the screen."},
}

// dogriReviewed holds the native-reviewed Dogri captions by response ID (VOICE.md §3.3). A reply
// without a reviewed string is captioned in Hindi; free model Dogri is never shown.
// shortcut: empty until the Dogri reviewer signs off the drafts; add rows only after review.
var dogriReviewed = map[string]string{}

// Text returns a canned line in the locale (Dogri/Marathi fall back to Hindi if not directly present; others to English).
func Text(id, locale string) string {
	if locale == "doi" {
		if s, ok := dogriReviewed[id]; ok {
			return s
		}
		locale = "hi"
	}
	if s, ok := Canned[id][locale]; ok && s != "" {
		return s
	}
	if locale == "mr" {
		if s, ok := Canned[id]["hi"]; ok {
			return s
		}
	}
	if locale != "hi" {
		locale = "en"
	}
	return Canned[id][locale]
}
