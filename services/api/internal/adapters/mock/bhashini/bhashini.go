// Package bhashini is the mock BhashiniPort (MD-040): reviewed fixture strings for translation,
// fixed transcripts for ASR and a silent WAV for TTS. Language support mirrors what is known:
// Hindi and English everywhere; Dogri speech-in through Sarvam Saaras (disclosed processor);
// no Dogri TTS (Sarvam Bulbul does not offer it), which callers must handle as unsupported.
//
// Slots for other implementations behind the same port: the Bhashini ULCA / Dhruva pipelines
// (government mode), a local IndicTrans2 model for offline translation, and Sarvam for speech.
package bhashini

import (
	"context"
	"strings"
	"sync"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

const port = "bhashini"

var (
	translateLangs = map[string]bool{"en": true, "hi": true, "doi": true}
	asrLangs       = map[string]bool{"en": true, "hi": true, "doi": true}
	ttsLangs       = map[string]bool{"en": true, "hi": true}
)

// fixtures are reviewed translations (en -> hi / doi) for strings used in the demo.
var fixtures = map[string]map[string]string{
	"hi": {
		"Your learner's licence plan is ready.": "आपका लर्नर लाइसेंस प्लान तैयार है।",
		"Book your driving test":                "अपना ड्राइविंग टेस्ट बुक करें",
	},
	"doi": {
		"Your learner's licence plan is ready.": "तुंदा लर्नर लाइसेंस प्लान त्यार ऐ।",
	},
}

var transcripts = map[string]string{
	"en":  "I want a bike licence",
	"hi":  "मुझे बाइक का लाइसेंस चाहिए",
	"doi": "मिगी बाइक दा लाइसेंस चाहीदा ऐ",
}

// Mock is the fixture-backed implementation.
type Mock struct {
	mu    sync.Mutex
	fault ports.Fault
}

// NewMock returns the mock.
func NewMock() *Mock { return &Mock{} }

// Mode implements ports.BhashiniPort.
func (m *Mock) Mode() string { return "mock" }

// InjectFault implements ports.FaultInjector.
func (m *Mock) InjectFault(f ports.Fault) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fault = f
}

func (m *Mock) faultErr(ctx context.Context, op string) error {
	m.mu.Lock()
	f := m.fault
	m.mu.Unlock()
	switch f {
	case ports.FaultTimeout:
		<-ctx.Done()
		return ports.E(port, op, ports.KindTimeout, "simulated timeout")
	case ports.FaultOutage:
		return ports.E(port, op, ports.KindUnavailable, "simulated outage")
	}
	return nil
}

// Translate implements ports.BhashiniPort. Input is redacted before "sending" (EC-20).
func (m *Mock) Translate(ctx context.Context, text, src, tgt string) (string, error) {
	if err := m.faultErr(ctx, "Translate"); err != nil {
		return "", err
	}
	if !translateLangs[src] || !translateLangs[tgt] {
		return "", ports.E(port, "Translate", ports.KindUnsupported, "language pair "+src+"->"+tgt)
	}
	text = privacy.RedactString(text)
	if src == tgt {
		return text, nil
	}
	if out, ok := fixtures[tgt][text]; ok {
		return out, nil
	}
	return "[" + tgt + "] " + text, nil
}

// ASR implements ports.BhashiniPort.
func (m *Mock) ASR(ctx context.Context, audio []byte, lang string) (ports.Transcript, error) {
	if err := m.faultErr(ctx, "ASR"); err != nil {
		return ports.Transcript{}, err
	}
	if !asrLangs[lang] {
		return ports.Transcript{}, ports.E(port, "ASR", ports.KindUnsupported, "language "+lang)
	}
	if len(audio) == 0 {
		return ports.Transcript{}, ports.E(port, "ASR", ports.KindInvalid, "empty audio")
	}
	processor := "bhashini-mock"
	if lang == "doi" {
		processor = "sarvam-saaras-mock"
	}
	return ports.Transcript{Text: transcripts[lang], Language: lang, Processor: processor}, nil
}

// TTS implements ports.BhashiniPort.
func (m *Mock) TTS(ctx context.Context, text, lang string) (ports.Speech, error) {
	if err := m.faultErr(ctx, "TTS"); err != nil {
		return ports.Speech{}, err
	}
	if !ttsLangs[lang] {
		return ports.Speech{}, ports.E(port, "TTS", ports.KindUnsupported, "no TTS voice for "+lang)
	}
	if strings.TrimSpace(text) == "" {
		return ports.Speech{}, ports.E(port, "TTS", ports.KindInvalid, "empty text")
	}
	return ports.Speech{Audio: silentWAV(), MimeType: "audio/wav", Language: lang, Processor: "bhashini-mock"}, nil
}

// Health implements ports.BhashiniPort.
func (m *Mock) Health(context.Context) ports.Health {
	return ports.Health{Implementation: "mock", Status: "ok"}
}

// silentWAV is a 44-byte header for an empty 16 kHz mono PCM WAV.
func silentWAV() []byte {
	return []byte{
		'R', 'I', 'F', 'F', 36, 0, 0, 0, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ',
		16, 0, 0, 0, 1, 0, 1, 0, 0x80, 0x3e, 0, 0, 0, 0x7d, 0, 0, 2, 0, 16, 0,
		'd', 'a', 't', 'a', 0, 0, 0, 0,
	}
}
