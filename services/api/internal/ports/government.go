package ports

import (
	"context"
	"time"
)

// ---- Sarathi (F-07, API-16, EC-11, D-07) ----------------------------------------------------

// HandoffRequest asks for the Sarathi hand-off pack for one step of a case. It carries only
// non-personal facts: name, relation name and address live in the on-device vault (brief §15).
type HandoffRequest struct {
	CaseRef string   // opaque case id (cas_...)
	Step    string   // ll_application | dl_application | slot_booking | fee_payment
	State   string   // tenant / state code, e.g. JK
	Classes []string // vehicle class codes
	Office  string   // office code, e.g. JK02 (optional)
}

// HandoffField is one copy-pack field. Value is set only for non-personal values; personal
// values are referenced by VaultKey and filled on the device.
type HandoffField struct {
	LabelKey string
	VaultKey string
	Value    string
	Copyable bool
}

// HandoffStep is one screen of the Sarathi sequence.
type HandoffStep struct {
	Order         int
	ScreenHintKey string
	NoteKey       string
	Fields        []HandoffField
}

// HandoffPack is the Mode A hand-off: a deep link plus an ordered copy-pack template.
type HandoffPack struct {
	CaseRef           string
	Step              string
	Mode              string // A | B
	Adapter           string // mock | deeplink | nic
	Simulated         bool
	TargetURL         string
	ProhibitedNoteKey string
	Steps             []HandoffStep
	ExpiresAt         time.Time
}

// ApplicationStatus is a Sarathi application's status mapped to the Margdarshak vocabulary.
type ApplicationStatus struct {
	AppRef     string
	Stage      string // S2 | S3 | S4 | S5 | S6 | S6F | S7 | unknown
	StatusCode string // the upstream's own status text, unmodified ("" in deeplink mode)
	Payment    string // none | pending | confirmed
	AsOf       time.Time
	Simulated  bool
}

// SarathiPort is the Sarathi adapter (mock | deeplink | nic). It never submits anything on the
// user's behalf in Mode A, and never scrapes (D-08).
type SarathiPort interface {
	Mode() string
	// BuildHandoff errors: invalid (unknown step), unavailable (outage, mock only).
	BuildHandoff(ctx context.Context, req HandoffRequest) (HandoffPack, error)
	// ApplicationStatus errors: not_found, unavailable, timeout, unsupported (deeplink mode
	// returns Stage "unknown" without error).
	ApplicationStatus(ctx context.Context, appRef string) (ApplicationStatus, error)
	Health(ctx context.Context) Health
}

// ---- DigiLocker (F-14, MD-038, E-15) ---------------------------------------------------------

// ConsentRequest starts an OAuth 2.0 authorization-code flow with PKCE (S256 required).
type ConsentRequest struct {
	Purpose       string   // shown on the consent screen
	Doctypes      []string // DRVLC only in Margdarshak
	State         string   // CSRF state, opaque
	CodeChallenge string   // base64url(SHA-256(verifier))
	Method        string   // must be S256
	RedirectURI   string
}

// AuthRedirect is where the user goes to consent.
type AuthRedirect struct {
	URL       string
	Simulated bool
}

// TokenSet is the result of the code exchange. The access token is short-lived and is revoked
// after the pull; it is never stored.
type TokenSet struct {
	AccessToken      string
	ExpiresIn        time.Duration
	ConsentValidTill time.Time
	Scope            string
}

// DocumentRef is an issued document pointer.
type DocumentRef struct {
	Doctype string
	URI     string // issuer-namespaced URI; the document body is never stored
	Issuer  string
}

// LicenceFacts is the data-minimised mirror of an issued DL (E-05): classes and validity, the
// last 4 characters and an HMAC of the number. The full number is discarded by the adapter.
type LicenceFacts struct {
	Classes             []string
	IssuedOn            time.Time
	ValidToNonTransport time.Time
	ValidToTransport    *time.Time
	NumberLast4         string
	NumberHash          []byte
	Source              string // digilocker
	Simulated           bool
}

// DigiLockerPort is the DigiLocker requester adapter (mock | negd).
type DigiLockerPort interface {
	Mode() string
	// StartConsent errors: invalid (missing S256 challenge, unknown doctype).
	StartConsent(ctx context.Context, req ConsentRequest) (AuthRedirect, error)
	// ExchangeCode errors: invalid (unknown/used code, PKCE verifier mismatch), timeout, unavailable.
	ExchangeCode(ctx context.Context, code, verifier, redirectURI string) (TokenSet, error)
	// ListIssued errors: invalid (expired token).
	ListIssued(ctx context.Context, token string) ([]DocumentRef, error)
	// PullLicence errors: invalid (expired token), not_found (no DL issued).
	PullLicence(ctx context.Context, token string) (LicenceFacts, error)
	// Revoke is idempotent.
	Revoke(ctx context.Context, token string) error
	Health(ctx context.Context) Health
}

// ---- Aadhaar offline (D-07, EC-01/02/03; mock-only in Margdarshak) ---------------------------

// OfflineArtefact is a Secure QR payload or Paperless XML ZIP, processed in memory only.
type OfflineArtefact struct {
	Kind          string // secure_qr | paperless_xml_zip
	Payload       []byte
	SharePhrase   string // ZIP share phrase (XML only), used in memory, never stored or logged
	ExpectedState string // residence state to compare the address state with (EC-02)
}

