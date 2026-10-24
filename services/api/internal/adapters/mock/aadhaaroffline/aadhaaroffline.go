// Package aadhaaroffline is the mock-only AadhaarOfflinePort (MD-039, D-07). Real Secure QR /
// Paperless XML verification carries OVSE duties, so Margdarshak never runs it itself; in
// government mode the state's own service is called and returns only derived booleans.
//
// The mock accepts a synthetic artefact (JSON signed with a test HMAC key, standing in for the
// UIDAI signature), checks the signature (fails closed) and returns only derived facts: age band,
// DOB precision (EC-01), address-state match and district (EC-02), relation line present (EC-03),
// and a salted hash of the reference id. Any 12-digit run anywhere in the payload or the share
// phrase is rejected and logged as a redaction event (type only).
package aadhaaroffline

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/domain/age"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

const port = "aadhaar_offline"

// Sample is the synthetic artefact body. It has no field for a number, name, address or photo.
type Sample struct {
	V            int    `json:"v"`
	YearOfBirth  int    `json:"yob"`
	DOB          string `json:"dob,omitempty"` // YYYY-MM-DD; empty means year only (EC-01)
	State        string `json:"state"`
	District     string `json:"district"`
	RelationLine bool   `json:"relation_line"`
	Ref          string `json:"ref"`
	Sig          string `json:"sig,omitempty"`
}

// Mock verifies synthetic artefacts.
type Mock struct {
	key  []byte
	salt []byte
	now  func() time.Time
	log  *slog.Logger
}

// NewMock returns a verifier using key (the stand-in for UIDAI's public certificate).
func NewMock(key []byte, now func() time.Time, log *slog.Logger) *Mock {
	return &Mock{key: key, salt: []byte("md-ref-salt:" + string(key)), now: now, log: log}
}

// Mode implements ports.AadhaarOfflinePort.
func (m *Mock) Mode() string { return "mock" }

// Sign returns a signed synthetic artefact for tests and seeds.
func Sign(key []byte, s Sample) []byte {
	s.Sig = ""
	s.Sig = mac(key, s)
	b, _ := json.Marshal(s)
	return b
}

func mac(key []byte, s Sample) string {
	s.Sig = ""
	b, _ := json.Marshal(s)
	h := hmac.New(sha256.New, key)
	h.Write(b)
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// Verify implements ports.AadhaarOfflinePort.
func (m *Mock) Verify(ctx context.Context, a ports.OfflineArtefact) (ports.OfflineVerdict, error) {
	if privacy.HasTwelveDigitRun(string(a.Payload)) || privacy.HasTwelveDigitRun(a.SharePhrase) {
		if m.log != nil {
			m.log.WarnContext(ctx, "pii_trip", "port", port, "kind", string(privacy.KindAadhaar), "action", "rejected")
		}
		return ports.OfflineVerdict{}, ports.E(port, "Verify", ports.KindProhibited, "payload contains a 12-digit number")
	}
	if a.Kind != "secure_qr" && a.Kind != "paperless_xml_zip" {
		return ports.OfflineVerdict{}, ports.E(port, "Verify", ports.KindInvalid, "kind must be secure_qr or paperless_xml_zip")
	}
	var s Sample
	if err := json.Unmarshal(a.Payload, &s); err != nil || s.Sig == "" {
		return ports.OfflineVerdict{}, ports.E(port, "Verify", ports.KindInvalid, "unreadable or unsigned artefact")
	}
	if !hmac.Equal([]byte(s.Sig), []byte(mac(m.key, s))) {
		return ports.OfflineVerdict{}, ports.E(port, "Verify", ports.KindInvalid, "signature check failed")
	}
	precision := age.YearOnly
	dob := time.Date(s.YearOfBirth, time.January, 1, 0, 0, 0, 0, servertime.IST)
	if s.DOB != "" {
		d, err := time.ParseInLocation(time.DateOnly, s.DOB, servertime.IST)
		if err != nil {
			return ports.OfflineVerdict{}, ports.E(port, "Verify", ports.KindInvalid, "bad dob")
		}
		dob, precision = d, age.Day
	}
	assessed, err := age.Assess(dob, precision, servertime.TodayIST(m.now()))
	if err != nil {
		return ports.OfflineVerdict{}, ports.E(port, "Verify", ports.KindInvalid, err.Error())
	}
	ref := sha256.Sum256(append(append([]byte{}, m.salt...), []byte(s.Ref)...))
	return ports.OfflineVerdict{
		SignatureValid:      true,
		AgeBand:             string(assessed.Band),
		DOBPrecision:        string(precision),
		AddressStateMatches: a.ExpectedState != "" && strings.EqualFold(a.ExpectedState, s.State),
		AddressDistrict:     s.District,
		RelationLinePresent: s.RelationLine,
		ReferenceHash:       "sha256:" + hex.EncodeToString(ref[:8]),
		Simulated:           true,
		RetainedFields:      []string{"signature_valid", "age_band", "dob_precision", "address_state_matches", "reference_hash"},
	}, nil
}

// Health implements ports.AadhaarOfflinePort.
func (m *Mock) Health(context.Context) ports.Health {
	return ports.Health{Implementation: "mock", Status: "ok"}
}

// Disabled is the AadhaarOfflinePort for tenants with the feature off.
type Disabled struct{}

// Mode implements ports.AadhaarOfflinePort.
func (Disabled) Mode() string { return "disabled" }

// Verify always returns unsupported.
func (Disabled) Verify(context.Context, ports.OfflineArtefact) (ports.OfflineVerdict, error) {
	return ports.OfflineVerdict{}, ports.E(port, "Verify", ports.KindUnsupported, "aadhaar offline verification is disabled for this tenant")
}

// Health implements ports.AadhaarOfflinePort.
func (Disabled) Health(context.Context) ports.Health {
	return ports.Health{Implementation: "disabled", Status: "ok"}
}
