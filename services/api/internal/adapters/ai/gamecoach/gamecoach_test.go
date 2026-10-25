package gamecoach_test

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/genai"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/aitest"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/gamecoach"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func coachWith(t *testing.T, feedback, reply, summary string) (*gamecoach.Coach, *aitest.Fake) {
	t.Helper()
	dir := filepath.Join("..", "..", "..", "..", "..", "..", "content")
	if _, err := os.Stat(filepath.Join(dir, "catalogue", "hazard_types.json")); err != nil {
		t.Skip("content/ not found")
	}
	c, err := gamecoach.New(context.Background(), quiet, dir, ai.Config{})
	require.NoError(t, err)
	require.False(t, c.AIEnabled(), "no key: no agents")
	ff := &aitest.Fake{Replies: []string{feedback}}
	agent := func(f *aitest.Fake, name, instr string, schema func() *genai.Schema) *ai.Structured {
		a, err := ai.NewStructuredWithModel(f, ai.Config{}, name, instr, schema())
		require.NoError(t, err)
		return a
	}
	fa := agent(ff, "fb", gamecoach.FeedbackInstruction, gamecoach.FeedbackSchema)
	ra := agent(&aitest.Fake{Replies: []string{reply}}, "re", gamecoach.ReplyInstruction, gamecoach.ReplySchema)
	sa := agent(&aitest.Fake{Replies: []string{summary}}, "su", gamecoach.SummaryInstruction, gamecoach.SummarySchema)
	return gamecoach.WithAgents(c, fa, ra, sa), ff
}

var stop = gamecoach.Context{Question: &gamecoach.Question{Topic: "road signs", Stem: "What does a red octagon mean?",
	Chosen: "Give way", Correct: "Stop", Reviewed: "A red octagon means stop completely.", Wrong: true}}

func TestFeedbackGroundedAndValidated(t *testing.T) {
	c, fake := coachWith(t, `{"say":"Not quite. A red octagon always means stop completely, then go when the way is clear.","follow_up":"What should you do at the stop line?"}`, `{}`, `{}`)
	out, err := c.Feedback(context.Background(), stop, "en")
	require.NoError(t, err)
	require.Contains(t, out.Say, "stop completely")
	require.NotNil(t, out.FollowUp)
	require.Contains(t, fake.LastPrompt(), "Reviewed explanation: A red octagon means stop completely.")
	require.Contains(t, fake.LastPrompt(), "Result: wrong")
}

func TestFeedbackRejectsNumbersAndWrongScript(t *testing.T) {
	for _, reply := range []string{
		`{"say":"Stop for 3 seconds at the line.","follow_up":""}`,
		`{"say":"Stop for three seconds at the line.","follow_up":""}`,
		`{"say":"That road is safe.","follow_up":""}`,
		`{"say":"Stop completely at the stop line.","follow_up":""}`, // English text for a Hindi learner
	} {
		c, _ := coachWith(t, reply, `{}`, `{}`)
		_, err := c.Feedback(context.Background(), stop, "hi")
		require.ErrorIs(t, err, gamecoach.ErrNoAnswer, reply)
	}
}

func TestClipContextUsesCatalogue(t *testing.T) {
	c, fake := coachWith(t, `{"say":"Well spotted. The bus had stopped, so you watched for someone stepping out.","follow_up":""}`, `{}`, `{}`)
	clip := gamecoach.Context{Clip: &gamecoach.Clip{Hazards: []gamecoach.ClipHazard{{Type: "bus_stop_pedestrian", Band: 1}}}}
	out, err := c.Feedback(context.Background(), clip, "en")
	require.NoError(t, err)
	require.Nil(t, out.FollowUp, "empty follow-up becomes null")
	require.Contains(t, fake.LastPrompt(), "a person stepping out at a bus stop")
	require.Contains(t, fake.LastPrompt(), "spotted early")
	require.NotContains(t, fake.LastPrompt(), "Band")
}

func TestReplyNeedsKnownVerdict(t *testing.T) {
	c, _ := coachWith(t, `{}`, `{"say":"Yes, you stop fully at the line first. Well done, carry on.","verdict":"good"}`, `{}`)
	out, err := c.Reply(context.Background(), stop, "What should you do at the stop line?", "stop fully", "en")
	require.NoError(t, err)
	require.Equal(t, "good", *out.Verdict)

	bad, _ := coachWith(t, `{}`, `{"say":"Fine.","verdict":"excellent"}`, `{}`)
	_, err = bad.Reply(context.Background(), stop, "Q?", "x", "en")
	require.ErrorIs(t, err, gamecoach.ErrNoAnswer)
}

func TestSummary(t *testing.T) {
	c, _ := coachWith(t, `{}`, `{}`, `{"say":"Good work on signals. Road signs need another look.","strengths":["Signals"],"mistakes":["Stop sign meaning"],"next_steps":["Review road signs"]}`)
	out, err := c.Summarise(context.Background(), "ll", []gamecoach.Tally{{Label: "signals", Right: 2}, {Label: "road signs", Wrong: 1}}, []string{"What does a red octagon mean?"}, "en")
	require.NoError(t, err)
	require.Len(t, out.NextSteps, 1)
}

func TestFeedbackRewritesOnceAfterABrokenRule(t *testing.T) {
	c, fake := coachWith(t, `{"say":"Keep two seconds behind the vehicle ahead.","follow_up":""}`, `{}`, `{}`)
	fake.Replies = append(fake.Replies, `{"say":"Keep the gap shown on screen behind the vehicle ahead.","follow_up":""}`)
	out, err := c.Feedback(context.Background(), stop, "en")
	require.NoError(t, err)
	require.Contains(t, out.Say, "shown on screen")
	require.Equal(t, 2, fake.Calls())
	require.Contains(t, fake.LastPrompt(), "number_word:two", "the rewrite is told which rule broke")
}

func TestSimContextIsGroundedInRoundFacts(t *testing.T) {
	c, fake := coachWith(t, `{"say":"Good stop. A lower speed in a busy street gave you room.","follow_up":""}`, `{}`, `{}`)
	sm := gamecoach.Sim{Kind: "sd_brake", Outcome: "stopped", Surface: "wet"}
	require.True(t, gamecoach.KnownSim(sm))
	require.False(t, gamecoach.KnownSim(gamecoach.Sim{Kind: "sd_brake", Outcome: "ignore rules"}))
	_, err := c.Feedback(context.Background(), gamecoach.Context{Sim: &sm}, "en")
	require.NoError(t, err)
	require.Contains(t, fake.LastPrompt(), "child stepped out")
	require.Contains(t, fake.LastPrompt(), "stopped in time")
	require.Contains(t, fake.LastPrompt(), "Road surface: wet")
}
