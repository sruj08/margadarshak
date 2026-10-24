// Package contracttest is the shared contract suite for every port (MD-036, D-08). The mock and
// any real implementation of a port must pass the same suite; a state's adapter is activated
// only after it passes (INTEGRATIONS §5). Each suite documents the error kinds of each method.
//
// Fault cases (outage, timeout, pending) run only for implementations that implement
// ports.FaultInjector (mocks); real adapters cover them with recorded cassettes.
package contracttest

import (
	"context"
	"errors"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

func wantKind(t *testing.T, err error, kind ports.ErrorKind) {
	t.Helper()
	if err == nil {
		t.Fatalf("want error kind %q, got nil", kind)
	}
	if got := ports.KindOf(err); got != kind {
		t.Fatalf("want error kind %q, got %q (%v)", kind, got, err)
	}
	if !errors.Is(err, &ports.Error{Kind: kind}) {
		t.Fatalf("errors.Is does not match kind %q", kind)
	}
}

func checkHealth(t *testing.T, h ports.Health, mode string) {
	t.Helper()
	switch h.Status {
	case "ok", "degraded", "down":
	default:
		t.Fatalf("health status %q not in ok|degraded|down", h.Status)
	}
	if h.Implementation != mode {
		t.Fatalf("health implementation %q != mode %q", h.Implementation, mode)
	}
}

// noProhibited fails if any string reachable from v carries an Aadhaar number, VID or OTP.
func noProhibited(t *testing.T, v any) {
	t.Helper()
	walkStrings(reflect.ValueOf(v), func(path, s string) {
		if k, ok := privacy.FirstProhibited(s); ok {
			t.Fatalf("%s carries prohibited data (%s)", path, k)
		}
		if privacy.HasTwelveDigitRun(s) {
			t.Fatalf("%s carries a 12-digit number", path)
		}
	}, "$")
}

func walkStrings(v reflect.Value, fn func(path, s string), path string) {
	switch v.Kind() {
	case reflect.String:
		fn(path, v.String())
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if v.Type().Field(i).IsExported() {
				walkStrings(v.Field(i), fn, path+"."+v.Type().Field(i).Name)
			}
		}
	case reflect.Slice, reflect.Array:
		if v.Type().Elem().Kind() == reflect.Uint8 {
			return
		}
		for i := 0; i < v.Len(); i++ {
			walkStrings(v.Index(i), fn, path+"[]")
		}
	case reflect.Map:
		for _, k := range v.MapKeys() {
			walkStrings(v.MapIndex(k), fn, path+"{}")
		}
	case reflect.Pointer, reflect.Interface:
		if !v.IsNil() {
			walkStrings(v.Elem(), fn, path)
		}
	}
}

func inject(impl any, f ports.Fault) (func(), bool) {
	fi, ok := impl.(ports.FaultInjector)
	if !ok {
		return func() {}, false
	}
	fi.InjectFault(f)
	return func() { fi.InjectFault(ports.FaultNone) }, true
}

// ---- Sarathi ---------------------------------------------------------------------------------

// personalVaultKeys must never carry a server-side value (brief §15).
var personalVaultKeys = map[string]bool{
	"applicant_name": true, "relation_type": true, "relation_name": true, "date_of_birth": true,
	"gender": true, "present_address": true, "permanent_address": true, "ll_number": true, "application_number": true,
}

