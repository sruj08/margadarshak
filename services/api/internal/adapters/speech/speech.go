// Package speech is the Dogri cascade's speech port (M-08, VOICE.md §3.3): Sarvam Saaras for
// Dogri speech to text and Sarvam Bulbul for Hindi text to speech, plus a mock with the same
// contract. Audio is sent once and never stored.
package speech

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

// Port turns speech into text and text into speech.
type Port interface {
	// STT transcribes WAV audio in lang (BCP-47, e.g. doi-IN).
	STT(ctx context.Context, wav []byte, lang string) (string, error)
	// TTS speaks text in lang (e.g. hi-IN) and returns WAV audio.
	TTS(ctx context.Context, text, lang string) ([]byte, error)
}

// ErrUnavailable means the provider is not configured or failed (the cascade falls back to text).
var ErrUnavailable = errors.New("speech: unavailable")

// Sarvam calls the Sarvam REST API. Model strings come from env (MODELS.md M-08: unverified).
type Sarvam struct {
	BaseURL, APIKey    string
	STTModel, TTSModel string
	Speaker            string
	HTTP               *http.Client
}

// NewSarvam returns nil when no key is set.
func NewSarvam(baseURL, key string) *Sarvam {
	if strings.TrimSpace(key) == "" {
		return nil
	}
	return &Sarvam{BaseURL: strings.TrimRight(baseURL, "/"), APIKey: key, STTModel: "saarika:v2.5", TTSModel: "bulbul:v2",
		Speaker: "anushka", HTTP: &http.Client{Timeout: 15 * time.Second}}
}

// STT implements Port.
func (s *Sarvam) STT(ctx context.Context, wav []byte, lang string) (string, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", "turn.wav")
	if err != nil {
		return "", fmt.Errorf("speech: stt form: %w", err)
	}
	if _, err := fw.Write(wav); err != nil {
		return "", fmt.Errorf("speech: stt form: %w", err)
	}
	_ = mw.WriteField("model", s.STTModel)
	_ = mw.WriteField("language_code", lang)
	if err := mw.Close(); err != nil {
		return "", fmt.Errorf("speech: stt form: %w", err)
	}
	var out struct {
		Transcript string `json:"transcript"`
	}
	if err := s.do(ctx, "/speech-to-text", mw.FormDataContentType(), &body, &out); err != nil {
		return "", err
	}
	return strings.TrimSpace(out.Transcript), nil
}

// TTS implements Port.
func (s *Sarvam) TTS(ctx context.Context, text, lang string) ([]byte, error) {
	in, err := json.Marshal(map[string]any{"text": text, "target_language_code": lang, "model": s.TTSModel, "speaker": s.Speaker})
	if err != nil {
		return nil, fmt.Errorf("speech: tts body: %w", err)
	}
	var out struct {
		Audios []string `json:"audios"`
	}
	if err := s.do(ctx, "/text-to-speech", "application/json", bytes.NewReader(in), &out); err != nil {
		return nil, err
	}
	if len(out.Audios) == 0 {
		return nil, fmt.Errorf("speech: tts: no audio: %w", ErrUnavailable)
	}
	wav, err := base64.StdEncoding.DecodeString(out.Audios[0])
	if err != nil {
		return nil, fmt.Errorf("speech: tts audio: %w", err)
	}
	return wav, nil
}

func (s *Sarvam) do(ctx context.Context, path, contentType string, body io.Reader, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.BaseURL+path, body)
	if err != nil {
		return fmt.Errorf("speech: request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("api-subscription-key", s.APIKey)
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("speech: %s: %w", path, errors.Join(ErrUnavailable, err))
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("speech: %s: status %d: %w", path, resp.StatusCode, ErrUnavailable)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out); err != nil {
		return fmt.Errorf("speech: %s: decode: %w", path, err)
	}
	return nil
}

// Mock answers from fixed maps (contract tests and local dev).
type Mock struct {
	Transcript string
	Audio      []byte
	Fail       bool
}

// STT implements Port.
func (m *Mock) STT(_ context.Context, _ []byte, _ string) (string, error) {
	if m.Fail {
		return "", ErrUnavailable
	}
	return m.Transcript, nil
}

// TTS implements Port.
func (m *Mock) TTS(_ context.Context, _ string, _ string) ([]byte, error) {
	if m.Fail {
		return nil, ErrUnavailable
	}
	return m.Audio, nil
}

// WAV wraps PCM16 mono samples at rate in a WAV header.
func WAV(pcm []byte, rate int) []byte {
	var b bytes.Buffer
	w := func(v any) { _ = binary.Write(&b, binary.LittleEndian, v) }
	b.WriteString("RIFF")
	w(uint32(36 + len(pcm)))
	b.WriteString("WAVEfmt ")
	w(uint32(16))
	w(uint16(1)) // PCM
	w(uint16(1)) // mono
	w(uint32(rate))
	w(uint32(rate * 2))
	w(uint16(2))
	w(uint16(16))
	b.WriteString("data")
	w(uint32(len(pcm)))
	b.Write(pcm)
	return b.Bytes()
}
