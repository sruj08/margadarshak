package adapters_test

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/adapters"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/aadhaaroffline"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/bhashini"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/digilocker"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/payment"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/sarathi"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/slot"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/ports/contracttest"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

var fixedNow = time.Date(2026, 10, 24, 4, 30, 0, 0, time.UTC)

func now() time.Time { return fixedNow }

func TestContractSarathiDeeplink(t *testing.T) {
	contracttest.Sarathi(t, func(*testing.T) ports.SarathiPort { return sarathi.NewDeeplink(now) })
}

func TestContractSarathiMock(t *testing.T) {
	contracttest.Sarathi(t, func(*testing.T) ports.SarathiPort { return sarathi.NewMock(now) })
}

// MD-037: deeplink mode makes zero HTTP calls to any government domain.
func TestContractSarathiDeeplinkMakesNoHTTPCalls(t *testing.T) {
	var calls atomic.Int64
	orig := http.DefaultTransport
	http.DefaultTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, http.ErrUseLastResponse
	})
	defer func() { http.DefaultTransport = orig }()
	d := sarathi.NewDeeplink(now)
	ctx := context.Background()
	for _, step := range []string{"ll_application", "dl_application", "slot_booking", "fee_payment"} {
		if _, err := d.BuildHandoff(ctx, ports.HandoffRequest{Step: step, State: "JK"}); err != nil {
			t.Fatal(err)
		}
	}
	_, _ = d.ApplicationStatus(ctx, "X")
	_ = d.Health(ctx)
	if calls.Load() != 0 {
		t.Fatalf("deeplink adapter made %d HTTP calls", calls.Load())
	}
	// Structural guarantee: the type holds no HTTP client.
	typ := reflect.TypeOf(*d)
	for i := 0; i < typ.NumField(); i++ {
		if strings.Contains(typ.Field(i).Type.String(), "http.") {
			t.Fatalf("deeplink adapter must not hold an HTTP client (%s)", typ.Field(i).Name)
		}
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// EC-11: the mock's outage injection marks Sarathi down (drives the banner and offline draft).
func TestContractSarathiMockOutageEC11(t *testing.T) {
	m := sarathi.NewMock(now)
	ref := m.StartApplication("JK")
	m.InjectFault(ports.FaultOutage)
	if _, err := m.ApplicationStatus(context.Background(), ref); ports.KindOf(err) != ports.KindUnavailable {
		t.Fatalf("want unavailable, got %v", err)
	}
	m.InjectFault(ports.FaultNone)
	st, err := m.ApplicationStatus(context.Background(), ref)
	if err != nil || st.Stage != "S2" || !st.Simulated {
		t.Fatalf("%+v %v", st, err)
	}
	m.InjectFault(ports.FaultPendingPayment)
	ref2 := m.StartApplication("JK")
	st, _ = m.ApplicationStatus(context.Background(), ref2)
	if st.Payment != "pending" {
		t.Fatalf("EC-09 pending payment not simulated: %+v", st)
	}
}

func TestContractDigiLockerMock(t *testing.T) {
	contracttest.DigiLocker(t,
		func(*testing.T) ports.DigiLockerPort {
			return digilocker.NewMock("http://api.test/mock/digilocker/authorize", now)
		},
		func(t *testing.T, impl ports.DigiLockerPort, r ports.AuthRedirect) string {
			u, err := url.Parse(r.URL)
			if err != nil {
				t.Fatal(err)
			}
			m := impl.(*digilocker.Mock)
			screen, ok := m.Screen(u.Query().Get("request"))
			if !ok || screen.Purpose == "" || len(screen.Doctypes) == 0 || screen.ValidFor <= 0 {
				t.Fatalf("consent screen must show purpose, documents and validity: %+v", screen)
			}
			cb, err := m.Decide(u.Query().Get("request"), true)
			if err != nil {
				t.Fatal(err)
			}
			return cb
		},
		digilocker.S256)
}

func aadhaarFixtures() contracttest.AadhaarFixtures {
	key := []byte("contract-aadhaar-key")
	art := func(s aadhaaroffline.Sample) ports.OfflineArtefact {
		return ports.OfflineArtefact{Kind: "secure_qr", Payload: aadhaaroffline.Sign(key, s), ExpectedState: "JK"}
	}
	valid := aadhaaroffline.Sample{V: 1, YearOfBirth: 2007, DOB: "2007-05-02", State: "JK", District: "Jammu", RelationLine: true, Ref: "SIMREF-A"}
	yearOnly := valid
	yearOnly.DOB = ""
	mismatch := valid
	mismatch.State, mismatch.District, mismatch.RelationLine = "PB", "Pathankot", false
	tampered := art(valid)
	tampered.Payload = bytes.Replace(tampered.Payload, []byte(`"district":"Jammu"`), []byte(`"district":"Delhi"`), 1)
	twelve := valid
	twelve.Ref = "SIMREF-234567890123"
	return contracttest.AadhaarFixtures{
		Valid: art(valid), YearOnly: art(yearOnly), AddressMismatch: art(mismatch), Tampered: tampered, WithTwelveDigit: art(twelve),
	}
}

func TestContractAadhaarOfflineMock(t *testing.T) {
	contracttest.AadhaarOffline(t, func(*testing.T) ports.AadhaarOfflinePort {
		return aadhaaroffline.NewMock([]byte("contract-aadhaar-key"), now, slog.New(slog.DiscardHandler))
	}, aadhaarFixtures())
}

// MD-039: the rejection is logged as a redaction event, and the number itself never reaches the log.
func TestContractAadhaarOfflineRejectionIsLoggedWithoutTheNumber(t *testing.T) {
	var buf bytes.Buffer
	m := aadhaaroffline.NewMock([]byte("contract-aadhaar-key"), now, logging.New(&buf, "debug"))
	fx := aadhaarFixtures()
	if _, err := m.Verify(context.Background(), fx.WithTwelveDigit); ports.KindOf(err) != ports.KindProhibited {
		t.Fatalf("want prohibited, got %v", err)
	}
	if !strings.Contains(buf.String(), "pii_trip") || strings.Contains(buf.String(), "234567890123") {
		t.Fatalf("log line wrong: %s", buf.String())
	}
}

func TestContractBhashiniMock(t *testing.T) {
	contracttest.Bhashini(t, func(*testing.T) ports.BhashiniPort { return bhashini.NewMock() })
}

func TestContractPaymentMock(t *testing.T) {
	secret := []byte("contract-payment-secret")
	var signer *payment.Mock
	contracttest.Payment(t, func(*testing.T) ports.PaymentPort {
		signer = payment.NewMock("http://api.test/mock/payment", secret, hmacsig.NewMemoryReplayCache(), now)
		return signer
	}, func(cb ports.PaymentCallback, at time.Time) (string, []byte) {
		s := payment.NewMock("http://api.test/mock/payment", secret, nil, now)
		return s.SignCallbackAt(cb, at)
	}, now)
	_ = signer
}

func TestContractPaymentSarathiRedirect(t *testing.T) {
	contracttest.Payment(t, func(*testing.T) ports.PaymentPort { return payment.SarathiRedirect{} }, nil, now)
}

func TestContractNotificationRouter(t *testing.T) {
	contracttest.Notification(t, func(*testing.T) ports.NotificationPort {
		return notify.NewRouter(notify.Console{Log: slog.New(slog.DiscardHandler)}, slog.New(slog.DiscardHandler))
	})
}

func TestContractSlotMock(t *testing.T) {
	contracttest.Slot(t, func(*testing.T) ports.SlotPort { return slot.NewMock(42) }, true)
}

// MD-036: swapping an implementation is a configuration change only.
func TestContractSwapIsConfigOnly(t *testing.T) {
	reg := adapters.NewRegistry(adapters.Deps{Now: now, PublicBaseURL: "http://api.test", PaymentSecret: []byte("s"), AadhaarKey: []byte("k")})
	a, err := reg.For(map[string]string{"sarathi": "deeplink", "payment": "sarathi_redirect"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := reg.For(map[string]string{"sarathi": "mock", "payment": "mock"})
	if err != nil {
		t.Fatal(err)
	}
	if a.Sarathi.Mode() != "deeplink" || b.Sarathi.Mode() != "mock" || a.Payment.Mode() != "sarathi_redirect" || b.Payment.Mode() != "mock" {
		t.Fatalf("modes: %v / %v", a.Modes, b.Modes)
	}
	// Environment overrides win over tenant config (ADAPTER_SARATHI=mock).
	reg2 := adapters.NewRegistry(adapters.Deps{Now: now, Overrides: map[string]string{"sarathi": "mock"}})
	c, err := reg2.For(map[string]string{"sarathi": "deeplink"})
	if err != nil || c.Sarathi.Mode() != "mock" {
		t.Fatalf("override not applied: %v %v", c.Modes, err)
	}
	// Stateful mocks are singletons, so a consent started on one request completes on the next.
	d, _ := reg.For(map[string]string{})
	if d.DigiLocker != b.DigiLocker {
		t.Fatal("digilocker mock must be a singleton")
	}
	// An implementation this build does not have fails loudly instead of silently falling back.
	if _, err := reg.For(map[string]string{"sarathi": "nic"}); err == nil {
		t.Fatal("unknown implementation must be an error")
	}
}

// TestNoForbiddenFields: no port or adapter type has a field that could carry an Aadhaar number,
// VID, OTP, biometric or face image, and nothing an adapter returns carries such a value (D-07).
func TestNoForbiddenFields(t *testing.T) {
	forbidden := []string{"aadhaar", "aadhar", "uid", "vid", "otp", "biometric", "fingerprint", "iris", "face", "captcha", "password"}
	types := []any{
		ports.HandoffRequest{}, ports.HandoffPack{}, ports.HandoffStep{}, ports.HandoffField{}, ports.ApplicationStatus{},
		ports.ConsentRequest{}, ports.AuthRedirect{}, ports.TokenSet{}, ports.DocumentRef{}, ports.LicenceFacts{},
		ports.OfflineArtefact{}, ports.OfflineVerdict{}, ports.Transcript{}, ports.Speech{},
		ports.PaymentRequest{}, ports.PaymentRedirect{}, ports.PaymentCallback{}, ports.Office{}, ports.Slot{},
		ports.Message{}, ports.DeliveryResult{}, aadhaaroffline.Sample{}, payment.CallbackBody{},
		ports.PrefillRequest{}, ports.PrefillReceipt{}, notify.OutboundMessage{}, notify.EnvelopePayload{},
	}
	for _, v := range types {
		typ := reflect.TypeOf(v)
		for i := 0; i < typ.NumField(); i++ {
			f := typ.Field(i)
			if bad, ok := forbiddenName(f.Name, f.Tag.Get("json"), forbidden); ok {
				t.Errorf("%s.%s looks like a prohibited field (%s)", typ.Name(), f.Name, bad)
			}
		}
	}

	// Values: every adapter output in a full mock round trip is free of CX data.
	ctx := context.Background()
	reg := adapters.NewRegistry(adapters.Deps{Now: now, PublicBaseURL: "http://api.test", AadhaarKey: []byte("contract-aadhaar-key")})
	set, err := reg.For(map[string]string{"sarathi": "mock", "payment": "mock"})
	if err != nil {
		t.Fatal(err)
	}
	pack, _ := set.Sarathi.BuildHandoff(ctx, ports.HandoffRequest{Step: "ll_application", State: "JK", Classes: []string{"MCWG"}})
	verdict, _ := set.AadhaarOffline.Verify(ctx, aadhaarFixtures().Valid)
	offices, _ := set.Slot.ListOffices(ctx, "JK", "")
	slots, _ := set.Slot.ListSlots(ctx, "off_jk02", "dl_test", fixedNow, fixedNow.AddDate(0, 0, 20))
	for name, v := range map[string]any{"handoff": pack, "verdict": verdict, "offices": offices, "slots": slots} {
		if leak := findProhibited(v); leak != "" {
			t.Errorf("%s output carries prohibited data: %s", name, leak)
		}
	}

	// Logs: an Aadhaar-like number logged through the platform logger never reaches the sink.
	var buf bytes.Buffer
	log := logging.New(&buf, "debug")
	aad := "98765432101"
	aad += string(privacy.VerhoeffCheckDigit(aad))
	log.Info("user typed "+aad, "otp_hint", "my OTP is 482913")
	if strings.Contains(buf.String(), aad) || strings.Contains(buf.String(), "482913") {
		t.Fatalf("PII reached the log: %s", buf.String())
	}
}

func forbiddenName(goName, jsonTag string, forbidden []string) (string, bool) {
	var words []string
	start := 0
	for i := 1; i <= len(goName); i++ {
		if i == len(goName) || (goName[i] >= 'A' && goName[i] <= 'Z' && goName[i-1] >= 'a' && goName[i-1] <= 'z') {
			words = append(words, strings.ToLower(goName[start:i]))
			start = i
		}
	}
	words = append(words, strings.Split(strings.Split(jsonTag, ",")[0], "_")...)
	for _, w := range words {
		if strings.Contains(w, "aadhaar") || strings.Contains(w, "aadhar") {
			return w, true
		}
		for _, bad := range forbidden {
			if w == bad {
				return bad, true
			}
		}
	}
	return "", false
}

func findProhibited(v any) string {
	var leak string
	var walk func(reflect.Value)
	walk = func(rv reflect.Value) {
		if leak != "" {
			return
		}
		switch rv.Kind() {
		case reflect.String:
			if k, ok := privacy.FirstProhibited(rv.String()); ok {
				leak = string(k)
			}
		case reflect.Struct:
			for i := 0; i < rv.NumField(); i++ {
				if rv.Type().Field(i).IsExported() {
					walk(rv.Field(i))
				}
			}
		case reflect.Slice, reflect.Array:
			if rv.Type().Elem().Kind() == reflect.Uint8 {
				return
			}
			for i := 0; i < rv.Len(); i++ {
				walk(rv.Index(i))
			}
		case reflect.Pointer, reflect.Interface:
			if !rv.IsNil() {
				walk(rv.Elem())
			}
		}
	}
	walk(reflect.ValueOf(v))
	return leak
}
