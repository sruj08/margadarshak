package httpapi

import (
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/coach"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/commentary"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/signsnap"
	"github.com/sruj08/margadarshak/services/api/internal/games"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// aiCommentaryFeature: commentary is coaching (tenant ai_coach) over voice audio (consent ai_voice).
var aiCommentaryFeature = aiFeature{flag: "ai_coach", purpose: "ai_voice"}

// ScoreCommentary is API-74: record-then-score commentary over one clip (D-12).
func (s *Server) ScoreCommentary(w http.ResponseWriter, r *http.Request, sessionId gen.SessionId) {
	if s.deps.Games == nil || s.deps.Clips == nil {
		serviceMissing(w, r)
		return
	}
	if reason := s.aiGate(r, aiCommentaryFeature); reason != "" {
		aiRefused(w, r, reason, "ai_voice")
		return
	}
	sess, _, ok := s.gamesOwnSession(w, r, sessionId)
	if !ok {
		return
	}
	if sess.GameID != games.GameNazar {
		notFound(w, r)
		return
	}
	if sess.Status != games.StatusChecked {
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "SESSION_NOT_COMPLETED", Detail: "finish the session first"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, commentary.MaxAudioBytes+64<<10)
	if err := r.ParseMultipartForm(commentary.MaxAudioBytes); err != nil {
		badRequest(w, r, "send a multipart form with the audio of one clip, up to 2 MB")
		return
	}
	ordinal, err := strconv.Atoi(r.FormValue("clip_ordinal"))
	if err != nil || ordinal < 1 || ordinal > 40 {
		validation(w, r, "/clip_ordinal", "invalid")
		return
	}
	lang := r.FormValue("lang")
	if lang == "" {
		lang = "hi"
	}
	if lang != "hi" && lang != "en" && lang != "doi" {
		validation(w, r, "/lang", "invalid_enum")
		return
	}
	file, hdr, err := r.FormFile("audio")
	if err != nil {
		validation(w, r, "/audio", "required")
		return
	}
	defer func() { _ = file.Close() }()
	audio, err := io.ReadAll(io.LimitReader(file, commentary.MaxAudioBytes+1))
	if err != nil || len(audio) == 0 || len(audio) > commentary.MaxAudioBytes {
		validation(w, r, "/audio", "too_large")
		return
	}
	var ref string
	for _, it := range sess.Items {
		if it.Kind == "clip" && it.Ordinal == ordinal {
			ref = it.Ref
		}
	}
	if ref == "" {
		validation(w, r, "/clip_ordinal", "not_in_session")
		return
	}
	info, err := s.gamesClipInfos(r.Context(), []string{ref})
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "commentary: clip windows", "err", err)
		internalError(w, r)
		return
	}
	if s.deps.Commentary == nil {
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Detail: "commentary transcription is off; your Nazar score is not affected"})
		return
	}
	mime := hdr.Header.Get("Content-Type")
	if !strings.HasPrefix(mime, "audio/") {
		mime = "audio/webm"
	}
	// shortcut: Dogri commentary also goes through Gemini, which returns word timings; Saaras
	// (the voice cascade's Dogri STT) is used once its timestamped output is wired.
	segs, err := s.deps.Commentary.Transcribe(r.Context(), audio, mime, lang)
	if err != nil {
		s.deps.Log.WarnContext(r.Context(), "commentary transcription failed", "err", err)
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Retryable: true, RetryAfter: 5 * time.Second})
		return
	}
	windows := make([]commentary.Window, 0, 2)
	for _, hw := range info[ref].Windows {
		windows = append(windows, commentary.Window{HazardType: hw.HazardType, AMs: hw.AMs, BMs: hw.BMs})
	}
	res := commentary.Match(segs, windows)
	writeJSON(w, http.StatusOK, map[string]any{"session_id": sess.ID.String(), "clip_ordinal": ordinal, "commentary_pct": res.CommentaryPct,
		"hazards": res.Hazards, "false_mentions": res.FalseMentions, "findings": res.Findings})
}

