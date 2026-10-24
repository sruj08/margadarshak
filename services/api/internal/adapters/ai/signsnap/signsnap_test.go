package signsnap_test

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/aitest"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/signsnap"
)

var png1x1, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

func snapper(t *testing.T, reply string) *signsnap.Snapper {
	dir := filepath.Join("..", "..", "..", "..", "..", "..", "content")
	if _, err := os.Stat(filepath.Join(dir, "catalogue", "signs.json")); err != nil {
		t.Skip("content/ not found")
	}
	s, err := signsnap.Load(dir)
	require.NoError(t, err)
	a, err := ai.NewStructuredWithModel(&aitest.Fake{Replies: []string{reply}}, ai.Config{}, "sign_snap_agent", signsnap.Instruction, s.Schema())
	require.NoError(t, err)
	return s.WithAgent(slog.New(slog.NewTextHandler(io.Discard, nil)), a)
}

func TestSnapThresholds(t *testing.T) {
	ctx := context.Background()
	r, err := snapper(t, `{"candidates":[{"sign_id":"SIGN-MAN-001","confidence":0.92}]}`).Snap(ctx, png1x1, "en")
	require.NoError(t, err)
	require.Equal(t, "match", r.Status)
	require.Equal(t, "Stop", r.Sign.Name, "the name comes from the catalogue")
	require.False(t, r.Sign.Verified)

	r, err = snapper(t, `{"candidates":[{"sign_id":"SIGN-MAN-001","confidence":0.5},{"sign_id":"MADE-UP","confidence":0.9}]}`).Snap(ctx, png1x1, "hi")
	require.NoError(t, err)
	require.Equal(t, "choose", r.Status, "an ID outside the catalogue is dropped")
	require.Len(t, r.Choices, 1)

	r, err = snapper(t, `{"candidates":[]}`).Snap(ctx, png1x1, "en")
	require.NoError(t, err)
	require.Equal(t, "not_in_catalogue", r.Status)

	_, err = snapper(t, `{}`).Snap(ctx, []byte("text"), "en")
	require.ErrorIs(t, err, signsnap.ErrBadImage)
}
