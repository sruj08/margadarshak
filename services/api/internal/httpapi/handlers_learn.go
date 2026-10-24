package httpapi

// Learning handlers, API-30..33 (GAMIFICATION_ENGINE §4–§6, plan §2.4): the curriculum modules,
// the FSRS review queue, the offline answer sync and Test Readiness. The maths runs in the
// compute service behind internal/learn; these handlers map the wire shapes of api/openapi.yaml.

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/learn"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// learnItemIDRe is a question or variant ID: one segment of the compute service's qref
// (`<question_id>:<variant_id>`), so neither part may contain ':' or "..".
var learnItemIDRe = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,47}$`)

// ListModules is API-30: the curriculum for the tenant (and class, when given). The body does not
// depend on Accept-Language (titles are message keys), so the weak ETag covers content, class and
// tenant only; If-None-Match answers 304.
func (s *Server) ListModules(w http.ResponseWriter, r *http.Request, params gen.ListModulesParams) {
	if s.deps.Learn == nil || s.deps.Learn.Catalog == nil {
		serviceMissing(w, r)
		return
	}
	class := ""
	if params.ClassCode != nil {
		class = string(*params.ClassCode)
	}
	tenantID := ""
	if t := tenantFrom(r.Context()); t != nil {
		tenantID = t.TenantID
	}
	views, etag := s.deps.Learn.Catalog.List(class, tenantID)
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
	w.Header().Set("Vary", "X-Tenant")
	if learnETagMatch(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	modules := make([]gen.LearnModule, 0, len(views))
	for _, v := range views {
		games := make([]gen.GameId, 0, len(v.Games))
		for _, g := range v.Games {
			games = append(games, gen.GameId(g))
		}
		rules := append([]string{}, v.RuleIDs...)
		modules = append(modules, gen.LearnModule{ModuleId: v.ModuleID, TitleKey: v.TitleKey, Kind: gen.LearnModuleKind(v.Kind),
			ContentDepth: gen.LearnModuleContentDepth(v.ContentDepth), Games: &games, RuleIds: &rules})
	}
	writeJSON(w, http.StatusOK, map[string]any{"content_version": learnContentVersion(etag), "modules": modules})
}

// learnContentVersion is the content hash at the head of the catalog's ETag (`W/"<hash>-<class>-<tenant>"`,
// learn.Catalog.List): the same for every class and tenant, and changed exactly when the content is.
func learnContentVersion(etag string) string {
	v := strings.TrimSuffix(strings.TrimPrefix(etag, `W/"`), `"`)
	v, _, _ = strings.Cut(v, "-")
	return v
}

// learnETagMatch is the weak comparison of If-None-Match (RFC 9110 §13.1.2) against etag.
func learnETagMatch(header, etag string) bool {
	if header == "" {
		return false
	}
	want := strings.TrimPrefix(etag, "W/")
	for _, tag := range strings.Split(header, ",") {
		tag = strings.TrimSpace(tag)
		if tag == "*" || strings.TrimPrefix(tag, "W/") == want {
			return true
		}
	}
	return false
}

// GetReviewQueue is API-31: the subject's due cards (lowest retrievability first), from the cached
// card states. The package's extra fields (new concepts, due_remaining, as_of, stale) are not in
// the spec's ReviewQueue and are not sent.
func (s *Server) GetReviewQueue(w http.ResponseWriter, r *http.Request, params gen.GetReviewQueueParams) {
	if s.deps.Learn == nil {
		serviceMissing(w, r)
		return
	}
	limit := 20
	if params.Limit != nil {
		limit = *params.Limit
		if limit < 1 || limit > 100 {
			validation(w, r, "/query/limit", "out_of_range")
			return
		}
	}
	subj, ok := s.learnerFor(w, r, memberRef(params.FamilyMemberId))
	if !ok {
		return
	}
	q, err := s.deps.Learn.ReviewQueue(r.Context(), subj)
	if err != nil {
		s.learnFail(w, r, err, "review queue")
		return
	}
	items := make([]gen.ReviewItem, 0, min(limit, len(q.Items)))
	for _, it := range q.Items {
		if len(items) == limit {
			break
		}
		ret := float32(min(max(it.Retrievability, 0), 1))
		items = append(items, gen.ReviewItem{CardId: it.CardID, TopicId: it.TopicID, DueAt: it.DueAt, Retrievability: &ret})
	}
	writeJSON(w, http.StatusOK, map[string]any{"server_time": s.now().UTC(), "items": items})
}

// SubmitAnswers is API-32: an offline-sync batch of at most 200 LL answers. Each answer's item is
// `<question_id>:<variant_id>` (the compute service's qref; its server key is `q:<qref>`, D-26).
// A replayed client_answer_id returns its stored result with duplicate = true and is never counted
// twice. The Idempotency-Key middleware replays an identical request; client_answer_id dedupe
// covers a batch that was resent with more answers.
func (s *Server) SubmitAnswers(w http.ResponseWriter, r *http.Request, _ gen.SubmitAnswersParams) {
	if s.deps.Learn == nil {
		serviceMissing(w, r)
		return
	}
	var req gen.SubmitAnswersJSONBody
	if !decodeJSON(w, r, &req, false) {
		return
	}
	switch {
	case len(req.Answers) == 0:
		validation(w, r, "/answers", "required")
		return
	case len(req.Answers) > learn.MaxBatch:
		validation(w, r, "/answers", "too_many")
		return
	}
	batch := make([]learn.Answer, 0, len(req.Answers))
	for i, a := range req.Answers {
		ptr := "/answers/" + strconv.Itoa(i)
		var conf string
		if a.Confidence != nil {
			conf = string(*a.Confidence)
		}
		switch {
		case a.ClientAnswerId == "" || len(a.ClientAnswerId) > 64:
			validation(w, r, ptr+"/client_answer_id", "invalid")
			return
		case a.CardId == "":
			validation(w, r, ptr+"/card_id", "required")
			return
		case !learnItemIDRe.MatchString(a.QuestionId) || strings.Contains(a.QuestionId, ".."):
			validation(w, r, ptr+"/question_id", "invalid")
			return
		case !learnItemIDRe.MatchString(a.VariantId) || strings.Contains(a.VariantId, ".."):
			validation(w, r, ptr+"/variant_id", "invalid")
			return
		case a.Mode != "practice" && a.Mode != "mock" && a.Mode != "review":
			validation(w, r, ptr+"/mode", "invalid_enum")
			return
		case conf != "" && conf != "50" && conf != "75" && conf != "100":
			validation(w, r, ptr+"/confidence", "invalid_enum")
			return
		case a.LatencyMs != nil && *a.LatencyMs < 0:
			validation(w, r, ptr+"/latency_ms", "out_of_range")
			return
		case a.AnsweredAt.IsZero():
			validation(w, r, ptr+"/answered_at", "required")
			return
		}
		batch = append(batch, learn.Answer{ClientAnswerID: a.ClientAnswerId, QRef: a.QuestionId + ":" + a.VariantId,
			OptionID: a.OptionId, Confidence: conf, LatencyMs: a.LatencyMs, AnsweredAt: a.AnsweredAt.UTC()})
	}
	subj, ok := s.learnerFor(w, r, memberRef(req.FamilyMemberId))
	if !ok {
		return
	}
	res, err := s.deps.Learn.SubmitAnswers(r.Context(), subj, batch)
	if err != nil {
		s.learnFail(w, r, err, "submit answers")
		return
	}
	results := make([]gen.AnswerResult, 0, len(res))
	for _, a := range res {
		over, dup, due := a.Overconfident, a.Duplicate, a.NextDueAt.UTC()
		results = append(results, gen.AnswerResult{ClientAnswerId: a.ClientAnswerID, Correct: a.Correct, Rating: a.Rating,
			Overconfident: &over, Duplicate: &dup, NextDueAt: &due})
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// GetReadiness is API-33. The three numbers come from the compute service only; the gate is always
// advisory with "book anyway" visible (DP-06). When the compute service is down the last snapshot
// is served; with no snapshot at all the answer is 503. case_id is accepted for the client's
// context and does not change the computation (the pass mark is the subject's state's).
func (s *Server) GetReadiness(w http.ResponseWriter, r *http.Request, params gen.GetReadinessParams) {
	if s.deps.Learn == nil {
		serviceMissing(w, r)
		return
	}
	subj, ok := s.learnerFor(w, r, memberRef(params.FamilyMemberId))
	if !ok {
		return
	}
	v, err := s.deps.Learn.Readiness(r.Context(), subj)
	if err != nil {
		s.learnFail(w, r, err, "readiness")
		return
	}
	out := gen.Readiness{Score: v.Score, Knowledge: v.Knowledge, CalibrationPenalty: v.CalibrationPenalty}
	dk := v.DisplayKey
	out.DisplayKey = &dk
	if v.WeightsSource != "" {
		ws := v.WeightsSource
		out.WeightsSource = &ws
	}
	if v.Brier != nil {
		b := float32(min(max(*v.Brier, 0), 1))
		out.Brier = &b
	}
	out.Gate.Threshold = v.Gate.Threshold
	out.Gate.Met = v.Gate.Met
	out.Gate.Advisory = true
	out.Gate.BookAnywayVisible = true
	reasons, weak := append([]string{}, v.Gate.Reasons...), append([]string{}, v.Gate.WeakTopics...)
	out.Gate.Reasons, out.Gate.WeakTopics = &reasons, &weak
	asOf, stale := v.AsOf.UTC(), v.Stale
	if !asOf.IsZero() {
		out.AsOf = &asOf
	}
	out.Stale = &stale
	out.Topics = make([]struct {
		Coverage *float32 `json:"coverage,omitempty"`
		Mastery  *float32 `json:"mastery,omitempty"`
		TopicId  *string  `json:"topic_id,omitempty"`
		Weight   *float32 `json:"weight,omitempty"`
	}, len(v.Topics))
	for i, t := range v.Topics {
		id := t.TopicID
		weight, mastery, coverage := float32(t.Weight), float32(min(max(t.Mastery, 0), 1)), float32(min(max(t.Coverage, 0), 1))
		out.Topics[i].TopicId, out.Topics[i].Weight, out.Topics[i].Mastery, out.Topics[i].Coverage = &id, &weight, &mastery, &coverage
	}
	road := map[string]any{}
	for k, val := range v.RoadReadiness {
		road[k] = val
	}
	if mods, ok := road["modules"].([]string); ok && mods == nil {
		road["modules"] = []string{}
	}
	// The skill-tree node states of the snapshot just served (the web reads road_readiness.nodes).
	// Read from the store, not recomputed: a second compute call could only fail the same way.
	road["nodes"] = map[string]string{}
	if snap, err := s.deps.Learn.Store.LatestSnapshot(r.Context(), subj); err == nil && snap.State.NodeStates != nil {
		road["nodes"] = snap.State.NodeStates
	} else if err != nil && !errors.Is(err, learn.ErrNotFound) {
		s.deps.Log.WarnContext(r.Context(), "readiness: node states unavailable", "err", err)
	}
	out.RoadReadiness = &road
	writeJSON(w, http.StatusOK, out)
}

// learnFail maps the learn package's errors: family mode and the compute service (shared), the
// batch rules and invalid fields (422), an item without a server key (422), anything else 500.
func (s *Server) learnFail(w http.ResponseWriter, r *http.Request, err error, what string) {
	var ve *learn.ValidationError
	switch {
	case errors.Is(err, learn.ErrComputeUnavailable) || ports.IsComputeUnavailable(err):
		s.deps.Log.WarnContext(r.Context(), "learn: "+what+": compute service unavailable", "err", err)
		computeUnavailable(w, r)
	case s.learnerError(w, r, err):
	case errors.As(err, &ve):
		validation(w, r, ve.Pointer, ve.Code)
	case errors.Is(err, learn.ErrEmptyBatch):
		validation(w, r, "/answers", "required")
	case errors.Is(err, learn.ErrBatchTooLarge):
		validation(w, r, "/answers", "too_many")
	case errors.Is(err, ports.ErrComputeInvalid) && ports.ComputeProblemType(err) == "content-not-found":
		// The compute service has no server key for an item of the batch; the whole batch is
		// rejected and nothing was stored.
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED",
			Detail: "a question in this batch is not known to the server",
			Errors: []FieldError{{Pointer: "/answers", Code: "unknown_question", MessageKey: "errors.unknown_question"}}})
	default:
		s.deps.Log.ErrorContext(r.Context(), "learn: "+what+" failed", "err", err)
		internalError(w, r)
	}
}
