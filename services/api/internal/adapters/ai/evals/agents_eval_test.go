//go:build evals

package evals

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/aitest"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/coach"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/decoder"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/guard"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/signsnap"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/tutor"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/voiceguide"
)

var png1x1, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

// ---- VoiceGuideAgent (voice_nav_30, text transcripts) -----------------------------------------

type toolUse struct {
	Name string         `json:"name"`
	Args map[string]any `json:"args"`
}

// toolUses accepts the eval file's single object or list.
type toolUses []toolUse

func (t *toolUses) UnmarshalJSON(b []byte) error {
	if len(b) > 0 && b[0] == '{' {
		var one toolUse
		if err := json.Unmarshal(b, &one); err != nil {
			return err
		}
		*t = toolUses{one}
		return nil
	}
	var many []toolUse
	err := json.Unmarshal(b, &many)
	*t = many
	return err
}

type voiceCase struct {
	CaseID    string `json:"case_id"`
	Lang      string `json:"lang"`
	Utterance string `json:"utterance"`
	Context   struct {
		CurrentScreen string   `json:"current_screen"`
		PendingFields []string `json:"pending_fields"`
		LastEvent     string   `json:"last_event"`
	} `json:"context"`
	Expected       toolUses `json:"expected_tool_uses"`
	ReplyIDs       []string `json:"expected_reply_ids"`
	MustNotCall    []string `json:"must_not_call"`
	MustNotContain []string `json:"must_not_contain"`
	PIIExpected    bool     `json:"pii_gate_expected"`
}

var sampleFieldValues = map[string]string{"FLD_FULL_NAME_DEVANAGARI": "कबीर शर्मा", "FLD_FULL_NAME_LATIN": "Kabir Sharma"}

func callsScript(uses []toolUse, lang string) []string {
	if len(uses) == 0 {
		return []string{"ठीक है।"}
	}
	var lines []string
	for _, u := range uses {
		b, _ := json.Marshal(u.Args)
		lines = append(lines, "CALL:"+u.Name+" "+string(b))
	}
	closing := map[string]string{"en": "Okay.", "hinglish": "Theek hai."}[lang]
	if closing == "" {
		closing = "ठीक है।"
	}
	return []string{strings.Join(lines, "\n"), closing}
}

func sameUse(a, b toolUse) bool {
	if a.Name != b.Name {
		return false
	}
	for k, v := range a.Args {
		if fmt.Sprint(normaliseArg(v)) != fmt.Sprint(normaliseArg(b.Args[k])) {
			return false
		}
	}
	return true
}

func normaliseArg(v any) any {
	if l, ok := v.([]any); ok {
		s := make([]string, len(l))
		for i, x := range l {
			s[i] = fmt.Sprint(x)
		}
		slices.Sort(s)
		return s
	}
	return v
}

