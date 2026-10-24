package speech

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

// The mock and the Sarvam adapter satisfy the same contract (D-08).
func TestSarvamAndMockContract(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "k", r.Header.Get("api-subscription-key"))
		switch r.URL.Path {
		case "/speech-to-text":
			require.NoError(t, r.ParseMultipartForm(1<<20))
			require.Equal(t, "doi-IN", r.FormValue("language_code"))
			_ = json.NewEncoder(w).Encode(map[string]string{"transcript": " मिगी लाइसेंस बनाना ऐ "})
		case "/text-to-speech":
			_ = json.NewEncoder(w).Encode(map[string][]string{"audios": {base64.StdEncoding.EncodeToString([]byte("RIFF"))}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	ctx := context.Background()
	for _, p := range []Port{NewSarvam(srv.URL, "k"), &Mock{Transcript: "मिगी लाइसेंस बनाना ऐ", Audio: []byte("RIFF")}} {
		text, err := p.STT(ctx, WAV(make([]byte, 320), 16000), "doi-IN")
		require.NoError(t, err)
		require.Equal(t, "मिगी लाइसेंस बनाना ऐ", text)
		audio, err := p.TTS(ctx, "ठीक है", "hi-IN")
		require.NoError(t, err)
		require.Equal(t, []byte("RIFF"), audio)
	}
	require.Nil(t, NewSarvam(srv.URL, ""))
	_, err := (&Mock{Fail: true}).STT(ctx, nil, "doi-IN")
	require.ErrorIs(t, err, ErrUnavailable)
}
