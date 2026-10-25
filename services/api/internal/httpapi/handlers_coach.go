package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/gamecoach"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/tutor"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
)

// llTopicLabel names the LL bank topics for the summary agent (learnHub.topics in the web app).
var llTopicLabel = map[string]map[string]string{
	"LL1": {"en": "road signs", "hi": "सड़क संकेत"},
	"LL2": {"en": "road rules", "hi": "सड़क नियम"},
	"LL3": {"en": "traffic signals and hand signals", "hi": "ट्रैफ़िक सिग्नल और हाथ के इशारे"},
	"LL4": {"en": "documents and procedures", "hi": "दस्तावेज़ और प्रक्रिया"},
}

// CoachTurn is API-79: the question-wise game coach. Facts are looked up here (reviewed bank,
// hazard catalogue, code-counted tallies); the GameCoachAgent only words them.
func (s *Server) CoachTurn(w http.ResponseWriter, r *http.Request, params gen.CoachTurnParams) {
	if s.deps.GameCoach == nil || s.deps.Tutor == nil {
		serviceMissing(w, r)
		return
	}
	var body gen.CoachTurnRequest
	if !decodeJSON(w, r, &body, false) {
		return
	}
	locale := ""
	if body.Locale != nil {
		locale = string(*body.Locale)
	} else if params.AcceptLanguage != nil {
		locale = *params.AcceptLanguage
	}
	if locale = tutorLocale(locale); locale == "hinglish" {
		locale = "en"
	}
	if reason := s.aiGate(r, aiCoachFeature); reason != "" {
		aiRefused(w, r, reason, "ai_coach")
		return
	}
	gc := s.deps.GameCoach
	if !gc.AIEnabled() {
		aiUnavailable(w, r)
		return
	}
	ctx := r.Context()
	if body.Kind == gen.CoachTurnRequestKindSummary {
		s.coachSummary(w, r, body, locale)
		return
	}
	in, ok := s.coachContext(w, r, body, locale)
	if !ok {
		return
	}
	var (
		turn *gamecoach.Turn
		err  error
	)
	if body.Kind == gen.CoachTurnRequestKindReply {
		if body.FollowUp == nil || strings.TrimSpace(*body.FollowUp) == "" {
			validation(w, r, "/follow_up", "required")
			return
		}
		answer := ""
		if body.Answer != nil {
			answer = *body.Answer
		}
		turn, err = gc.Reply(ctx, in, *body.FollowUp, answer, locale)
	} else {
		turn, err = gc.Feedback(ctx, in, locale)
	}
	if err != nil {
		aiUnavailable(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"kind": body.Kind, "source": "ai", "say": turn.Say,
		"follow_up": turn.FollowUp, "verdict": turn.Verdict})
}