// SnapSign is API-75: Road Sign Snap.
func (s *Server) SnapSign(w http.ResponseWriter, r *http.Request, params gen.SnapSignParams) {
	if s.deps.SignSnap == nil {
		serviceMissing(w, r)
		return
	}
	if reason := s.aiGate(r, aiCoachFeature); reason != "" {
		aiRefused(w, r, reason, "ai_coach")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, signsnap.MaxImageBytes+64<<10)
	if err := r.ParseMultipartForm(signsnap.MaxImageBytes); err != nil {
		badRequest(w, r, "send a multipart form with an image up to 1 MB")
		return
	}
	if r.FormValue("moving") == "true" {
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "RIDING_LOCKED", Detail: "stop the vehicle first, then take the photo"})
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		validation(w, r, "/image", "required")
		return
	}
	defer func() { _ = file.Close() }()
	img, err := io.ReadAll(io.LimitReader(file, signsnap.MaxImageBytes+1))
	if err != nil || len(img) == 0 || len(img) > signsnap.MaxImageBytes {
		validation(w, r, "/image", "too_large")
		return
	}
	locale := ""
	if params.AcceptLanguage != nil {
		locale = tutorLocale(*params.AcceptLanguage)
	}
	res, err := s.deps.SignSnap.Snap(r.Context(), img, locale)
	switch {
	case errors.Is(err, signsnap.ErrBadImage):
		validation(w, r, "/image", "unsupported_type")
	case errors.Is(err, signsnap.ErrDisabled):
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Detail: "sign recognition is off; browse the sign list instead"})
	case err != nil:
		s.deps.Log.WarnContext(r.Context(), "sign snap failed", "err", err)
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Retryable: true, RetryAfter: 5 * time.Second})
	default:
		writeJSON(w, http.StatusOK, res)
	}
}

// GetCoachPlan is API-76: the weekly plan, computed in code and worded by the CoachAgent.
func (s *Server) GetCoachPlan(w http.ResponseWriter, r *http.Request, params gen.GetCoachPlanParams) {
	if s.deps.Coach == nil {
		serviceMissing(w, r)
		return
	}
	subj, ok := s.learnerFor(w, r, memberRef(params.FamilyMemberId))
	if !ok {
		return
	}
	var due []string
	var topics []coach.TopicMastery
	if s.deps.Learn != nil {
		if q, err := s.deps.Learn.ReviewQueue(r.Context(), subj); err == nil {
			for _, it := range q.Items {
				if it.TopicID != "" && !slices.Contains(due, it.TopicID) {
					due = append(due, it.TopicID)
				}
			}
		} else {
			s.deps.Log.WarnContext(r.Context(), "coach plan: review queue unavailable", "err", err)
		}
		if rd, err := s.deps.Learn.Readiness(r.Context(), subj); err == nil {
			for _, t := range rd.Topics {
				topics = append(topics, coach.TopicMastery{TopicID: t.TopicID, Mastery: t.Mastery})
			}
		}
	}
	locale := "en"
	if params.AcceptLanguage != nil {
		locale = tutorLocale(*params.AcceptLanguage)
	}
	useAI := s.deps.Coach.AIEnabled() && s.aiGate(r, aiCoachFeature) == ""
	writeJSON(w, http.StatusOK, s.deps.Coach.Plan(r.Context(), s.deps.Coach.BuildInput(due, topics), locale, useAI))
}

var (
	intentionTimeRe  = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
	intentionDrillRe = regexp.MustCompile(`^DR-[A-Z0-9-]{2,40}$`)
)

