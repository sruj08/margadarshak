package learn

import (
	"context"
	"regexp"
	"strconv"
	"time"
)

// MaxBatch is the API-32 batch limit.
const MaxBatch = 200

var qrefRe = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,54}$`)

// Answer is one API-32 answer as the handler hands it over. QRef is the content item ID
// (`C-LL1-001:v1`); the card is decided by the server key, never by the client.
type Answer struct {
	ClientAnswerID string
	QRef           string
	OptionID       string // "" = no answer (timeout, skipped): scored wrong
	Confidence     string // "" | 50 | 75 | 100
	LatencyMs      *int
	TimerMs        *int
	AnsweredAt     time.Time // device time; the compute service decides whether it is kept (EC-15)
	SourceSID      string
}

// AnswerResult is one API-32 result.
type AnswerResult struct {
	ClientAnswerID string    `json:"client_answer_id"`
	Correct        bool      `json:"correct"`
	Rating         int       `json:"rating"`
	Overconfident  bool      `json:"overconfident"`
	NextDueAt      time.Time `json:"next_due_at"`
	Duplicate      bool      `json:"duplicate"`
}

func validate(a Answer, i int) error {
	ptr := "/answers/" + strconv.Itoa(i)
	switch {
	case a.ClientAnswerID == "" || len(a.ClientAnswerID) > 64:
		return &ValidationError{ptr + "/client_answer_id", "invalid"}
	case !qrefRe.MatchString(a.QRef) || containsDotDot(a.QRef):
		return &ValidationError{ptr + "/question_id", "invalid"}
	case a.Confidence != "" && a.Confidence != "50" && a.Confidence != "75" && a.Confidence != "100":
		return &ValidationError{ptr + "/confidence", "invalid_enum"}
	case len(a.OptionID) > 24:
		return &ValidationError{ptr + "/option_id", "too_long"}
	case a.AnsweredAt.IsZero():
		return &ValidationError{ptr + "/answered_at", "required"}
	}
	return nil
}

func containsDotDot(s string) bool {
	for i := 0; i+1 < len(s); i++ {
		if s[i] == '.' && s[i+1] == '.' {
			return true
		}
	}
	return false
}

func logEntries(rows []LogRow) []ReviewLogEntry {
	out := make([]ReviewLogEntry, 0, len(rows))
	for _, r := range rows {
		e := ReviewLogEntry{CardID: r.CardID, Rating: r.Rating, ReviewedAt: r.ReviewedAt.UnixMilli(), Confidence: r.Confidence}
		if r.SourceKind == "session" {
			e.SourceSID = r.SourceID
		}
		out = append(out, e)
	}
	return out
}

// SubmitAnswers is API-32. A batch holds at most 200 answers. Answers are deduplicated on
// client_answer_id, inside the batch and against what is already stored, before the compute
// service sees them, so an offline queue replayed any number of times is counted once: a
// replayed answer returns its stored result with duplicate = true and adds nothing to the
// review log. Correctness comes only from the compute service's server keys.
func (s *Service) SubmitAnswers(ctx context.Context, subj Subject, batch []Answer) ([]AnswerResult, error) {
	if len(batch) == 0 {
		return nil, ErrEmptyBatch
	}
	if len(batch) > MaxBatch {
		return nil, ErrBatchTooLarge
	}
	ids := make([]string, 0, len(batch))
	for i, a := range batch {
		if err := validate(a, i); err != nil {
			return nil, err
		}
		ids = append(ids, a.ClientAnswerID)
	}
	stored, err := s.Store.AnswersByClientID(ctx, subj, ids)
	if err != nil {
		return nil, err
	}
	// First occurrence of each new client_answer_id goes to compute.
	firstIdx := map[string]int{}
	var fresh []ComputeAnswer
	for i, a := range batch {
		if _, dup := firstIdx[a.ClientAnswerID]; dup {
			continue
		}
		firstIdx[a.ClientAnswerID] = i
		if stored[a.ClientAnswerID] != nil {
			continue
		}
		ca := ComputeAnswer{ClientAnswerID: a.ClientAnswerID, QRef: a.QRef, Confidence: a.Confidence, LatencyMs: a.LatencyMs,
			TimerMs: a.TimerMs, AnsweredAt: a.AnsweredAt.UnixMilli(), SourceSID: a.SourceSID}
		if a.OptionID != "" {
			opt := a.OptionID
			ca.SelectedOptionID = &opt
		}
		fresh = append(fresh, ca)
	}
	results := map[string]*StoredAnswer{}
	inserted := map[string]bool{}
	if len(fresh) > 0 {
		logRows, err := s.Store.ReviewLog(ctx, subj)
		if err != nil {
			return nil, err
		}
		now := s.now()
		resp, err := s.Compute.Answers(ctx, AnswersRequest{Now: now.UnixMilli(), Answers: fresh, ReviewLog: logEntries(logRows)})
		if err != nil {
			return nil, err
		}
		var rows []*StoredAnswer
		logs := map[string]LogRow{}
		byID := map[string]ComputeAnswer{}
		for _, a := range fresh {
			byID[a.ClientAnswerID] = a
		}
		for _, r := range resp.Results {
			in, ok := byID[r.ClientAnswerID]
			if !ok {
				continue
			}
			correct := r.Correct
			sa := &StoredAnswer{ClientAnswerID: r.ClientAnswerID, QRef: r.QRef, CardID: r.CardID, Topic: r.Topic, Correct: r.Correct,
				Rating: r.Rating, Overconfident: r.Overconfident, Confidence: in.Confidence, AnsweredAt: time.UnixMilli(in.AnsweredAt).UTC(),
				ReviewedAt: time.UnixMilli(r.ReviewedAt).UTC(), NextDueAt: time.UnixMilli(r.NextDueAt).UTC(), ReceivedAt: now}
			rows = append(rows, sa)
			logs[r.ClientAnswerID] = LogRow{CardID: r.CardID, Rating: r.Rating, ReviewedAt: sa.ReviewedAt, SourceKind: "answer",
				SourceID: r.ClientAnswerID, Confidence: in.Confidence, Correct: &correct, Overconfident: r.Overconfident}
			results[r.ClientAnswerID] = sa
		}
		ins, err := s.Store.SaveAnswers(ctx, subj, rows, logs, resp.Cards)
		if err != nil {
			return nil, err
		}
		for _, id := range ins {
			inserted[id] = true
		}
		// A concurrent sync stored some first: return the stored result for those.
		var lost []string
		for id := range results {
			if !inserted[id] {
				lost = append(lost, id)
			}
		}
		if len(lost) > 0 {
			again, err := s.Store.AnswersByClientID(ctx, subj, lost)
			if err != nil {
				return nil, err
			}
			for id, sa := range again {
				stored[id] = sa
				delete(results, id)
			}
		}
	}
	out := make([]AnswerResult, 0, len(batch))
	for i, a := range batch {
		var sa *StoredAnswer
		dup := firstIdx[a.ClientAnswerID] != i
		if r, ok := results[a.ClientAnswerID]; ok && inserted[a.ClientAnswerID] {
			sa = r
		} else if st := stored[a.ClientAnswerID]; st != nil {
			sa, dup = st, true
		}
		if sa == nil {
			return nil, &ValidationError{"/answers/" + strconv.Itoa(i), "not_scored"}
		}
		out = append(out, AnswerResult{ClientAnswerID: a.ClientAnswerID, Correct: sa.Correct, Rating: sa.Rating,
			Overconfident: sa.Overconfident, NextDueAt: sa.NextDueAt, Duplicate: dup})
	}
	return out, nil
}

// Evidence is one SessionResult.evidence entry (game-core), appended by the games package after
// a verified session.
type Evidence struct {
	CardID        string
	Rating        int
	Confidence    string
	Overconfident bool
	Correct       *bool
}

// AppendEvidence appends a verified session's evidence to the review log (source_kind session,
// source_id = session ID). Re-appending the same session adds nothing.
func (s *Service) AppendEvidence(ctx context.Context, subj Subject, sid string, at time.Time, evidence []Evidence) (int, error) {
	rows := make([]LogRow, 0, len(evidence))
	for i, e := range evidence {
		if e.CardID == "" || e.Rating < 1 || e.Rating > 4 {
			return 0, &ValidationError{"/evidence/" + strconv.Itoa(i), "invalid"}
		}
		rows = append(rows, LogRow{CardID: e.CardID, Rating: e.Rating, ReviewedAt: at.UTC(), SourceKind: "session", SourceID: sid,
			Confidence: e.Confidence, Correct: e.Correct, Overconfident: e.Overconfident})
	}
	return s.Store.AppendLog(ctx, subj, rows)
}