// OfflineVerdict holds only derived facts. There is deliberately no field that could hold an
// Aadhaar number, a name, an address or a photo.
type OfflineVerdict struct {
	SignatureValid      bool
	AgeBand             string // canonical age band
	DOBPrecision        string // day | year_only (EC-01)
	AddressStateMatches bool   // EC-02
	AddressDistrict     string // district name only, for the migrant case
	RelationLinePresent bool   // EC-03 "S/o / D/o" line present
	ReferenceHash       string // salted hash of the reference id
	Simulated           bool
	RetainedFields      []string
}

// AadhaarOfflinePort verifies offline artefacts (mock | state_service | disabled).
type AadhaarOfflinePort interface {
	Mode() string
	// Verify errors: prohibited (any 12-digit run in the payload or phrase), invalid (bad or
	// missing signature: fails closed), unsupported (disabled).
	Verify(ctx context.Context, a OfflineArtefact) (OfflineVerdict, error)
	Health(ctx context.Context) Health
}

// ---- Bhashini (F-50, F-30) -------------------------------------------------------------------

// Transcript is ASR output.
type Transcript struct {
	Text      string
	Language  string
	Processor string // disclosed processor, e.g. "bhashini-mock", "sarvam-saaras"
}

// Speech is TTS output.
type Speech struct {
	Audio     []byte
	MimeType  string
	Language  string
	Processor string
}

// BhashiniPort covers ASR, translation and TTS (mock | dhruva | local_indictrans2). Text sent
// to any processor is PII-redacted first (EC-20). Implementations behind the same port: the
// Bhashini ULCA pipelines, a local IndicTrans2 model, and Sarvam (Saaras STT, Bulbul TTS) as a
// disclosed processor.
type BhashiniPort interface {
	Mode() string
	// Translate errors: unsupported (language pair), timeout, unavailable.
	Translate(ctx context.Context, text, src, tgt string) (string, error)
	// ASR errors: unsupported (language), invalid (empty audio), timeout.
	ASR(ctx context.Context, audio []byte, lang string) (Transcript, error)
	// TTS errors: unsupported (e.g. Dogri TTS), timeout.
	TTS(ctx context.Context, text, lang string) (Speech, error)
	Health(ctx context.Context) Health
}

// ---- Payment (EC-09, D-07: Margdarshak never collects government fees) ----------------------

// PaymentRequest asks the adapter where to send the user to pay. The amount always comes from
// a FeeQuote computed from the rule pack (integer paise).
type PaymentRequest struct {
	IntentRef   string // pay_...
	AmountPaise int
	ReturnURL   string
	CallbackURL string
}

// PaymentRedirect is the hand-off to the gateway (or to Sarathi's own fee page).
type PaymentRedirect struct {
	URL         string
	CollectedBy string // always "state_gateway"
	Simulated   bool
}

// PaymentCallback is a verified status callback.
type PaymentCallback struct {
	IntentRef     string
	Status        string // success | pending | failed
	ReceiptNumber string
	At            time.Time
}

// PaymentPort is the payment adapter (mock | sarathi_redirect | state_gateway).
type PaymentPort interface {
	Mode() string
	// StartPayment errors: invalid (amount <= 0).
	StartPayment(ctx context.Context, req PaymentRequest) (PaymentRedirect, error)
	// VerifyCallback checks the signature, timestamp window and replay cache, then parses the
	// body. Errors: invalid (unsigned, tampered, stale, replayed), unsupported (no callbacks).
	VerifyCallback(ctx context.Context, signature string, body []byte) (PaymentCallback, error)
	Health(ctx context.Context) Health
}

// ---- Slots (F-10, E-09, E-10, D-08: read-only, no booking) ----------------------------------

// Office is E-09.
type Office struct {
	ID         string // off_...
	Kind       string // rto | arto | adtc | csc | adtt
	Code       string
	Name       string
	District   string
	State      string
	Lat, Lng   float64
	Tracks     []string
	TestMode   string
	SampleData bool
}

// Slot is E-10. Simulated is true for every mock slot.
type Slot struct {
	ID           string
	OfficeID     string
	Kind         string // ll_test | dl_test
	Date         time.Time
	Window       string
	CapacityBand string // none | few | some | many | unknown
	Source       string // mock | crowd_reported | adapter
	Simulated    bool
}

// SlotPort reads offices and slot availability (mock | crowd | nic). There is no booking
// method: booking stays on Sarathi.
type SlotPort interface {
	Mode() string
	// ListOffices errors: unavailable.
	ListOffices(ctx context.Context, state, kind string) ([]Office, error)
	// ListSlots errors: not_found (office), invalid (range > 31 days or to < from), unavailable.
	ListSlots(ctx context.Context, officeID, kind string, from, to time.Time) ([]Slot, error)
	Health(ctx context.Context) Health
}

// ---- Sarathi Mode B (MD-116; government-hosted, only against the mock in this build) ---------

// PrefillRequest is the non-personal prefill pushed to the state system in Mode B. Personal
// details are captured by the state system itself (eKYC / DigiLocker on its side).
type PrefillRequest struct {
	CaseRef string
	State   string
	Classes []string // Sarathi class codes
	Office  string
}

// PrefillReceipt is the state system's application reference for the prefill.
type PrefillReceipt struct {
	AppRef    string
	Simulated bool
}

// SarathiPrefill is implemented by Sarathi adapters that support Mode B (a state that adopts
// Margdarshak). Callers check for it with a type assertion; Mode A adapters do not implement it.
type SarathiPrefill interface {
	// PushPrefill errors: unavailable, timeout, invalid.
	PushPrefill(ctx context.Context, req PrefillRequest) (PrefillReceipt, error)
}