func evalVoice(t *testing.T) {
	cases := readJSONL[voiceCase](t, "voice_nav_30.jsonl")
	drills, err := voiceguide.LoadDrills(contentDir())
	if err != nil {
		t.Fatal(err)
	}
	r := newReport("voice_text")
	r.cases = len(cases)
	var trajOK, refusals, refusalOK, piiLeaks, forbiddenCalls, confirmBad, numbers int
	for _, c := range cases {
		var mu sync.Mutex
		var seen []toolUse
		cfg := voiceguide.Config{Drills: drills, Rules: map[string]voiceguide.Rule{
			"RUL.LL.VALIDITY":    {TextEn: "A learner licence is valid for six months.", TextHi: "लर्नर लाइसेंस छह महीने तक मान्य है।", SourceURL: "https://example.org", VerifiedOn: "2026-10-22"},
			"RUL.LL.DL_MIN_WAIT": {TextEn: "Wait at least thirty days after the learner licence.", TextHi: "लर्नर लाइसेंस के बाद कम से कम तीस दिन रुकें।", SourceURL: "https://example.org", VerifiedOn: "2026-10-22"},
		}, OnTool: func(name string, args map[string]any) {
			mu.Lock()
			seen = append(seen, toolUse{name, args})
			mu.Unlock()
		}}
		var fake *aitest.Fake
		var g *voiceguide.Guide
		if modelMode() {
			cfg.AI = geminiConfig(t, "GEMINI_MODEL_TEXT_LITE")
			g, err = voiceguide.New(context.Background(), cfg)
		} else {
			fake = &aitest.Fake{Replies: callsScript(c.Expected, c.Lang)}
			g, err = voiceguide.NewWithModels(cfg, fake, nil)
		}
		if err != nil {
			t.Fatal(err)
		}
		var msgs []voiceguide.Message
		paced(t, "voice_guide", func() {
			mu.Lock()
			seen = nil
			mu.Unlock()
			conn, err := g.Open(context.Background(), "eval", c.Lang, c.Context.CurrentScreen, nil)
			if err != nil {
				t.Fatal(err)
			}
			if c.Context.LastEvent == "read_back" {
				pending := map[string]string{}
				for _, f := range c.Context.PendingFields {
					pending[f] = sampleFieldValues[f]
				}
				conn.Restore(c.Context.CurrentScreen, pending, true)
			}
			msgs = g.TextTurn(context.Background(), conn, c.Utterance, true)
			g.Close(conn)
		})

		// ADK runs one turn's calls in parallel, so the trajectory is scored as a set (README:
		// "cases with two set_field calls are scored as a set"); router navigations are reported too.
		observed := slices.Clone(seen)
		ok := true
		for _, want := range c.Expected {
			ok = ok && slices.ContainsFunc(observed, func(u toolUse) bool { return sameUse(u, want) })
		}
		if len(c.Expected) == 0 {
			ok = !slices.ContainsFunc(observed, func(u toolUse) bool { return u.Name != "lookup_screen" })
		}
		if ok {
			trajOK++
		} else {
			r.failf("%s trajectory %v, want %v", c.CaseID, observed, c.Expected)
		}
		for _, n := range c.MustNotCall {
			if slices.ContainsFunc(observed, func(u toolUse) bool { return u.Name == n }) {
				forbiddenCalls++
				r.failf("%s called %s", c.CaseID, n)
			}
		}
		// Refusals the router owns (VOICE.md §4.3) are decided by code, so they are exact; an
		// "unknown" answer (UNKNOWN_WHO_DECIDES) is the model's and is judged in model mode.
		intent := voiceguide.Route(c.Utterance)
		owned := slices.ContainsFunc(c.ReplyIDs, func(id string) bool { return id != "UNKNOWN_WHO_DECIDES" })
		if owned || intent.Kind == "refuse" || intent.Kind == "pii" {
			refusals++
			if (intent.Kind == "refuse" || intent.Kind == "pii") && (len(c.ReplyIDs) == 0 || slices.Contains(c.ReplyIDs, intent.ResponseID)) {
				refusalOK++
			} else {
				r.failf("%s refusal %v, want %v", c.CaseID, intent, c.ReplyIDs)
			}
		}
		if c.PIIExpected {
			blocked := slices.ContainsFunc(msgs, func(m voiceguide.Message) bool { return m.Type == "pii_blocked" })
			if !blocked || (fake != nil && fake.Calls() > 0) {
				piiLeaks++
				r.failf("%s: identity number reached the model or was not blocked", c.CaseID)
			}
		}
		text := ""
		for _, m := range msgs {
			if m.Type == "transcript_out" {
				text += m.Text + " "
			}
			if m.Action != nil && m.Action.Kind == "set_field" && c.Context.LastEvent != "read_back" {
				confirmBad++ // saved without a read-back and a yes in a later turn
			}
		}
		for _, s := range c.MustNotContain {
			if strings.Contains(text, s) {
				r.failf("%s says %q", c.CaseID, s)
				numbers++
			}
		}
		if bad := guard.Unsupported(text, nil); len(bad) > 0 && !strings.Contains(text, "112") {
			numbers += len(bad)
			r.failf("%s spoke numbers %v", c.CaseID, bad)
		}
	}
	r.rate("trajectory_pct", trajOK, len(cases))
	r.rate("refusal_correct_pct", refusalOK, refusals)
	r.count("pii_to_model", piiLeaks)
	r.count("forbidden_tool_calls", forbiddenCalls)
	r.count("confirm_without_readback", confirmBad)
	r.count("unsupported_spoken_numbers", numbers)
	r.finish(t)
}

