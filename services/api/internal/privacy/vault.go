package privacy

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"

	"golang.org/x/crypto/hkdf"
)

// Vault encrypts C3/C4 fields (DATA_MODEL §4.0): AES-256-GCM with a per-tenant data key and a
// blind index (HMAC-SHA256 with a per-tenant pepper) for equality lookups.
//
// Hackathon: per-tenant keys are derived from one KEK with HKDF-SHA256 (info binds tenant and
// purpose). Production: per-tenant DEKs wrapped by a KEK held in an Indian KMS/HSM; the
// envelope already carries a key id so keys can rotate.
type Vault struct {
	kek    []byte
	pepper []byte
	kid    byte

	mu    sync.Mutex
	aeads map[string]cipher.AEAD
}

const envelopeV1 = 0x01

// ErrDecrypt is returned for a tampered or foreign ciphertext.
var ErrDecrypt = errors.New("privacy: cannot decrypt field")

// NewVault builds a vault from a 32-byte KEK and a pepper (any length >= 16).
func NewVault(kek, pepper []byte) (*Vault, error) {
	if len(kek) != 32 {
		return nil, fmt.Errorf("privacy: KEK must be 32 bytes, got %d", len(kek))
	}
	if len(pepper) < 16 {
		return nil, errors.New("privacy: blind-index pepper must be at least 16 bytes")
	}
	return &Vault{kek: kek, pepper: pepper, kid: 1, aeads: map[string]cipher.AEAD{}}, nil
}

func (v *Vault) aead(tenant string) (cipher.AEAD, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if a, ok := v.aeads[tenant]; ok {
		return a, nil
	}
	key := make([]byte, 32)
	if _, err := io.ReadFull(hkdf.New(sha256.New, v.kek, nil, []byte("margdarshak:dek:v1:"+tenant)), key); err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	a, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	v.aeads[tenant] = a
	return a, nil
}

// Encrypt seals plaintext for tenant. field is bound as additional data, so a ciphertext copied
// into another column or tenant fails to open. Envelope: version | kid | nonce | ciphertext.
func (v *Vault) Encrypt(tenant, field string, plaintext []byte) ([]byte, error) {
	if tenant == "" {
		return nil, errors.New("privacy: encrypt needs a tenant")
	}
	a, err := v.aead(tenant)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, a.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	out := make([]byte, 0, 2+len(nonce)+len(plaintext)+a.Overhead())
	out = append(out, envelopeV1, v.kid)
	out = append(out, nonce...)
	return a.Seal(out, nonce, plaintext, aad(tenant, field)), nil
}

// EncryptString is Encrypt for strings.
func (v *Vault) EncryptString(tenant, field, s string) ([]byte, error) {
	return v.Encrypt(tenant, field, []byte(s))
}

// Decrypt opens an envelope produced by Encrypt.
func (v *Vault) Decrypt(tenant, field string, env []byte) ([]byte, error) {
	a, err := v.aead(tenant)
	if err != nil {
		return nil, err
	}
	if len(env) < 2+a.NonceSize()+a.Overhead() || env[0] != envelopeV1 {
		return nil, ErrDecrypt
	}
	nonce := env[2 : 2+a.NonceSize()]
	pt, err := a.Open(nil, nonce, env[2+a.NonceSize():], aad(tenant, field))
	if err != nil {
		return nil, ErrDecrypt
	}
	return pt, nil
}

// DecryptString is Decrypt for strings.
func (v *Vault) DecryptString(tenant, field string, env []byte) (string, error) {
	b, err := v.Decrypt(tenant, field, env)
	return string(b), err
}

// BlindIndex returns HMAC-SHA256(tenant pepper, kind:normalised value) for lookups.
func (v *Vault) BlindIndex(tenant, kind, value string) []byte {
	m := hmac.New(sha256.New, v.tenantPepper(tenant))
	m.Write([]byte(kind + ":" + NormalizeContact(kind, value)))
	return m.Sum(nil)
}

// Keyed returns HMAC-SHA256(tenant pepper, purpose:value) for non-contact hashes such as
// auth subjects and LL/DL number hashes.
func (v *Vault) Keyed(tenant, purpose, value string) []byte {
	m := hmac.New(sha256.New, v.tenantPepper(tenant))
	m.Write([]byte(purpose + ":" + value))
	return m.Sum(nil)
}

func (v *Vault) tenantPepper(tenant string) []byte {
	m := hmac.New(sha256.New, v.pepper)
	m.Write([]byte("tenant:" + tenant))
	return m.Sum(nil)
}

// NormalizeContact canonicalises an e-mail (lower-case, trimmed) or phone (digits only, last 10).
func NormalizeContact(kind, value string) string {
	value = strings.TrimSpace(value)
	switch kind {
	case "email":
		return strings.ToLower(value)
	case "phone":
		var b strings.Builder
		for _, r := range Normalize(value) {
			if r >= '0' && r <= '9' {
				b.WriteRune(r)
			}
		}
		d := b.String()
		if len(d) > 10 {
			d = d[len(d)-10:]
		}
		return d
	default:
		return value
	}
}

func aad(tenant, field string) []byte { return []byte("md:" + tenant + ":" + field) }