// SaveCoachIntention is API-76: the learner's "On <day> at <time> I will <drill>".
func (s *Server) SaveCoachIntention(w http.ResponseWriter, r *http.Request, params gen.SaveCoachIntentionParams) {
	var in gen.CoachIntention
	if !decodeJSON(w, r, &in, false) {
		return
	}
	switch {
	case !slices.Contains([]string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"}, string(in.Day)):
		validation(w, r, "/day", "invalid_enum")
		return
	case !intentionTimeRe.MatchString(in.Time):
		validation(w, r, "/time", "invalid_format")
		return
	case !intentionDrillRe.MatchString(in.DrillId):
		validation(w, r, "/drill_id", "invalid_format")
		return
	}
	subj, ok := s.learnerFor(w, r, memberRef(params.FamilyMemberId))
	if !ok {
		return
	}
	now := s.now()
	ist := now.In(servertime.IST)
	monday := time.Date(ist.Year(), ist.Month(), ist.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -((int(ist.Weekday()) + 6) % 7))
	err := s.deps.DB.Tenant(r.Context(), subj.Tenant, func(tx pgx.Tx) error {
		return store.UpsertIntention(r.Context(), tx, subj, monday, string(in.Day), in.Time, in.DrillId, now)
	})
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "coach intention failed", "err", err)
		internalError(w, r)
		return
	}
	week := monday.Format("2006-01-02")
	writeJSON(w, http.StatusCreated, map[string]any{"day": in.Day, "time": in.Time, "drill_id": in.DrillId, "week_of": week})
}

var feedbackAgents = []string{"debrief", "tutor", "coach", "voice", "decoder", "signsnap", "scam"}

// SendAIFeedback is API-77.
func (s *Server) SendAIFeedback(w http.ResponseWriter, r *http.Request, _ gen.SendAIFeedbackParams) {
	p := principalFrom(r.Context())
	if p == nil {
		writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED"})
		return
	}
	var in gen.AIFeedback
	if !decodeJSON(w, r, &in, false) {
		return
	}
	if !slices.Contains(feedbackAgents, string(in.Agent)) {
		validation(w, r, "/agent", "invalid_enum")
		return
	}
	if in.ItemId == "" || len(in.ItemId) > 80 {
		validation(w, r, "/item_id", "invalid")
		return
	}
	var reason *string
	if in.Reason != nil {
		v := string(*in.Reason)
		if !slices.Contains([]string{"wrong", "unclear", "tone", "other"}, v) {
			validation(w, r, "/reason", "invalid_enum")
			return
		}
		reason = &v
	}
	err := s.deps.DB.Tenant(r.Context(), p.Tenant, func(tx pgx.Tx) error {
		return store.InsertFeedback(r.Context(), tx, p.Tenant, p.ApplicantID, string(in.Agent), in.ItemId, in.Helpful, reason, s.now())
	})
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "ai feedback failed", "err", err)
		internalError(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetAIMetrics is API-78: per-agent LLM counters (MD-307).
func (s *Server) GetAIMetrics(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"since_restart": true, "agents": ai.Usage()})
}

// SampleAIReviews is API-78: AI-worded debriefs the calling rater has not rated (MD-327).
func (s *Server) SampleAIReviews(w http.ResponseWriter, r *http.Request, params gen.SampleAIReviewsParams) {
	actor, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	n := 30
	if params.N != nil && *params.N >= 1 && *params.N <= 30 {
		n = *params.N
	}
	t := principalFrom(r.Context()).Tenant
	var items []store.ReviewItem
	err := s.deps.DB.Tenant(r.Context(), t, func(tx pgx.Tx) error {
		var err error
		items, err = store.SampleDebriefsForReview(r.Context(), tx, t, actor.Pseudonym, n)
		return err
	})
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "review sample failed", "err", err)
		internalError(w, r)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, map[string]any{"item_id": it.ItemID, "card": it.Card})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

var reviewAgents = []string{"debrief", "tutor", "coach", "voice", "decoder", "signsnap"}