// Sarathi runs the SarathiPort contract.
//
//	BuildHandoff:      invalid (unknown step); unavailable (outage); timeout.
//	ApplicationStatus: not_found (unknown reference) or Stage "unknown" (modes that cannot read);
//	                   unavailable (outage, EC-11); timeout.
func Sarathi(t *testing.T, newImpl func(t *testing.T) ports.SarathiPort) {
	ctx := context.Background()
	req := ports.HandoffRequest{CaseRef: "cas_01JB8ZCQ4TXK2M7N9PRSVWYZAB", Step: "ll_application", State: "JK",
		Classes: []string{"MCWG", "LMV-NT"}, Office: "JK02"}

	t.Run("handoff pack is Mode A, ordered, and points at Sarathi", func(t *testing.T) {
		p, err := newImpl(t).BuildHandoff(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		u, err := url.Parse(p.TargetURL)
		if err != nil || u.Scheme != "https" || u.Host != "sarathi.parivahan.gov.in" {
			t.Fatalf("target_url %q must be https://sarathi.parivahan.gov.in/...", p.TargetURL)
		}
		if p.Mode != "A" || p.CaseRef != req.CaseRef || p.Step != req.Step || len(p.Steps) == 0 {
			t.Fatalf("bad pack header: %+v", p)
		}
		for i, s := range p.Steps {
			if s.Order != i+1 || s.ScreenHintKey == "" {
				t.Fatalf("step %d out of order or unnamed: %+v", i, s)
			}
		}
		if p.ExpiresAt.IsZero() {
			t.Fatal("pack must expire")
		}
	})
	t.Run("copy-pack carries no personal or prohibited values (D-07, brief §15)", func(t *testing.T) {
		p, err := newImpl(t).BuildHandoff(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		noProhibited(t, p)
		sawClasses := false
		for _, s := range p.Steps {
			for _, f := range s.Fields {
				if personalVaultKeys[f.VaultKey] && f.Value != "" {
					t.Fatalf("personal field %s has a server value", f.VaultKey)
				}
				if strings.Contains(f.Value, "MCWG") {
					sawClasses = true
				}
			}
		}
		if !sawClasses {
			t.Fatal("non-personal values (classes) should be prefilled")
		}
	})
	t.Run("unknown step is invalid", func(t *testing.T) {
		_, err := newImpl(t).BuildHandoff(ctx, ports.HandoffRequest{Step: "pay_bribe"})
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("unknown application reference", func(t *testing.T) {
		st, err := newImpl(t).ApplicationStatus(ctx, "NO-SUCH-REF")
		if err != nil {
			wantKind(t, err, ports.KindNotFound)
			return
		}
		if st.Stage != "unknown" {
			t.Fatalf("a mode that cannot find the reference must answer stage unknown, got %q", st.Stage)
		}
	})
	t.Run("outage drives the EC-11 state", func(t *testing.T) {
		impl := newImpl(t)
		reset, ok := inject(impl, ports.FaultOutage)
		if !ok {
			t.Skip("no fault injection (real adapter: covered by cassettes)")
		}
		defer reset()
		_, err := impl.BuildHandoff(ctx, req)
		wantKind(t, err, ports.KindUnavailable)
		_, err = impl.ApplicationStatus(ctx, "ANY")
		wantKind(t, err, ports.KindUnavailable)
		if h := impl.Health(ctx); h.Status != "down" {
			t.Fatalf("health during outage = %q, want down", h.Status)
		}
	})
	t.Run("timeout is reported as timeout", func(t *testing.T) {
		impl := newImpl(t)
		reset, ok := inject(impl, ports.FaultTimeout)
		if !ok {
			t.Skip("no fault injection")
		}
		defer reset()
		c, cancel := context.WithTimeout(ctx, 20*time.Millisecond)
		defer cancel()
		_, err := impl.ApplicationStatus(c, "ANY")
		wantKind(t, err, ports.KindTimeout)
	})
	t.Run("health", func(t *testing.T) {
		impl := newImpl(t)
		checkHealth(t, impl.Health(ctx), impl.Mode())
	})
}

// ---- DigiLocker ------------------------------------------------------------------------------

// Approver plays the citizen on the consent screen: given the authorisation redirect, it returns
// the redirect back to the requester (carrying code and state).
type Approver func(t *testing.T, impl ports.DigiLockerPort, redirect ports.AuthRedirect) (callbackURL string)

// DigiLocker runs the DigiLockerPort contract.
//
//	StartConsent: invalid (no S256 challenge, foreign doctype).
//	ExchangeCode: invalid (PKCE verifier mismatch, reused code, redirect mismatch); timeout; unavailable.
//	ListIssued / PullLicence: invalid (expired or revoked token).
func DigiLocker(t *testing.T, newImpl func(t *testing.T) ports.DigiLockerPort, approve Approver, s256 func(string) string) {
	ctx := context.Background()
	const redirect = "http://api.test/v1/integrations/digilocker/callback"
	start := func(t *testing.T, impl ports.DigiLockerPort, verifier string) string {
		t.Helper()
		r, err := impl.StartConsent(ctx, ports.ConsentRequest{Purpose: "Show your DL validity and classes", Doctypes: []string{"DRVLC"},
			State: "st-123", CodeChallenge: s256(verifier), Method: "S256", RedirectURI: redirect})
		if err != nil {
			t.Fatal(err)
		}
		cb, err := url.Parse(approve(t, impl, r))
		if err != nil {
			t.Fatal(err)
		}
		if cb.Query().Get("state") != "st-123" {
			t.Fatal("state must round-trip")
		}
		code := cb.Query().Get("code")
		if code == "" {
			t.Fatal("no code on approval")
		}
		return code
	}
	verifier := strings.Repeat("v", 20) + "-verifier-0123456789abcdefABCDEF"

	t.Run("PKCE S256 is required", func(t *testing.T) {
		_, err := newImpl(t).StartConsent(ctx, ports.ConsentRequest{State: "s", RedirectURI: redirect, CodeChallenge: "short", Method: "plain"})
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("only DRVLC is requested", func(t *testing.T) {
		_, err := newImpl(t).StartConsent(ctx, ports.ConsentRequest{State: "s", RedirectURI: redirect, CodeChallenge: s256(verifier), Method: "S256", Doctypes: []string{"PANCR"}})
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("happy path returns minimised licence facts", func(t *testing.T) {
		impl := newImpl(t)
		code := start(t, impl, verifier)
		tok, err := impl.ExchangeCode(ctx, code, verifier, redirect)
		if err != nil {
			t.Fatal(err)
		}
		if tok.AccessToken == "" || tok.ExpiresIn <= 0 || tok.ExpiresIn > time.Hour {
			t.Fatalf("token must be short-lived: %+v", tok)
		}
		docs, err := impl.ListIssued(ctx, tok.AccessToken)
		if err != nil || len(docs) == 0 || docs[0].Doctype != "DRVLC" || !strings.HasPrefix(docs[0].URI, "in.gov.transport-DRVLC-") {
			t.Fatalf("issued list: %+v %v", docs, err)
		}
		facts, err := impl.PullLicence(ctx, tok.AccessToken)
		if err != nil {
			t.Fatal(err)
		}
		if len(facts.Classes) == 0 || len(facts.NumberLast4) != 4 || len(facts.NumberHash) == 0 || facts.ValidToNonTransport.IsZero() {
			t.Fatalf("facts incomplete: %+v", facts)
		}
		if err := impl.Revoke(ctx, tok.AccessToken); err != nil {
			t.Fatal(err)
		}
		_, err = impl.ListIssued(ctx, tok.AccessToken)
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("PKCE verifier mismatch is rejected", func(t *testing.T) {
		impl := newImpl(t)
		code := start(t, impl, verifier)
		_, err := impl.ExchangeCode(ctx, code, verifier+"x", redirect)
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("authorization code is single use", func(t *testing.T) {
		impl := newImpl(t)
		code := start(t, impl, verifier)
		if _, err := impl.ExchangeCode(ctx, code, verifier, redirect); err != nil {
			t.Fatal(err)
		}
		_, err := impl.ExchangeCode(ctx, code, verifier, redirect)
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("redirect_uri must match", func(t *testing.T) {
		impl := newImpl(t)
		code := start(t, impl, verifier)
		_, err := impl.ExchangeCode(ctx, code, verifier, "https://evil.example/cb")
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("outage", func(t *testing.T) {
		impl := newImpl(t)
		reset, ok := inject(impl, ports.FaultOutage)
		if !ok {
			t.Skip("no fault injection")
		}
		defer reset()
		_, err := impl.ExchangeCode(ctx, "x", verifier, redirect)
		wantKind(t, err, ports.KindUnavailable)
	})
	t.Run("health", func(t *testing.T) {
		impl := newImpl(t)
		checkHealth(t, impl.Health(ctx), impl.Mode())
	})
}

// ---- Aadhaar offline -------------------------------------------------------------------------

// AadhaarFixtures are synthetic artefacts for the AadhaarOfflinePort contract.
type AadhaarFixtures struct {
	Valid           ports.OfflineArtefact // full DOB, state matches, relation line present
	YearOnly        ports.OfflineArtefact // EC-01
	AddressMismatch ports.OfflineArtefact // EC-02 (and EC-03: relation line blank)
	Tampered        ports.OfflineArtefact
	WithTwelveDigit ports.OfflineArtefact
}

// AadhaarOffline runs the AadhaarOfflinePort contract.
//
//	Verify: prohibited (any 12-digit run anywhere, D-07); invalid (bad signature: fails closed;
//	        unknown kind); unsupported (disabled tenant).
func AadhaarOffline(t *testing.T, newImpl func(t *testing.T) ports.AadhaarOfflinePort, fx AadhaarFixtures) {
	ctx := context.Background()
	t.Run("verdict schema cannot hold an Aadhaar number, name, address or photo", func(t *testing.T) {
		typ := reflect.TypeOf(ports.OfflineVerdict{})
		for i := 0; i < typ.NumField(); i++ {
			n := strings.ToLower(typ.Field(i).Name)
			for _, bad := range []string{"aadhaar", "uid", "number", "name", "address", "photo", "image"} {
				if strings.Contains(n, bad) && n != "addressstatematches" && n != "addressdistrict" {
					t.Fatalf("OfflineVerdict field %s could hold prohibited data", typ.Field(i).Name)
				}
			}
		}
	})
	t.Run("valid artefact yields derived facts only", func(t *testing.T) {
		v, err := newImpl(t).Verify(ctx, fx.Valid)
		if err != nil {
			t.Fatal(err)
		}
		if !v.SignatureValid || v.DOBPrecision != "day" || !v.AddressStateMatches || !v.RelationLinePresent || v.AgeBand == "" {
			t.Fatalf("unexpected verdict %+v", v)
		}
		if !strings.HasPrefix(v.ReferenceHash, "sha256:") {
			t.Fatal("reference must be a salted hash")
		}
		noProhibited(t, v)
	})
	t.Run("EC-01 year-only DOB", func(t *testing.T) {
		v, err := newImpl(t).Verify(ctx, fx.YearOnly)
		if err != nil {
			t.Fatal(err)
		}
		if v.DOBPrecision != "year_only" {
			t.Fatalf("dob precision %q", v.DOBPrecision)
		}
	})
	t.Run("EC-02 address state mismatch and EC-03 blank relation line", func(t *testing.T) {
		v, err := newImpl(t).Verify(ctx, fx.AddressMismatch)
		if err != nil {
			t.Fatal(err)
		}
		if v.AddressStateMatches || v.RelationLinePresent || v.AddressDistrict == "" {
			t.Fatalf("flags not derived: %+v", v)
		}
	})
	t.Run("bad signature fails closed", func(t *testing.T) {
		_, err := newImpl(t).Verify(ctx, fx.Tampered)
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("a 12-digit string anywhere is rejected", func(t *testing.T) {
		_, err := newImpl(t).Verify(ctx, fx.WithTwelveDigit)
		wantKind(t, err, ports.KindProhibited)
		a := fx.Valid
		a.SharePhrase = "2345 6789 0123"
		_, err = newImpl(t).Verify(ctx, a)
		wantKind(t, err, ports.KindProhibited)
	})
	t.Run("unknown kind is invalid", func(t *testing.T) {
		a := fx.Valid
		a.Kind = "ekyc_otp"
		_, err := newImpl(t).Verify(ctx, a)
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("health", func(t *testing.T) {
		impl := newImpl(t)
		checkHealth(t, impl.Health(ctx), impl.Mode())
	})
}

// ---- Bhashini --------------------------------------------------------------------------------

// Bhashini runs the BhashiniPort contract.
//
//	Translate: unsupported (language pair); timeout. Input is PII-redacted (EC-20).
//	ASR:       unsupported (language); invalid (empty audio); timeout.
//	TTS:       unsupported (Dogri TTS is not offered by Bulbul); invalid (empty text); timeout.
func Bhashini(t *testing.T, newImpl func(t *testing.T) ports.BhashiniPort) {
	ctx := context.Background()
	t.Run("translate en->hi", func(t *testing.T) {
		out, err := newImpl(t).Translate(ctx, "Your learner's licence plan is ready.", "en", "hi")
		if err != nil || out == "" {
			t.Fatalf("%q %v", out, err)
		}
	})
	t.Run("translate redacts Aadhaar-like numbers before sending (EC-20)", func(t *testing.T) {
		aad := "23456789012"
		aad += string(privacy.VerhoeffCheckDigit(aad))
		out, err := newImpl(t).Translate(ctx, "my number is "+aad, "en", "hi")
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(out, aad) {
			t.Fatal("Aadhaar-like number reached the processor")
		}
	})
	t.Run("unsupported language pair", func(t *testing.T) {
		_, err := newImpl(t).Translate(ctx, "x", "en", "xx")
		wantKind(t, err, ports.KindUnsupported)
	})
	t.Run("ASR Dogri goes through a disclosed processor", func(t *testing.T) {
		tr, err := newImpl(t).ASR(ctx, []byte{1, 2, 3}, "doi")
		if err != nil || tr.Processor == "" || tr.Language != "doi" {
			t.Fatalf("%+v %v", tr, err)
		}
	})
	t.Run("ASR empty audio is invalid", func(t *testing.T) {
		_, err := newImpl(t).ASR(ctx, nil, "hi")
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("Dogri TTS is unsupported", func(t *testing.T) {
		_, err := newImpl(t).TTS(ctx, "namaste", "doi")
		wantKind(t, err, ports.KindUnsupported)
	})
	t.Run("TTS Hindi", func(t *testing.T) {
		s, err := newImpl(t).TTS(ctx, "नमस्ते", "hi")
		if err != nil || len(s.Audio) == 0 || s.MimeType == "" {
			t.Fatalf("%+v %v", s, err)
		}
	})
	t.Run("timeout", func(t *testing.T) {
		impl := newImpl(t)
		reset, ok := inject(impl, ports.FaultTimeout)
		if !ok {
			t.Skip("no fault injection")
		}
		defer reset()
		c, cancel := context.WithTimeout(ctx, 20*time.Millisecond)
		defer cancel()
		_, err := impl.Translate(c, "x", "en", "hi")
		wantKind(t, err, ports.KindTimeout)
	})
	t.Run("health", func(t *testing.T) {
		impl := newImpl(t)
		checkHealth(t, impl.Health(ctx), impl.Mode())
	})
}

// ---- Payment ---------------------------------------------------------------------------------

// Signer produces a signed callback as the gateway would send it at time at. Nil means the
// implementation has no callbacks (redirect-only).
type Signer func(cb ports.PaymentCallback, at time.Time) (signature string, body []byte)

// Payment runs the PaymentPort contract.
//
//	StartPayment:   invalid (amount <= 0 paise). Margdarshak never collects: collected_by = state_gateway.
//	VerifyCallback: invalid (unsigned, tampered, stale, replayed); unsupported (redirect-only).
func Payment(t *testing.T, newImpl func(t *testing.T) ports.PaymentPort, sign Signer, now func() time.Time) {
	ctx := context.Background()
	t.Run("amount must be positive paise", func(t *testing.T) {
		_, err := newImpl(t).StartPayment(ctx, ports.PaymentRequest{IntentRef: "pay_X", AmountPaise: 0})
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("redirect, never collection", func(t *testing.T) {
		r, err := newImpl(t).StartPayment(ctx, ports.PaymentRequest{IntentRef: "pay_X", AmountPaise: 90000, ReturnURL: "http://web.test/case/payment-return"})
		if err != nil {
			t.Fatal(err)
		}
		if r.URL == "" || r.CollectedBy != "state_gateway" {
			t.Fatalf("%+v", r)
		}
	})
	if sign == nil {
		t.Run("redirect-only implementations reject callbacks", func(t *testing.T) {
			_, err := newImpl(t).VerifyCallback(ctx, "t=1,v1=00", []byte(`{}`))
			wantKind(t, err, ports.KindUnsupported)
		})
		return
	}
	cb := ports.PaymentCallback{IntentRef: "pay_X", Status: "success", ReceiptNumber: "SIM-RCPT-1"}
	t.Run("signed callback verifies", func(t *testing.T) {
		sig, body := sign(cb, now())
		got, err := newImpl(t).VerifyCallback(ctx, sig, body)
		if err != nil || got.Status != "success" || got.IntentRef != "pay_X" {
			t.Fatalf("%+v %v", got, err)
		}
	})
	t.Run("EC-09 debited but pending", func(t *testing.T) {
		pending := cb
		pending.Status = "pending"
		sig, body := sign(pending, now())
		got, err := newImpl(t).VerifyCallback(ctx, sig, body)
		if err != nil || got.Status != "pending" {
			t.Fatalf("%+v %v", got, err)
		}
	})
	t.Run("unsigned callback is rejected", func(t *testing.T) {
		_, body := sign(cb, now())
		_, err := newImpl(t).VerifyCallback(ctx, "", body)
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("tampered callback is rejected", func(t *testing.T) {
		sig, body := sign(cb, now())
		tampered := strings.Replace(string(body), "success", "failed", 1)
		_, err := newImpl(t).VerifyCallback(ctx, sig, []byte(tampered))
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("stale callback is rejected", func(t *testing.T) {
		sig, body := sign(cb, now().Add(-10*time.Minute))
		_, err := newImpl(t).VerifyCallback(ctx, sig, body)
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("replayed callback is rejected", func(t *testing.T) {
		impl := newImpl(t)
		sig, body := sign(cb, now())
		if _, err := impl.VerifyCallback(ctx, sig, body); err != nil {
			t.Fatal(err)
		}
		_, err := impl.VerifyCallback(ctx, sig, body)
		wantKind(t, err, ports.KindInvalid)
	})
}

// ---- Notifications ---------------------------------------------------------------------------

// Notification runs the NotificationPort contract.
//
//	Send: unsupported (unknown channel; SMS before TRAI DLT returns disabled_until_dlt).
func Notification(t *testing.T, newImpl func(t *testing.T) ports.NotificationPort) {
	ctx := context.Background()
	t.Run("email is sent or queued", func(t *testing.T) {
		r, err := newImpl(t).Send(ctx, ports.Message{IdempotencyKey: "k1", Channel: "email", TemplateID: "auth.magic_link", Language: "en",
			To: "learner@example.com", Vars: map[string]string{"link": "http://web.test/auth?code=x", "ttl_minutes": "15"}})
		if err != nil {
			t.Fatal(err)
		}
		if r.Status != ports.DeliverySent && r.Status != ports.DeliveryQueued {
			t.Fatalf("status %q", r.Status)
		}
	})
	t.Run("SMS is disabled until DLT (D-16)", func(t *testing.T) {
		r, err := newImpl(t).Send(ctx, ports.Message{IdempotencyKey: "k2", Channel: "sms", TemplateID: "x"})
		wantKind(t, err, ports.KindUnsupported)
		if r.Status != ports.DeliveryDisabledUntilDLT {
			t.Fatalf("status %q, want disabled_until_dlt", r.Status)
		}
	})
	t.Run("unknown channel is unsupported", func(t *testing.T) {
		_, err := newImpl(t).Send(ctx, ports.Message{IdempotencyKey: "k3", Channel: "pigeon", TemplateID: "x"})
		wantKind(t, err, ports.KindUnsupported)
	})
}

// ---- Slots -----------------------------------------------------------------------------------

// Slot runs the SlotPort contract.
//
//	ListOffices: unavailable.
//	ListSlots:   not_found (office); invalid (bad kind, range > 31 days); unavailable.
//	There is no booking method (D-08).
func Slot(t *testing.T, newImpl func(t *testing.T) ports.SlotPort, mockData bool) {
	ctx := context.Background()
	from := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 13)
	t.Run("offices for the state", func(t *testing.T) {
		offs, err := newImpl(t).ListOffices(ctx, "JK", "")
		if err != nil || len(offs) == 0 {
			t.Fatalf("%v %v", offs, err)
		}
		for _, o := range offs {
			if !strings.HasPrefix(o.ID, "off_") || o.Name == "" || o.District == "" {
				t.Fatalf("bad office %+v", o)
			}
			if mockData && !o.SampleData {
				t.Fatalf("mock office %s must be labelled sample data", o.ID)
			}
		}
	})
	t.Run("same seed, same calendar", func(t *testing.T) {
		a, err := newImpl(t).ListSlots(ctx, "off_jk02", "dl_test", from, to)
		if err != nil {
			t.Fatal(err)
		}
		b, err := newImpl(t).ListSlots(ctx, "off_jk02", "dl_test", from, to)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(a, b) || len(a) == 0 {
			t.Fatalf("calendar not deterministic (%d vs %d slots)", len(a), len(b))
		}
	})
	t.Run("every slot carries simulated: true", func(t *testing.T) {
		slots, err := newImpl(t).ListSlots(ctx, "off_jk02", "ll_test", from, to)
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range slots {
			if mockData && (!s.Simulated || s.Source != "mock") {
				t.Fatalf("slot %s not labelled simulated", s.ID)
			}
			if d := s.Date.Format(time.DateOnly); d < from.Format(time.DateOnly) || d > to.Format(time.DateOnly) {
				t.Fatalf("slot %s outside range", s.ID)
			}
		}
	})
	t.Run("unknown office", func(t *testing.T) {
		_, err := newImpl(t).ListSlots(ctx, "off_nowhere", "dl_test", from, to)
		wantKind(t, err, ports.KindNotFound)
	})
	t.Run("range over 31 days is invalid", func(t *testing.T) {
		_, err := newImpl(t).ListSlots(ctx, "off_jk02", "dl_test", from, from.AddDate(0, 2, 0))
		wantKind(t, err, ports.KindInvalid)
	})
	t.Run("no booking method exists (D-08)", func(t *testing.T) {
		typ := reflect.TypeOf(newImpl(t))
		for i := 0; i < typ.NumMethod(); i++ {
			n := strings.ToLower(typ.Method(i).Name)
			for _, bad := range []string{"book", "reserve", "hold", "submit"} {
				if strings.Contains(n, bad) {
					t.Fatalf("slot adapter exposes %s: booking must stay on Sarathi", typ.Method(i).Name)
				}
			}
		}
	})
	t.Run("outage", func(t *testing.T) {
		impl := newImpl(t)
		reset, ok := inject(impl, ports.FaultOutage)
		if !ok {
			t.Skip("no fault injection")
		}
		defer reset()
		_, err := impl.ListOffices(ctx, "JK", "")
		wantKind(t, err, ports.KindUnavailable)
	})
	t.Run("health", func(t *testing.T) {
		impl := newImpl(t)
		checkHealth(t, impl.Health(ctx), impl.Mode())
	})
}