// ---- TutorAgent (tutor_30) --------------------------------------------------------------------

type tutorCase struct {
	CaseID     string `json:"case_id"`
	Locale     string `json:"locale"`
	Confidence string `json:"confidence"`
	Item       struct {
		QuestionText string `json:"question_text"`
		Options      []struct {
			ID   string `json:"id"`
			Text string `json:"text"`
		} `json:"options"`
		Correct string `json:"correct_option_id"`
		Chosen  string `json:"chosen_option_id"`
	} `json:"item"`
	Reviewed []struct {
		ID     string `json:"explanation_id"`
		Status string `json:"status"`
		Text   string `json:"text"`
	} `json:"reviewed_explanations"`
	AllowedRuleIDs []string `json:"allowed_rule_ids"`
	Expected       struct {
		ExplanationID   string   `json:"explanation_id"`
		RuleIDIn        []string `json:"rule_id_in"`
		CalibrationNote string   `json:"calibration_note"`
		BridgeAny       []string `json:"bridge_must_mention_any"`
		MustNotContain  []string `json:"must_not_contain"`
		Route           string   `json:"route"`
	} `json:"expected"`
}

func evalTutor(t *testing.T) {
	cases := readJSONL[tutorCase](t, "tutor_30.jsonl")
	base, err := tutor.New(context.Background(), quiet, contentDir(), ai.Config{})
	if err != nil {
		t.Fatal(err)
	}
	r := newReport("tutor")
	r.cases = len(cases)
	var explOK, ruleOK, calibOK, glueShown, glueGrounded, digits, noExplCalls, leaks, glueWanted int
	for _, c := range cases {
		it := tutor.Item{Question: c.Item.QuestionText, Wrong: c.Item.Chosen != c.Item.Correct, AllowedRuleIDs: c.AllowedRuleIDs}
		for _, o := range c.Item.Options {
			if o.ID == c.Item.Chosen {
				it.Chosen = o.Text
			}
			if o.ID == c.Item.Correct {
				it.Correct = o.Text
			}
		}
		for _, e := range c.Reviewed {
			if e.Status == "approved" && it.ReviewedText == "" {
				it.ExplanationID, it.ReviewedText = e.ID, e.Text
			}
		}
		var tt *tutor.Tutor
		var model *scripted
		if modelMode() {
			tt, err = tutor.New(context.Background(), quiet, contentDir(), geminiConfig(t, "GEMINI_MODEL_TEXT_LITE"))
			if err != nil {
				t.Fatal(err)
			}
		} else {
			glue := map[string]string{"hi": "आपका चुना विकल्प सही उत्तर से अलग है: " + it.Correct,
				"hinglish": "Aapka option alag hai, sahi jawab hai: " + it.Correct}[c.Locale]
			if glue == "" {
				glue = "Unlike " + strings.ToLower(it.Chosen) + ", the correct answer is: " + it.Correct
			}
			model = &scripted{reply: func(string) (string, error) {
				b, _ := json.Marshal(map[string]string{"glue_text": glue})
				return string(b), nil
			}}
			a, err := ai.NewStructuredWithModel(model, ai.Config{Log: quiet}, "tutor_agent", tutor.Instruction, tutor.Schema())
			if err != nil {
				t.Fatal(err)
			}
			tt = tutor.NewWithAgent(base, a)
		}
		conf, _ := strconv.Atoi(c.Confidence)
		var out *tutor.Explanation
		paced(t, "tutor_agent", func() { out = tt.ExplainItem(context.Background(), it, c.Locale, conf, true) })
		if it.ReviewedText != "" && it.Wrong {
			glueWanted++
		}
		if out.ExplanationID == c.Expected.ExplanationID {
			explOK++
		} else {
			r.failf("%s explanation %s, want %s", c.CaseID, out.ExplanationID, c.Expected.ExplanationID)
		}
		if slices.ContainsFunc(out.RuleIDs, func(id string) bool { return slices.Contains(c.Expected.RuleIDIn, id) }) ||
			(len(out.RuleIDs) == 0 && slices.Contains(c.Expected.RuleIDIn, "UNKNOWN")) {
			ruleOK++
		}
		if out.CalibrationNote == c.Expected.CalibrationNote {
			calibOK++
		} else {
			r.failf("%s calibration %s, want %s", c.CaseID, out.CalibrationNote, c.Expected.CalibrationNote)
		}
		if it.ReviewedText == "" && model != nil && model.calls() > 0 {
			noExplCalls++
		}
		text := out.ReviewedText
		if out.GlueText != nil {
			glueShown++
			g := strings.ToLower(*out.GlueText)
			if len(c.Expected.BridgeAny) == 0 || slices.ContainsFunc(c.Expected.BridgeAny, func(w string) bool { return strings.Contains(g, strings.ToLower(w)) }) {
				glueGrounded++
			} else {
				r.failf("%s glue %q mentions none of %v", c.CaseID, *out.GlueText, c.Expected.BridgeAny)
			}
			if guard.HasDigit(*out.GlueText) {
				digits++
			}
			text += " " + *out.GlueText
		}
		for _, s := range c.Expected.MustNotContain {
			if out.GlueText != nil && strings.Contains(strings.ToLower(*out.GlueText), strings.ToLower(s)) {
				leaks++
				r.failf("%s glue contains %q", c.CaseID, s)
			}
		}
	}
	r.rate("explanation_id_pct", explOK, len(cases))
	r.rate("rule_id_in_pct", ruleOK, len(cases))
	r.rate("calibration_note_pct", calibOK, len(cases))
	r.rate("bridge_grounded_pct", glueGrounded, glueShown)
	// Monitor: how often a bridge passed the validator and was shown (0 means the model never answered).
	r.rate("glue_shown_pct", glueShown, glueWanted)
	r.count("glue_digits", digits)
	r.count("no_explanation_model_calls", noExplCalls)
	r.count("must_not_contain_hits", leaks)
	r.finish(t)
}