// coachContext resolves the question (reviewed bank) or the clip (hazard catalogue).
func (s *Server) coachContext(w http.ResponseWriter, r *http.Request, body gen.CoachTurnRequest, locale string) (gamecoach.Context, bool) {
	switch {
	case body.Game == gen.CoachTurnRequestGameLl && body.Question != nil:
		q := body.Question
		it, topic, err := s.deps.Tutor.Lookup(q.QuestionId, q.VariantId, q.ChosenOptionId, locale)
		if errors.Is(err, tutor.ErrUnknownItem) {
			notFound(w, r)
			return gamecoach.Context{}, false
		}
		return gamecoach.Context{Question: &gamecoach.Question{Topic: llTopicLabel[topic][textLangOf(locale)], Stem: it.Question,
			Chosen: it.Chosen, Correct: it.Correct, Reviewed: it.ReviewedText, Wrong: it.Wrong}}, true
	case body.Game == gen.CoachTurnRequestGameSim && body.Sim != nil:
		sm := gamecoach.Sim{Kind: string(body.Sim.Kind), Outcome: string(body.Sim.Outcome)}
		if body.Sim.Surface != nil {
			sm.Surface = string(*body.Sim.Surface)
		}
		if body.Sim.Prompt != nil {
			sm.Prompt = string(*body.Sim.Prompt)
		}
		if !gamecoach.KnownSim(sm) {
			validation(w, r, "/sim", "invalid_enum")
			return gamecoach.Context{}, false
		}
		return gamecoach.Context{Sim: &sm}, true
	case body.Game == gen.CoachTurnRequestGameNazar && body.Clip != nil:
		c := &gamecoach.Clip{}
		for i, h := range body.Clip.Hazards {
			if !s.deps.GameCoach.KnownHazard(h.HazardType) {
				validation(w, r, "/clip/hazards/"+strconv.Itoa(i)+"/hazard_type", "invalid_enum")
				return gamecoach.Context{}, false
			}
			ch := gamecoach.ClipHazard{Type: h.HazardType}
			if h.Band != nil {
				ch.Band = *h.Band
			}
			if h.Early != nil {
				ch.Early = *h.Early
			}
			c.Hazards = append(c.Hazards, ch)
		}
		if body.Clip.FalseAlarms != nil {
			c.FalseAlarms = *body.Clip.FalseAlarms
		}
		if body.Clip.Pattern != nil {
			c.Pattern = *body.Clip.Pattern
		}
		return gamecoach.Context{Clip: c}, true
	}
	switch body.Game {
	case gen.CoachTurnRequestGameLl:
		validation(w, r, "/question", "required")
	case gen.CoachTurnRequestGameSim:
		validation(w, r, "/sim", "required")
	default:
		validation(w, r, "/clip", "required")
	}
	return gamecoach.Context{}, false
}

// coachSummary tallies the session in code and lets the agent word it.
func (s *Server) coachSummary(w http.ResponseWriter, r *http.Request, body gen.CoachTurnRequest, locale string) {
	if body.Results == nil || len(*body.Results) == 0 {
		validation(w, r, "/results", "required")
		return
	}
	lang := textLangOf(locale)
	byLabel := map[string]*gamecoach.Tally{}
	var order []string
	var missed []string
	for _, row := range *body.Results {
		var label, miss string
		if body.Game == gen.CoachTurnRequestGameSim {
			if label = gamecoach.SimLabel(row.Ref, locale); label == "" {
				continue
			}
			miss = label
		} else if body.Game == gen.CoachTurnRequestGameNazar {
			if !s.deps.GameCoach.KnownHazard(row.Ref) {
				continue
			}
			label = s.deps.GameCoach.HazardLabel(row.Ref, locale)
			miss = label
		} else {
			qid, vid, _ := strings.Cut(row.Ref, ":")
			topic := s.deps.Tutor.Topic(qid, vid)
			if topic == "" {
				continue
			}
			label = llTopicLabel[topic][lang]
			miss = s.deps.Tutor.Missed(qid, vid, locale)
		}
		t := byLabel[label]
		if t == nil {
			t = &gamecoach.Tally{Label: label}
			byLabel[label] = t
			order = append(order, label)
		}
		if row.Correct {
			t.Right++
		} else {
			t.Wrong++
			if miss != "" && len(missed) < 6 {
				missed = append(missed, miss)
			}
		}
	}
	if len(order) == 0 {
		validation(w, r, "/results", "unknown_refs")
		return
	}
	tallies := make([]gamecoach.Tally, 0, len(order))
	for _, l := range order {
		tallies = append(tallies, *byLabel[l])
	}
	sum, err := s.deps.GameCoach.Summarise(r.Context(), string(body.Game), tallies, missed, locale)
	if err != nil {
		aiUnavailable(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"kind": body.Kind, "source": "ai", "say": sum.Say,
		"strengths": nonNil(sum.Strengths), "mistakes": nonNil(sum.Mistakes), "next_steps": nonNil(sum.NextSteps)})
}

// aiUnavailable is the EC-29 answer when the model is off or its draft was rejected.
func aiUnavailable(w http.ResponseWriter, r *http.Request) {
	writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "AI_UNAVAILABLE", Retryable: true,
		Detail: "the coach could not answer just now; the reviewed explanation is shown instead"})
}

func textLangOf(locale string) string {
	if locale == "hi" {
		return "hi"
	}
	return "en"
}
