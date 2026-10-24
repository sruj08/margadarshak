package decoder_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/aitest"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/decoder"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// A 1x1 PNG: enough for type sniffing; the fake model never looks at it.
var png1x1, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

func fakeDecoder(t *testing.T, reply string) (*decoder.Decoder, *aitest.Fake) {
	fake := &aitest.Fake{Replies: []string{reply}}
	a, err := ai.NewStructuredWithModel(fake, ai.Config{}, "screen_decoder_agent", decoder.Instruction, decoder.Schema())
	require.NoError(t, err)
	return decoder.NewWithAgent(quiet, a), fake
}

func TestDecodeThroughADK(t *testing.T) {
	d, fake := fakeDecoder(t, `{"catalogue_id":"SAR_STAGE_SCRUTINY","doc_kind":"sarathi_status","confidence":0.86,"remark_raw":"Application pending at Scrutiny. Aadhaar 1234 5678 9012"}`)
	res, err := d.Decode(context.Background(), png1x1)
	require.NoError(t, err)
	require.Equal(t, "SAR_STAGE_SCRUTINY", res.CatalogueID)
	require.Equal(t, "decode.scrutiny.meaning", res.MeaningKey)
	require.True(t, res.ConfirmRequired, "the user must confirm before the case changes")
	require.Equal(t, "decode.scrutiny.wait_then_escalate", res.NextSteps[0].StepKey)
	require.NotContains(t, res.RemarkRaw, "1234")
	require.Equal(t, 1, fake.Calls())
	// the image part reached the model request
	var hasImage bool
	for _, c := range fake.Requests[0].Contents {
		for _, p := range c.Parts {
			hasImage = hasImage || (p.InlineData != nil && bytes.HasPrefix(p.InlineData.Data, []byte("\x89PNG")))
		}
	}
	require.True(t, hasImage)
}

func TestUnknownWhenUnsure(t *testing.T) {
	d, _ := fakeDecoder(t, `{"catalogue_id":"SAR_STAGE_APPROVED","doc_kind":"sarathi_status","confidence":0.4,"remark_raw":""}`)
	res, err := d.Decode(context.Background(), png1x1)
	require.NoError(t, err)
	require.Equal(t, decoder.Unknown, res.CatalogueID, "below 0.7 confidence the UI shows the dropdown")
	require.Empty(t, res.NextSteps)

	d, _ = fakeDecoder(t, `{"catalogue_id":"MADE_UP_STAGE","doc_kind":"other","confidence":0.99,"remark_raw":""}`)
	res, err = d.Decode(context.Background(), png1x1)
	require.NoError(t, err)
	require.Equal(t, decoder.Unknown, res.CatalogueID, "an ID outside the catalogue is never returned")
}

func TestRejectsNonImagesAndDisabled(t *testing.T) {
	d, fake := fakeDecoder(t, `{}`)
	_, err := d.Decode(context.Background(), []byte("not an image"))
	require.ErrorIs(t, err, decoder.ErrBadImage)
	require.Zero(t, fake.Calls())
	_, err = decoder.New(context.Background(), quiet, ai.Config{}).Decode(context.Background(), png1x1)
	require.ErrorIs(t, err, decoder.ErrDisabled)
}

func TestLiveGeminiNonStatusImage(t *testing.T) {
	key := os.Getenv("GEMINI_API_KEY")
	if key == "" {
		t.Skip("GEMINI_API_KEY not set")
	}
	d := decoder.New(context.Background(), quiet, ai.Config{APIKey: key, Model: os.Getenv("GEMINI_MODEL")})
	require.True(t, d.AIEnabled())
	res, err := d.Decode(context.Background(), png1x1)
	require.NoError(t, err)
	t.Logf("%+v", res)
	require.Equal(t, decoder.Unknown, res.CatalogueID, "a blank pixel is not a status page")
}
