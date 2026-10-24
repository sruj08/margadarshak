// Package tutor implements API-41 (F-31, M-04): explain the learner's wrong answer from the
// reviewed explanation. The reviewed text is always returned verbatim; an ADK agent may add one
// short "glue" sentence linking the chosen option to the correct one. Glue with a digit, banned
// wording or a length over the limit is dropped (AGENTS.md §3.4).
package tutor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"google.golang.org/genai"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
)

// ErrUnknownItem means the question variant or option is not in the bank.
var ErrUnknownItem = errors.New("tutor: unknown question, variant or option")

type localised map[string]string

type bankItem struct {
	ItemID  string    `json:"item_id"`
	Stem    localised `json:"stem"`
	Options []struct {
		ID   string    `json:"option_id"`
		Text localised `json:"text"`
	} `json:"options"`
}

type keyRow struct {
	ItemID      string   `json:"item_id"`
	Correct     string   `json:"correct_option_id"`
	Explanation string   `json:"explanation_id"`
	RuleIDs     []string `json:"rule_ids"`
}

// Explanation is the TutorExplanation response.
type Explanation struct {
	ExplanationID string   `json:"explanation_id"`
	ReviewedText  string   `json:"reviewed_text"`
	GlueText      *string  `json:"glue_text"`
	RuleIDs       []string `json:"rule_ids"`
	Source        string   `json:"source"`
}

// Tutor holds the reviewed bank and, optionally, the ADK agent.
type Tutor struct {
	log   *slog.Logger
	items map[string]*bankItem
	keys  map[string]keyRow
	expl  map[string]localised
	agent *ai.Structured
}

// New loads content/generated/ll-bank.*.json. A disabled ai.Config leaves reviewed text only.
func New(ctx context.Context, log *slog.Logger, contentDir string, cfg ai.Config) (*Tutor, error) {
	t := &Tutor{log: log, items: map[string]*bankItem{}, keys: map[string]keyRow{}, expl: map[string]localised{}}
	var bank struct {
		Items []*bankItem `json:"items"`
	}
	var key struct {
		Keys         []keyRow `json:"keys"`
		Explanations []struct {
			ID   string    `json:"explanation_id"`
			Text localised `json:"text"`
		} `json:"explanations"`
	}
	for name, dst := range map[string]any{"ll-bank.client.json": &bank, "ll-bank.practice-key.json": &key} {
		raw, err := os.ReadFile(filepath.Join(contentDir, "generated", name))
		if err != nil {
			return nil, fmt.Errorf("tutor: %w", err)
		}
		if err := json.Unmarshal(raw, dst); err != nil {
			return nil, fmt.Errorf("tutor: %s: %w", name, err)
		}
	}
	for _, it := range bank.Items {
		t.items[it.ItemID] = it
	}
	for _, k := range key.Keys {
		t.keys[k.ItemID] = k
	}
	for _, e := range key.Explanations {
		t.expl[e.ID] = e.Text
	}
	if cfg.Enabled() {
		cfg.Log = log
		a, err := ai.NewStructured(ctx, cfg, "tutor_agent", instruction, schema())
		if err != nil {
			log.WarnContext(ctx, "tutor agent disabled", "err", err)
		} else {
			t.agent = a
			log.InfoContext(ctx, "tutor agent ready (Google ADK)", "model", a.Model)
		}
	}
	return t, nil
}

// NewWithAgent injects an agent (tests use a fake model).
func NewWithAgent(t *Tutor, a *ai.Structured) *Tutor { c := *t; c.agent = a; return &c }

// Instruction and Schema are exported for tests that build a fake-model agent.
const Instruction = instruction

// Schema returns the agent's output schema.
func Schema() *genai.Schema { return schema() }

// AIEnabled reports whether glue text can be produced.
func (t *Tutor) AIEnabled() bool { return t.agent != nil }

// Explain returns the reviewed explanation for a variant and, when allowed, a glue sentence.
func (t *Tutor) Explain(ctx context.Context, questionID, variantID, chosen, locale string, useAI bool) (*Explanation, error) {
	if locale != "hi" {
		locale = "en"
	}
	id := questionID + ":" + variantID
	it, ok := t.items[id]
	if !ok {
		return nil, ErrUnknownItem
	}
	key, ok := t.keys[id]
	if !ok {
		return nil, ErrUnknownItem
	}
	text, ok := t.expl[key.Explanation]
	if !ok {
		return nil, ErrUnknownItem
	}
	var chosenText, correctText string
	for _, o := range it.Options {
		if o.ID == chosen {
			chosenText = o.Text[locale]
		}
		if o.ID == key.Correct {
			correctText = o.Text[locale]
		}
	}
	if chosenText == "" || correctText == "" {
		return nil, ErrUnknownItem
	}
	out := &Explanation{ExplanationID: key.Explanation, ReviewedText: text[locale], RuleIDs: []string{}, Source: "reviewed_bank"}
	// Rules stay empty until a second person verifies them: nothing is AI-citable yet.
	if !useAI || t.agent == nil || chosen == key.Correct {
		return out, nil
	}
	prompt := fmt.Sprintf("Language: %s\nQuestion: %s\nThe learner chose: %s\nThe correct answer is: %s\nReviewed explanation: %s\n",
		locale, ai.RedactPII(it.Stem[locale]), chosenText, correctText, out.ReviewedText)
	var a answer
	if err := t.agent.Run(ctx, prompt, &a); err != nil {
		t.log.WarnContext(ctx, "tutor glue failed; reviewed text only", "err", err)
		return out, nil
	}
	if g := strings.TrimSpace(a.GlueText); validGlue(g) {
		out.GlueText = &g
	} else {
		t.log.InfoContext(ctx, "tutor glue rejected by validator")
	}
	return out, nil
}

const instruction = `You help a learner driver understand one wrong answer on a practice question.
You are given the question, the option they chose, the correct option and the reviewed explanation.
Write "glue_text": one or two plain sentences that contrast the chosen option with the correct one.
Use only ideas from the reviewed explanation. Never add a new rule, fee, number, date or distance.
Never write a digit or number word. Never say safe, official or verified. At most 200 characters.
Write in the requested language ("en" or "hi" in Devanagari). Reply with JSON only.`

type answer struct {
	GlueText string `json:"glue_text"`
}

func schema() *genai.Schema {
	return &genai.Schema{Type: genai.TypeObject,
		Properties: map[string]*genai.Schema{"glue_text": {Type: genai.TypeString}},
		Required:   []string{"glue_text"}}
}

var (
	anyDigit    = regexp.MustCompile(`[0-9०-९₹]`)
	numberWords = regexp.MustCompile(`(?i)\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\b|तीन|चार|पाँच|दस|सौ`)
	bannedWords = regexp.MustCompile(`(?i)\b(safe|official|verified|guaranteed|dpdp|first)\b|integrated with|lives saved`)
)

func validGlue(s string) bool {
	return s != "" && len([]rune(s)) <= 200 && !anyDigit.MatchString(s) && !numberWords.MatchString(s) && !bannedWords.MatchString(s)
}
