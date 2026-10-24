package privacy

import "errors"

// Purposes are the DEPA-style consent purposes (api/openapi.yaml ConsentPurpose, E-15).
// parental_consent is the adult account holder's verifiable parental consent for a minor
// family member (DPDP Act 2023 s.9 / Rules 2025 r.10).
var Purposes = []string{
	"ai_coach", "ai_voice", "whatsapp_updates", "email_updates", "web_push", "analytics", "field_study",
	"helper_link", "digilocker_pull", "aadhaar_offline_check", "school_share", "parent_card", "clip_contribution",
	"parental_consent",
}

// ValidPurpose reports whether p is a known purpose.
func ValidPurpose(p string) bool {
	for _, x := range Purposes {
		if x == p {
			return true
		}
	}
	return false
}

// ErrParentalConsentRequired is returned when a minor family member's case or profile is used
// before the account holder has recorded parental consent (403 PARENT_CONSENT_REQUIRED).
var ErrParentalConsentRequired = errors.New("privacy: parental consent required for a minor family member")

// Subject describes whose data a request touches: the adult account holder or a family member
// inside the account (family mode).
type Subject struct {
	IsMinor               bool
	ParentalConsentStatus string // not_required | required | granted | revoked
}

// RequireParentalConsent is the only age-related check in Margdarshak (D-13 revised): AI and
// every other feature are available to everyone, but a minor's case lives in a parent's account
// and needs the parent's recorded consent.
func RequireParentalConsent(s Subject) error {
	if s.IsMinor && s.ParentalConsentStatus != "granted" {
		return ErrParentalConsentRequired
	}
	return nil
}

// AIAvailable is always true: AI is for everyone (D-13 revised, 23 Oct 2026). It exists so that
// callers state the policy explicitly instead of inventing an age gate.
func AIAvailable(Subject) bool { return true }

// AllowsBehaviouralTracking reports whether behavioural analytics or targeted messaging may use
// the subject's data: never for a child's data (DPDP s.9(3)); adults need the analytics purpose.
func AllowsBehaviouralTracking(s Subject, analyticsConsent bool) bool {
	return !s.IsMinor && analyticsConsent
}

// PurposeInfo is the catalogue entry of a purpose (PRIVACY §4.2, MD-133): the data categories an
// artefact for the purpose covers and the processor or recipient it names.
type PurposeInfo struct {
	DataCategories []string
	Recipient      string
	// Dependent processing that stops when the purpose is withdrawn (one request, MD-133).
	Stops string
}

// Catalogue lists every purpose used by the product.
var Catalogue = map[string]PurposeInfo{
	"whatsapp_updates":      {[]string{"phone", "case_milestones", "plan_summary"}, "Meta WhatsApp Cloud API via n8n (processor)", "WhatsApp reminders and plan cards"},
	"email_updates":         {[]string{"email", "case_milestones"}, "Transactional e-mail provider (processor)", "e-mail reminders and fallbacks"},
	"web_push":              {[]string{"push_subscription", "case_milestones"}, "Browser push service", "web push reminders"},
	"analytics":             {[]string{"usage_events_pseudonymous"}, "Margdarshak (aggregates only, k >= 5)", "analytics events (API-63)"},
	"field_study":           {[]string{"trial_timings", "sus_score", "participant_code"}, "Margdarshak study owner", "lab trial logs (API-70)"},
	"ai_coach":              {[]string{"game_findings_ids", "topic_ids", "language"}, "Google LLC (Gemini API, paid tier)", "AI narration (P3)"},
	"ai_voice":              {[]string{"voice_audio_transient", "transcript"}, "Google LLC (Gemini Live); Sarvam (Dogri ASR)", "voice guide (P3)"},
	"helper_link":           {[]string{"case_draft"}, "The named helper", "helper access"},
	"digilocker_pull":       {[]string{"dl_classes", "dl_validity", "dl_number_last4"}, "DigiLocker (requester)", "DigiLocker pulls"},
	"aadhaar_offline_check": {[]string{"age_band", "address_state_match"}, "Margdarshak (in memory only)", "offline Aadhaar check"},
	"school_share":          {[]string{"practice_record", "progress"}, "The named school", "school sharing"},
	"parent_card":           {[]string{"progress_summary"}, "The account holder", "family cards"},
	"clip_contribution":     {[]string{"dashcam_clip_blurred"}, "Margdarshak clip bank (CC-BY)", "clip ingest"},
	"parental_consent":      {[]string{"learner_case", "learning_progress", "game_sessions", "ai_coaching"}, "The account holder (guardian)", "a minor family member's case"},
}
