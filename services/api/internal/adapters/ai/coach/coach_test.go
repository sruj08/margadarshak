package coach_test

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
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/coach"
)

func load(t *testing.T) *coach.Coach {
	dir := filepath.Join("..", "..", "..", "..", "..", "..", "content")
	if _, err := os.Stat(filepath.Join(dir, "catalogue", "drills.json")); err != nil {
		t.Skip("content/ not found")
	}
	c, err := coach.Load(dir)
	require.NoError(t, err)
	return c
}

func withReply(t *testing.T, c *coach.Coach, reply string) *coach.Coach {
	a, err := ai.NewStructuredWithModel(&aitest.Fake{Replies: []string{reply}}, ai.Config{}, "coach_agent", coach.Instruction, coach.Schema())
	require.NoError(t, err)
	return c.WithAgent(slog.New(slog.NewTextHandler(io.Discard, nil)), a)
}

func TestPlanInCodeAndValidatedWording(t *testing.T) {
	c := load(t)
	in := c.BuildInput([]string{"LL3"}, []coach.TopicMastery{{"LL1", 0.4}, {"LL3", 0.3}, {"LL2", 0.9}})
	require.Equal(t, [][]string{{"DR-LL-TOPIC-LL3"}, {"DR-LL-TOPIC-LL1"}, {"DR-NAZ-MOCK"}}, in.Tiers)

	tmpl := c.Plan(context.Background(), in, "hi", false)
	require.Equal(t, "template", tmpl.Source)
	require.Len(t, tmpl.Items, 3)
	require.Contains(t, tmpl.IntentionPrompt, "{{slot:day}}")

	good := `{"headline":"A calm week: signs first, then a Nazar set.","plan_items":["DR-LL-TOPIC-LL3","DR-LL-TOPIC-LL1","DR-NAZ-MOCK"],"intention_prompt":"On {{slot:day}} at {{slot:time}} I will open the signs drill.","tone":"steady"}`
	p := withReply(t, c, good).Plan(context.Background(), in, "en", true)
	require.Equal(t, "ai", p.Source)

	for _, bad := range []string{
		`{"headline":"Don't break your streak!","plan_items":["DR-LL-TOPIC-LL3","DR-LL-TOPIC-LL1","DR-NAZ-MOCK"],"intention_prompt":"On {{slot:day}} at {{slot:time}} I will play.","tone":"steady"}`,
		`{"headline":"Four sessions this week.","plan_items":["DR-LL-TOPIC-LL3","DR-LL-TOPIC-LL1","DR-NAZ-MOCK"],"intention_prompt":"On {{slot:day}} at {{slot:time}} I will play.","tone":"steady"}`,
		`{"headline":"A calm week.","plan_items":["DR-NAZ-MOCK","DR-LL-TOPIC-LL3","DR-LL-TOPIC-LL1"],"intention_prompt":"On {{slot:day}} at {{slot:time}} I will play.","tone":"steady"}`,
		`{"headline":"A calm week.","plan_items":["DR-LL-TOPIC-LL3","DR-LL-TOPIC-LL1","DR-MADE-UP"],"intention_prompt":"I will play.","tone":"steady"}`,
	} {
		require.Equal(t, "template", withReply(t, c, bad).Plan(context.Background(), in, "en", true).Source, bad)
	}
}
