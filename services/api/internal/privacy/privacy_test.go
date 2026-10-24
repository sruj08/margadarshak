package privacy_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// aadhaarLike returns a synthetic 12-digit number with a valid Verhoeff check digit. Test
// fixture only (no real-looking Aadhaar fixtures in seeds or docs).
func aadhaarLike(prefix11 string) string {
	return prefix11 + string(privacy.VerhoeffCheckDigit(prefix11))
}

func toDevanagari(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune('०' + (r - '0'))
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func TestVerhoeffKnownVectors(t *testing.T) {
	// Classic Verhoeff vector: 236 -> check digit 3.
	if got := privacy.VerhoeffCheckDigit("236"); got != '3' {
		t.Fatalf("check digit of 236 = %c, want 3", got)
	}
	if !privacy.VerhoeffValid("2363") || privacy.VerhoeffValid("2364") {
		t.Fatal("Verhoeff validation wrong on 2363/2364")
	}
	n := aadhaarLike("23456789012")
	if !privacy.VerhoeffValid(n) {
		t.Fatal("generated number must validate")
	}
	b := []byte(n)
	b[5] = '0' + (b[5]-'0'+1)%10
	if privacy.VerhoeffValid(string(b)) {
		t.Fatal("single-digit substitution not detected")
	}
}

func TestRedactAadhaar(t *testing.T) {
	n := aadhaarLike("23456789012")
	cases := []string{
		"my aadhaar is " + n,
		"my aadhaar is " + n[:4] + " " + n[4:8] + " " + n[8:],
		"मेरा आधार " + n[:4] + "-" + n[4:8] + "-" + n[8:],
		"age 19 " + n[:4] + " " + n[4:8] + " " + n[8:], // merged with an age in one digit run
	}
	for _, in := range cases {
		out, kinds := privacy.Redact(in)
		if strings.Contains(strings.NewReplacer(" ", "", "-", "").Replace(out), n) {
			t.Fatalf("Aadhaar survived: %q -> %q", in, out)
		}
		if len(kinds) == 0 || kinds[len(kinds)-1] != privacy.KindAadhaar {
			t.Fatalf("kinds %v for %q", kinds, in)
		}
	}
}

func TestRedactDevanagariDigits(t *testing.T) {
	n := aadhaarLike("98765432101")
	dev := toDevanagari(n)
	out, kinds := privacy.Redact("आधार " + dev)
	if strings.Contains(out, n) || strings.Contains(out, dev) || len(kinds) != 1 {
		t.Fatalf("Devanagari Aadhaar survived: %q %v", out, kinds)
	}
	// "aapka OTP" in Hindi with Devanagari digits.
	out, kinds = privacy.Redact("आपका ओटीपी " + toDevanagari("482913"))
	if strings.Contains(out, "482913") || len(kinds) != 1 || kinds[0] != privacy.KindOTP {
		t.Fatalf("Hindi OTP survived: %q %v", out, kinds)
	}
}

func TestRedactNonVerhoeffTwelveDigitsIsKept(t *testing.T) {
	b := []byte(aadhaarLike("23456789012"))
	b[11] = '0' + (b[11]-'0'+1)%10 // break the check digit
	out, _ := privacy.Redact("order " + string(b))
	if !strings.Contains(out, string(b)) {
		t.Fatalf("random 12-digit number should not be masked: %q", out)
	}
}

func TestRedactOTPPhrasing(t *testing.T) {
	for _, in := range []string{"OTP is 482913", "your one time code: 4829", "पासवर्ड 99887766", "code 123456 for login"} {
		out, kinds := privacy.Redact(in)
		if len(kinds) == 0 || kinds[0] != privacy.KindOTP {
			t.Fatalf("OTP not found in %q -> %q", in, out)
		}
	}
	if _, kinds := privacy.Redact("I scored 4829 points"); len(kinds) != 0 {
		t.Fatalf("number without an OTP keyword must stay: %v", kinds)
	}
}

func TestRedactVIDNeedsKeyword(t *testing.T) {
	vid := "9123456789012345"
	if out, kinds := privacy.Redact("my VID " + vid); len(kinds) != 1 || kinds[0] != privacy.KindVID || strings.Contains(out, vid) {
		t.Fatalf("VID: %q %v", out, kinds)
	}
}

func TestRedactPhoneEmailPAN(t *testing.T) {
	in := "call +91 98765 43210 or mail kabir@example.com, PAN ABCPE1234F"
	out, kinds := privacy.Redact(in)
	for _, leak := range []string{"98765", "43210", "kabir@example.com", "ABCPE1234F"} {
		if strings.Contains(out, leak) {
			t.Fatalf("%s survived: %q", leak, out)
		}
	}
	if len(kinds) != 3 {
		t.Fatalf("kinds %v", kinds)
	}
}

func TestRedactMaskedAadhaarIsStripped(t *testing.T) {
	out, kinds := privacy.Redact("UIDAI shows XXXX XXXX 1234")
	if strings.Contains(out, "1234") || len(kinds) != 1 || kinds[0] != privacy.KindMaskedAadhaar {
		t.Fatalf("%q %v", out, kinds)
	}
}

// EC-20: a user types an Aadhaar number or OTP: the inbound scan flags it with a JSON pointer.
func TestEC20ScanJSONFindsProhibitedValuesAndKeys(t *testing.T) {
	n := aadhaarLike("34567890123")
	cases := map[string]string{
		`{"message": "my aadhaar ` + n + `"}`:                "/message",
		`{"answers": {"blood_group": "B+", "x": ` + n + `}}`: "/answers/x",
		`{"items": ["ok", "OTP 482913"]}`:                    "/items/1",
		`{"answers": {"aadhaar_number": "n/a"}}`:             "/answers/aadhaar_number",
		`{"otp": "x"}`:                                       "/otp",
	}
	for body, ptr := range cases {
		v, err := privacy.ScanJSON([]byte(body))
		if err != nil {
			t.Fatal(err)
		}
		if v == nil || v.Pointer != ptr {
			t.Fatalf("%s: got %+v, want pointer %s", body, v, ptr)
		}
	}
	v, err := privacy.ScanJSON([]byte(`{"language": "hi", "district": "Kathua", "provider": "x", "video": true}`))
	if err != nil || v != nil {
		t.Fatalf("clean body flagged: %+v %v", v, err)
	}
}

func TestEC20HasTwelveDigitRun(t *testing.T) {
	if !privacy.HasTwelveDigitRun("ref 1234-5678-9012") || privacy.HasTwelveDigitRun("ref 12345678901") {
		t.Fatal("12-digit run detection wrong")
	}
}

func TestVaultRoundTripAndBinding(t *testing.T) {
	v, err := privacy.NewVault(bytes.Repeat([]byte{7}, 32), bytes.Repeat([]byte{9}, 32))
	if err != nil {
		t.Fatal(err)
	}
	env, err := v.EncryptString("JK", "contacts.value", "kabir@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(env, []byte("kabir")) {
		t.Fatal("plaintext visible in envelope")
	}
	got, err := v.DecryptString("JK", "contacts.value", env)
	if err != nil || got != "kabir@example.com" {
		t.Fatalf("%q %v", got, err)
	}
	if _, err := v.DecryptString("KL", "contacts.value", env); err == nil {
		t.Fatal("ciphertext must be bound to its tenant")
	}
	if _, err := v.DecryptString("JK", "applicants.dob", env); err == nil {
		t.Fatal("ciphertext must be bound to its column")
	}
	if !bytes.Equal(v.BlindIndex("JK", "email", " Kabir@Example.com "), v.BlindIndex("JK", "email", "kabir@example.com")) {
		t.Fatal("blind index must normalise")
	}
	if bytes.Equal(v.BlindIndex("JK", "email", "a@b.in"), v.BlindIndex("KL", "email", "a@b.in")) {
		t.Fatal("blind index must be tenant-scoped")
	}
}

// Family mode (D-13 revised): AI is for everyone; a minor family member needs parental consent.
func TestFamilyModeMinorNeedsParentalConsent(t *testing.T) {
	minor := privacy.Subject{IsMinor: true, ParentalConsentStatus: "required"}
	if err := privacy.RequireParentalConsent(minor); err != privacy.ErrParentalConsentRequired {
		t.Fatalf("minor without consent: %v", err)
	}
	minor.ParentalConsentStatus = "granted"
	if err := privacy.RequireParentalConsent(minor); err != nil {
		t.Fatal(err)
	}
	minor.ParentalConsentStatus = "revoked"
	if privacy.RequireParentalConsent(minor) == nil {
		t.Fatal("revoked consent must block")
	}
	if err := privacy.RequireParentalConsent(privacy.Subject{ParentalConsentStatus: "not_required"}); err != nil {
		t.Fatal(err)
	}
}

func TestFamilyModeAIIsForEveryone(t *testing.T) {
	for _, s := range []privacy.Subject{{IsMinor: true, ParentalConsentStatus: "granted"}, {IsMinor: true}, {}} {
		if !privacy.AIAvailable(s) {
			t.Fatalf("AI must be available to %+v", s)
		}
	}
	if privacy.AllowsBehaviouralTracking(privacy.Subject{IsMinor: true, ParentalConsentStatus: "granted"}, true) {
		t.Fatal("no behavioural tracking on a child's data")
	}
	if !privacy.AllowsBehaviouralTracking(privacy.Subject{}, true) || privacy.AllowsBehaviouralTracking(privacy.Subject{}, false) {
		t.Fatal("adults: the analytics consent decides")
	}
}

func TestConsentPurposesIncludeParentalConsent(t *testing.T) {
	if !privacy.ValidPurpose("parental_consent") || !privacy.ValidPurpose("ai_coach") || privacy.ValidPurpose("ai_age_gate") {
		t.Fatal("purpose list wrong")
	}
}

func TestRedactKeepsURLPortsButNotAadhaarInURLs(t *testing.T) {
	out, kinds := privacy.Redact("open http://localhost:3000/auth/magic?code=ml_abc to sign in")
	if !strings.Contains(out, "localhost:3000") || len(kinds) != 0 {
		t.Fatalf("port masked: %q %v", out, kinds)
	}
	n := aadhaarLike("45678901234")
	out, _ = privacy.Redact("http://x.example/p?id=" + n)
	if strings.Contains(out, n) {
		t.Fatalf("Aadhaar in a URL survived: %q", out)
	}
	if out, _ := privacy.Redact("your OTP code: 3000"); strings.Contains(out, "3000") {
		t.Fatalf("OTP outside a URL must still be masked: %q", out)
	}
}