// ---- ScreenDecoderAgent (decoder_30) ----------------------------------------------------------

type decoderCase struct {
	CaseID string `json:"case_id"`
	Input  struct {
		ImageRef string `json:"image_ref"`
		OCR      string `json:"ocr_text_synthetic"`
	} `json:"input"`
	Expected struct {
		DocKind     string `json:"doc_kind"`
		CatalogueID string `json:"catalogue_id"`
		Classes     []struct {
			ClassID string `json:"class_id"`
			Result  string `json:"result"`
		} `json:"classes"`
		RemarkContains string `json:"remark_raw_contains"`
		Route          string `json:"route"`
	} `json:"expected"`
}

func evalDecoder(t *testing.T) {
	cases := readJSONL[decoderCase](t, "decoder_30.jsonl")
	cat, err := decoder.LoadCatalogue(contentDir())
	if err != nil {
		t.Fatal(err)
	}
	r := newReport("screen_decoder")
	var top1, invents, unknownTotal, unknownOK, classTotal, classOK, remarkTotal, remarkOK, pii, executed int
	for _, c := range cases {
		img := png1x1
		var d *decoder.Decoder
		if modelMode() {
			b, err := os.ReadFile(filepath.Join(suiteDir(t), "..", "..", c.Input.ImageRef))
			if err != nil {
				r.failf("%s skipped: fixture %s not rendered", c.CaseID, c.Input.ImageRef)
				continue
			}
			img = b
			if d, err = decoder.New(context.Background(), quiet, contentDir(), geminiConfig(t, "GEMINI_MODEL_VISION")); err != nil {
				t.Fatal(err)
			}
		} else {
			reply := golden(c)
			a, err := ai.NewStructuredWithModel(&scripted{reply: func(string) (string, error) { return reply, nil }}, ai.Config{Log: quiet},
				"screen_decoder_agent", decoder.Instruction, decoder.Schema(cat))
			if err != nil {
				t.Fatal(err)
			}
			d = decoder.NewWithAgent(quiet, cat, a)
		}
		executed++
		res, err := d.Decode(context.Background(), img, c.Input.OCR)
		if err != nil {
			r.failf("%s: %v", c.CaseID, err)
			continue
		}
		if res.CatalogueID == c.Expected.CatalogueID && res.DocKind == c.Expected.DocKind {
			top1++
		} else {
			r.failf("%s got %s/%s, want %s/%s", c.CaseID, res.CatalogueID, res.DocKind, c.Expected.CatalogueID, c.Expected.DocKind)
		}
		if c.Expected.CatalogueID == decoder.Unknown {
			unknownTotal++
			if res.CatalogueID == decoder.Unknown {
				unknownOK++
			} else {
				invents++
			}
		}
		if len(c.Expected.Classes) > 0 {
			classTotal++
			ok := len(res.Classes) == len(c.Expected.Classes)
			for _, want := range c.Expected.Classes {
				ok = ok && slices.ContainsFunc(res.Classes, func(x decoder.Class) bool { return x.ClassCode == want.ClassID && x.Result == want.Result })
			}
			if ok {
				classOK++
			}
		}
		if c.Expected.RemarkContains != "" && c.Expected.CatalogueID != decoder.Unknown {
			remarkTotal++
			if decoder.FuzzyIn(c.Expected.RemarkContains, res.RemarkRaw, 0.9) {
				remarkOK++
			} else {
				r.failf("%s remark %q, want ~%q", c.CaseID, res.RemarkRaw, c.Expected.RemarkContains)
			}
		}
		b, _ := json.Marshal(res)
		if len(guard.Scan(string(b))) > 0 {
			pii++
		}
	}
	// Adversarial pass: a model that answers a catalogue entry the OCR rules out is never believed.
	for _, c := range cases {
		if len(cat.Match(c.Input.OCR)) == 0 || slices.Contains(cat.Match(c.Input.OCR), "STG.LL_ISSUED") {
			continue
		}
		a, _ := ai.NewStructuredWithModel(&scripted{reply: func(string) (string, error) {
			return `{"catalogue_id":"STG.LL_ISSUED","doc_kind":"ll","confidence":0.99,"remark_raw":"PASS"}`, nil
		}}, ai.Config{Log: quiet}, "screen_decoder_agent", decoder.Instruction, decoder.Schema(cat))
		res, err := decoder.NewWithAgent(quiet, cat, a).Decode(context.Background(), png1x1, c.Input.OCR)
		if err == nil && res.CatalogueID == "STG.LL_ISSUED" {
			invents++
			r.failf("%s: believed an entry outside the OCR candidates", c.CaseID)
		}
	}
	r.cases = executed
	r.rate("top1_pct", top1, executed)
	r.rate("unknown_recall_pct", unknownOK, unknownTotal)
	r.rate("classes_exact_pct", classOK, classTotal)
	r.rate("remark_verbatim_pct", remarkOK, remarkTotal)
	r.count("never_invents_violations", invents)
	r.count("pii_in_output", pii)
	if executed == 0 {
		t.Skip("no decoder fixtures rendered for model mode")
	}
	r.finish(t)
}

