package ai_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/aitest"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/guard"
)

func TestEC29_BreakerOpensAfterThreeFailuresAndSkipsTheModel(t *testing.T) {
	fake := &aitest.Fake{Replies: []string{"not json", "not json", "not json", `{"a":"b"}`}}
	s, err := ai.NewStructuredWithModel(fake, ai.Config{}, "breaker_test", "say json", nil)
	require.NoError(t, err)
	var out map[string]string
	for range 3 {
		require.Error(t, s.Run(context.Background(), "x", &out))
	}
	assert.True(t, s.Open())
	assert.True(t, errors.Is(s.Run(context.Background(), "x", &out), ai.ErrCircuitOpen))
	assert.Equal(t, 3, fake.Calls(), "an open breaker never calls the model")

	var stats ai.AgentStats
	for _, st := range ai.Usage() {
		if st.Agent == "breaker_test" {
			stats = st
		}
	}
	assert.EqualValues(t, 3, stats.Calls)
	assert.EqualValues(t, 3, stats.Failures)
	assert.True(t, stats.BreakerOpen)
}

func TestWeightedKappa(t *testing.T) {
	k, ok := ai.WeightedKappa([]int{0, 1, 2, 2}, []int{0, 1, 2, 2}, 3)
	assert.True(t, ok)
	assert.InDelta(t, 1.0, k, 1e-9)
	k, _ = ai.WeightedKappa([]int{0, 2, 0, 2}, []int{2, 0, 2, 0}, 3)
	assert.Less(t, k, 0.0, "systematic opposite scores")
	_, ok = ai.WeightedKappa([]int{1}, []int{1}, 3)
	assert.False(t, ok)
}

func TestCanaryLeakIsRejected(t *testing.T) {
	fake := &aitest.Fake{Replies: []string{`{"a":"` + guard.Canary + `"}`}}
	s, err := ai.NewStructuredWithModel(fake, ai.Config{}, "canary_test", "say json", nil)
	require.NoError(t, err)
	var out map[string]string
	require.Error(t, s.Run(context.Background(), "x", &out))
	assert.Contains(t, fake.LastInstruction(), guard.Canary)
}
