package tutor_test

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/aitest"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/tutor"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func load(t *testing.T, cfg ai.Config) *tutor.Tutor {
	t.Helper()
	dir := filepath.Join("..", "..", "..", "..", "..", "..", "content")
	if _, err := os.Stat(filepath.Join(dir, "generated", "ll-bank.client.json")); err != nil {
		t.Skip("content/ not found")
	}
	tt, err := tutor.New(context.Background(), quiet, dir, cfg)
	require.NoError(t, err)
	return tt
}

func withFake(t *testing.T, reply string) (*tutor.Tutor, *aitest.Fake) {
	fake := &aitest.Fake{Replies: []string{reply}}
	a, err := ai.NewStructuredWithModel(fake, ai.Config{}, "tutor_agent", tutor.Instruction, tutor.Schema())
	require.NoError(t, err)
	return tutor.NewWithAgent(load(t, ai.Config{}), a), fake
}

// C-LL1-001:v1 is a stop sign; the key says option a is correct.
func TestReviewedTextOnly(t *testing.T) {
	tt := load(t, ai.Config{})
	out, err := tt.Explain(context.Background(), "C-LL1-001", "v1", "b", "en", 0, true)
	require.NoError(t, err)
	require.Equal(t, "reviewed_bank", out.Source)
	require.Contains(t, out.ReviewedText, "red octagon")
	require.Nil(t, out.GlueText, "no agent: reviewed text only")
	_, err = tt.Explain(context.Background(), "C-LL1-001", "v9", "b", "en", 0, true)
	require.ErrorIs(t, err, tutor.ErrUnknownItem)
	_, err = tt.Explain(context.Background(), "C-LL1-001", "v1", "zz", "en", 0, true)
	require.ErrorIs(t, err, tutor.ErrUnknownItem)
}

func TestGlueFromADK(t *testing.T) {
	tt, fake := withFake(t, `{"glue_text":"A crossroads sign warns of a junction; the red octagon means you must stop."}`)
	out, err := tt.Explain(context.Background(), "C-LL1-001", "v1", "b", "en", 0, true)
	require.NoError(t, err)
	require.NotNil(t, out.GlueText)
	require.Contains(t, *out.GlueText, "junction")
	require.Contains(t, fake.LastPrompt(), "Cross road", "the chosen option text is in the prompt")
}

func TestGlueRules(t *testing.T) {
	tt, _ := withFake(t, `{"glue_text":"You must stop for 3 seconds. This is the official rule."}`)
	out, err := tt.Explain(context.Background(), "C-LL1-001", "v1", "b", "en", 0, true)
	require.NoError(t, err)
	require.Nil(t, out.GlueText, "digits and banned words are dropped")
	require.NotEmpty(t, out.ReviewedText)

	tt, fake := withFake(t, `{"glue_text":"x"}`)
	_, err = tt.Explain(context.Background(), "C-LL1-001", "v1", "b", "en", 0, false)
	require.NoError(t, err)
	require.Zero(t, fake.Calls(), "no consent: the model is never called")
	_, err = tt.Explain(context.Background(), "C-LL1-001", "v1", "a", "en", 0, true)
	require.NoError(t, err)
	require.Zero(t, fake.Calls(), "a correct answer needs no glue")
}

func TestLiveGemini(t *testing.T) {
	key := os.Getenv("GEMINI_API_KEY")
	if key == "" {
		t.Skip("GEMINI_API_KEY not set")
	}
	tt := load(t, ai.Config{APIKey: key, Model: os.Getenv("GEMINI_MODEL")})
	require.True(t, tt.AIEnabled())
	out, err := tt.Explain(context.Background(), "C-LL1-001", "v1", "b", "en", 0, true)
	require.NoError(t, err)
	if out.GlueText != nil {
		t.Logf("glue: %s", *out.GlueText)
	}
	require.NotEmpty(t, out.ReviewedText)
}

func TestCalibrationGroundingAndUnknownCard(t *testing.T) {
	item := tutor.Item{Question: "What does a red eight-sided STOP sign mean?", Chosen: "Slow down and give way",
		Correct: "Stop completely, then go when clear", Wrong: true, ExplanationID: "EXP.SIGN.STOP.1",
		ReviewedText: "STOP is a mandatory sign. You must stop fully at the line.", AllowedRuleIDs: []string{"RUL.LL.SIGNS_MANDATORY"}}

	tt, fake := withFake(t, `{"glue_text":"Giving way means slowing down, but a STOP sign asks you to stop fully at the line."}`)
	out := tt.ExplainItem(context.Background(), item, "en", 100, true)
	require.Equal(t, "sure_and_wrong", out.CalibrationNote)
	require.NotNil(t, out.GlueText)
	require.Equal(t, []string{"RUL.LL.SIGNS_MANDATORY"}, out.RuleIDs)

	tt, _ = withFake(t, `{"glue_text":"Mobile phones distract drivers on highways."}`)
	require.Nil(t, tt.ExplainItem(context.Background(), item, "en", 75, true).GlueText, "V10: glue about another subject is dropped")

	item.ReviewedText = ""
	calls := fake.Calls()
	unknown := tt.ExplainItem(context.Background(), item, "en", 75, true)
	require.Equal(t, "UNKNOWN", unknown.ExplanationID)
	require.Equal(t, "template", unknown.Source)
	require.Equal(t, calls, fake.Calls(), "no approved explanation: no model call")
}