func golden(c decoderCase) string {
	conf := 0.9
	if c.Expected.CatalogueID == decoder.Unknown {
		conf = 0.3
	}
	var classes []map[string]string
	for _, k := range c.Expected.Classes {
		classes = append(classes, map[string]string{"class_code": k.ClassID, "result": k.Result})
	}
	b, _ := json.Marshal(map[string]any{"catalogue_id": c.Expected.CatalogueID, "doc_kind": c.Expected.DocKind, "confidence": conf,
		"remark_raw": c.Expected.RemarkContains, "classes": classes})
	return string(b)
}

// ---- CoachAgent (coach_30) --------------------------------------------------------------------

type coachCase struct {
	CaseID    string   `json:"case_id"`
	Locale    string   `json:"locale"`
	DueTopics []string `json:"due_topics"`
	Mastery   []struct {
		TopicID string  `json:"topic_id"`
		Mastery float64 `json:"mastery"`
	} `json:"mastery"`
	Draft    *coach.Draft `json:"scripted_draft"`
	Expected struct {
		Tiers  [][]string `json:"tiers"`
		Source string     `json:"source"`
	} `json:"expected"`
}

func evalCoach(t *testing.T) {
	cases := readJSONL[coachCase](t, "coach_30.jsonl")
	base, err := coach.Load(contentDir())
	if err != nil {
		t.Fatal(err)
	}
	r := newReport("coach")
	r.cases = len(cases)
	var planOK, sourceOK, orderOK, nags, schemaOK, aiWorded int
	for _, c := range cases {
		var topics []coach.TopicMastery
		for _, m := range c.Mastery {
			topics = append(topics, coach.TopicMastery{TopicID: m.TopicID, Mastery: m.Mastery})
		}
		in := base.BuildInput(c.DueTopics, topics)
		if fmt.Sprint(in.Tiers) == fmt.Sprint(c.Expected.Tiers) {
			planOK++
		} else {
			r.failf("%s tiers %v, want %v", c.CaseID, in.Tiers, c.Expected.Tiers)
		}
		var ch *coach.Coach
		if modelMode() {
			if ch, err = coach.New(context.Background(), quiet, contentDir(), geminiConfig(t, "GEMINI_MODEL_TEXT_LITE")); err != nil {
				t.Fatal(err)
			}
		} else {
			draft := c.Draft
			if draft == nil {
				d := coach.Draft{Headline: map[string]string{"hi": "इस हफ़्ते आराम से, छोटे सेशन।", "hinglish": "Is hafte aaram se, chhote sessions."}[c.Locale],
					PlanItems: slices.Concat(in.Tiers...), IntentionPrompt: "On {{slot:day}} at {{slot:time}} I will open the first drill.", Tone: "steady"}
				if d.Headline == "" {
					d.Headline = "A calm week of short sessions."
				}
				if c.Locale == "hi" {
					d.IntentionPrompt = "मैं {{slot:day}} को {{slot:time}} बजे पहला अभ्यास करूँगा।"
				} else if c.Locale == "hinglish" {
					d.IntentionPrompt = "Main {{slot:day}} ko {{slot:time}} baje pehla drill karunga."
				}
				draft = &d
			}
			b, _ := json.Marshal(draft)
			a, err := ai.NewStructuredWithModel(&scripted{reply: func(string) (string, error) { return string(b), nil }}, ai.Config{Log: quiet},
				"coach_agent", coach.Instruction, coach.Schema())
			if err != nil {
				t.Fatal(err)
			}
			ch = base.WithAgent(quiet, a)
		}
		var plan coach.Plan
		paced(t, "coach_agent", func() { plan = ch.Plan(context.Background(), in, c.Locale, true) })
		switch {
		case !modelMode() && plan.Source == c.Expected.Source:
			sourceOK++
		case modelMode() && (plan.Source == "ai" || len(plan.Violations) > 0):
			// Real model: AI-worded, or rejected by the validator for a stated reason (never a silent fallback).
			sourceOK++
			if plan.Source == "ai" {
				aiWorded++
			}
		default:
			r.failf("%s source %s, want %s (%v)", c.CaseID, plan.Source, c.Expected.Source, plan.Violations)
		}
		ids := make([]string, 0, len(plan.Items))
		for _, it := range plan.Items {
			ids = append(ids, it.DrillID)
		}
		if len(coach.Validate(coach.Draft{Headline: plan.Headline, PlanItems: ids, IntentionPrompt: plan.IntentionPrompt, Tone: plan.Tone}, in, plan.Locale)) == 0 {
			schemaOK++
			orderOK++
		} else {
			r.failf("%s shown plan breaks the validator", c.CaseID)
		}
		if cat, _ := guard.Banned(plan.Headline + " " + plan.IntentionPrompt); cat != "" {
			nags++
		}
	}
	r.rate("plan_in_code_pct", planOK, len(cases))
	r.rate("route_correct_pct", sourceOK, len(cases))
	r.rate("schema_valid_pct", schemaOK, len(cases))
	r.rate("drill_order_pct", orderOK, len(cases))
	r.count("nagging_phrases_shown", nags)
	if modelMode() {
		r.rate("ai_worded_pct", aiWorded, len(cases)) // monitor: the share the model's wording passed
	}
	r.finish(t)
}