// RateAIReview is API-78: one rater's rubric scores for one item.
func (s *Server) RateAIReview(w http.ResponseWriter, r *http.Request, _ gen.RateAIReviewParams) {
	actor, ok := s.adminActor(w, r)
	if !ok {
		return
	}
	var in gen.AIReviewCreate
	if !decodeJSON(w, r, &in, false) {
		return
	}
	if !slices.Contains(reviewAgents, string(in.Agent)) {
		validation(w, r, "/agent", "invalid_enum")
		return
	}
	for ptr, v := range map[string]int{"/grounding": in.Grounding, "/tone": in.Tone, "/usefulness": in.Usefulness} {
		if v < 0 || v > 2 {
			validation(w, r, ptr, "out_of_range")
			return
		}
	}
	if in.ItemId == "" || len(in.ItemId) > 80 {
		validation(w, r, "/item_id", "invalid")
		return
	}
	t := principalFrom(r.Context()).Tenant
	err := s.deps.DB.Tenant(r.Context(), t, func(tx pgx.Tx) error {
		return store.InsertReview(r.Context(), tx, store.Review{Tenant: t, Agent: string(in.Agent), ItemID: in.ItemId, Rater: actor.Pseudonym,
			Grounding: in.Grounding, Tone: in.Tone, Usefulness: in.Usefulness, At: s.now()})
	})
	switch {
	case errors.Is(err, store.ErrConflict):
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "CONFLICT", Detail: "you already rated this item"})
	case err != nil:
		s.deps.Log.ErrorContext(r.Context(), "review rating failed", "err", err)
		internalError(w, r)
	default:
		w.WriteHeader(http.StatusCreated)
	}
}

// GetAIReviewAgreement is API-78: quadratic-weighted kappa over double-rated items.
func (s *Server) GetAIReviewAgreement(w http.ResponseWriter, r *http.Request, params gen.GetAIReviewAgreementParams) {
	if _, ok := s.adminActor(w, r); !ok {
		return
	}
	agent := "debrief"
	if params.Agent != nil {
		agent = string(*params.Agent)
	}
	t := principalFrom(r.Context()).Tenant
	var rows []store.Review
	err := s.deps.DB.Tenant(r.Context(), t, func(tx pgx.Tx) error {
		var err error
		rows, err = store.ListReviews(r.Context(), tx, t, agent)
		return err
	})
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "review agreement failed", "err", err)
		internalError(w, r)
		return
	}
	byItem := map[string][]store.Review{}
	var order []string
	for _, x := range rows {
		if _, seen := byItem[x.ItemID]; !seen {
			order = append(order, x.ItemID)
		}
		byItem[x.ItemID] = append(byItem[x.ItemID], x)
	}
	var g1, g2, t1, t2, u1, u2 []int
	disagree := []string{}
	for _, id := range order {
		rs := byItem[id]
		if len(rs) < 2 {
			continue
		}
		a, b := rs[0], rs[1] // the first two raters by pseudonym
		g1, g2 = append(g1, a.Grounding), append(g2, b.Grounding)
		t1, t2 = append(t1, a.Tone), append(t2, b.Tone)
		u1, u2 = append(u1, a.Usefulness), append(u2, b.Usefulness)
		if absInt(a.Grounding-b.Grounding) == 2 || absInt(a.Tone-b.Tone) == 2 || absInt(a.Usefulness-b.Usefulness) == 2 {
			disagree = append(disagree, id)
		}
	}
	kappa := func(a, b []int) *float64 {
		k, ok := ai.WeightedKappa(a, b, 3)
		if !ok {
			return nil
		}
		return &k
	}
	writeJSON(w, http.StatusOK, map[string]any{"agent": agent, "items_double_rated": len(g1),
		"kappa": map[string]*float64{"grounding": kappa(g1, g2), "tone": kappa(t1, t2), "usefulness": kappa(u1, u2)}, "disagreements": disagree})
}

func absInt(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