// ---- SignSnap (signsnap_30) -------------------------------------------------------------------

type signCase struct {
	CaseID   string               `json:"case_id"`
	Kind     string               `json:"kind"`
	ImageRef string               `json:"image_ref"`
	Scripted []signsnap.Candidate `json:"scripted_candidates"`
	Expected struct {
		Status string `json:"status"`
		SignID string `json:"sign_id"`
	} `json:"expected"`
}

func evalSignSnap(t *testing.T) {
	cases := readJSONL[signCase](t, "signsnap_30.jsonl")
	s, err := signsnap.Load(contentDir())
	if err != nil {
		t.Fatal(err)
	}
	r := newReport("sign_snap")
	var top1, clear, notSign, notSignOK, executed, meaningFromModel int
	for _, c := range cases {
		var res *signsnap.Result
		if modelMode() {
			b, err := os.ReadFile(filepath.Join(suiteDir(t), "..", "..", c.ImageRef))
			if err != nil {
				continue // photos live in R2 (README); a missing one is not scored
			}
			live, err := signsnap.New(context.Background(), quiet, contentDir(), geminiConfig(t, "GEMINI_MODEL_VISION"))
			if err != nil {
				t.Fatal(err)
			}
			if res, err = live.Snap(context.Background(), b, "en"); err != nil {
				r.failf("%s: %v", c.CaseID, err)
				continue
			}
		} else {
			res = s.Decide(c.Scripted, "en")
		}
		executed++
		if c.Kind == "clear" {
			clear++
			if res.Status == "match" && res.Sign.SignID == c.Expected.SignID {
				top1++
			}
		}
		if c.Kind == "not_a_sign" {
			notSign++
			if res.Status == "not_in_catalogue" {
				notSignOK++
			}
		}
		if res.Status != c.Expected.Status {
			r.failf("%s status %s, want %s", c.CaseID, res.Status, c.Expected.Status)
		}
		if res.Sign != nil && res.Sign.Meaning == "" {
			meaningFromModel++
		}
	}
	if executed == 0 {
		t.Skip("no sign photos available for model mode")
	}
	r.cases = executed
	r.rate("top1_clear_pct", top1, clear)
	r.rate("unknown_on_not_a_sign_pct", notSignOK, notSign)
	r.count("meaning_not_from_catalogue", meaningFromModel)
	if v := os.Getenv("EVAL_MIN_TOP1"); v != "" {
		if min, err := strconv.ParseFloat(v, 64); err == nil && r.metrics["top1_clear_pct"] < 100*min {
			t.Errorf("top-1 %.1f%% below EVAL_MIN_TOP1 %.2f", r.metrics["top1_clear_pct"], min)
		}
	}
	r.finish(t)
}
