package study

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// Forms rotate in order of arrival (FIELD_STUDY §4.2, DEC-017).
var Forms = [3]string{"A", "B", "C"}

var (
	codeRe        = regexp.MustCompile(`^P-\d{3,}$`)
	ageBands      = map[string]bool{"18_20": true, "21_24": true, "25_34": true, "35_plus": true}
	licenceHeld   = map[string]bool{"ll": true, "2w": true, "4w": true, "both": true}
	yearsDriving  = map[string]bool{"0_1": true, "1_3": true, "3_plus": true}
	nearMissLimit = 140
)

// EnrolInput is the consent screen and the band questions (FIELD_STUDY §4.3 steps 1–2).
type EnrolInput struct {
	// ConsentGiven is the "[ I am 18+ and agree ]" button; false ("No thanks") stores nothing.
	ConsentGiven bool
	// AgeOK is the 18+ confirmation (age_ok in the export).
	AgeOK        bool
	AgeBand      string
	LicenceHeld  string
	YearsDriving string
	RetakeOf     string // optional earlier participant code (test-retest)
}

// FormFor returns the form for the n-th arrival (1-based): A, B, C, A, …
func FormFor(seq int) string { return Forms[(seq-1)%3] }

// Enrol enrols the subject. Declining consent or declaring under 18 returns before anything is
// read or written. It needs an active field_study consent artefact (recorded through API-60 on
// the consent screen). Enrolling twice returns the existing participant; a retake is a new
// participant with retake_of set.
func (s *Service) Enrol(ctx context.Context, subj Subject, in EnrolInput) (*Participant, error) {
	if !in.ConsentGiven {
		return nil, ErrDeclined
	}
	if !in.AgeOK {
		return nil, ErrUnder18
	}
	switch {
	case !ageBands[in.AgeBand]:
		return nil, &ValidationError{"/age_band", "invalid_enum"}
	case !licenceHeld[in.LicenceHeld]:
		return nil, &ValidationError{"/licence_held", "invalid_enum"}
	case !yearsDriving[in.YearsDriving]:
		return nil, &ValidationError{"/years_driving", "invalid_enum"}
	case in.RetakeOf != "" && !codeRe.MatchString(in.RetakeOf):
		return nil, &ValidationError{"/retake_of", "invalid"}
	}
	consentID, ok, err := s.Consents.ActiveConsent(ctx, subj.Tenant, subj.ApplicantID, "field_study")
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrConsentRequired
	}
	mine, err := s.Store.ParticipantsByApplicant(ctx, subj.Tenant, subj.ApplicantID)
	if err != nil {
		return nil, err
	}
	if in.RetakeOf == "" {
		for _, p := range mine {
			if p.WithdrawnAt == nil && p.RetakeOf == "" {
				return p, nil
			}
		}
	} else {
		prev, err := s.Store.GetParticipant(ctx, subj.Tenant, in.RetakeOf)
		if errors.Is(err, ErrNotFound) || (err == nil && prev.ApplicantID != subj.ApplicantID) {
			return nil, &ValidationError{"/retake_of", "unknown_participant"}
		}
		if err != nil {
			return nil, err
		}
		for _, p := range mine {
			if p.RetakeOf == in.RetakeOf && p.WithdrawnAt == nil {
				return p, nil
			}
		}
	}
	seq, err := s.Store.NextSeq(ctx, subj.Tenant)
	if err != nil {
		return nil, err
	}
	p := &Participant{Code: fmt.Sprintf("P-%03d", seq), Tenant: subj.Tenant, ApplicantID: subj.ApplicantID, ConsentID: consentID,
		AgeBand: in.AgeBand, LicenceHeld: in.LicenceHeld, YearsDriving: in.YearsDriving, AgeOK: true, Form: FormFor(seq), Seq: seq,
		RetakeOf: in.RetakeOf, CreatedAt: s.now()}
	if err := s.Store.InsertParticipant(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// owned loads code and checks it belongs to subj and has not withdrawn.
func (s *Service) owned(ctx context.Context, subj Subject, code string) (*Participant, error) {
	p, err := s.Store.GetParticipant(ctx, subj.Tenant, code)
	if err != nil {
		return nil, err
	}
	if p.ApplicantID != subj.ApplicantID {
		return nil, ErrNotFound
	}
	if p.WithdrawnAt != nil {
		return nil, ErrWithdrawn
	}
	return p, nil
}

// NearMiss stores the optional one-line answer (≤ 140 characters, no PII; study table only, never
// shown publicly without a quote consent).
func (s *Service) NearMiss(ctx context.Context, subj Subject, code, text string) error {
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > nearMissLimit {
		return &ValidationError{"/text", "length"}
	}
	if len(nearMissFindings(text)) > 0 {
		return &ValidationError{"/text", "PROHIBITED_FIELD"}
	}
	p, err := s.owned(ctx, subj, code)
	if err != nil {
		return err
	}
	p.NearMissText = text
	return s.Store.UpdateParticipant(ctx, p)
}

// Withdraw marks the participant withdrawn ("Delete my data", FIELD_STUDY §6.3); exports stop
// including them at once and the retention job deletes the rows within 7 days.
func (s *Service) Withdraw(ctx context.Context, subj Subject, code string) error {
	p, err := s.owned(ctx, subj, code)
	if errors.Is(err, ErrWithdrawn) {
		return nil
	}
	if err != nil {
		return err
	}
	now := s.now()
	p.WithdrawnAt, p.NearMissText = &now, ""
	return s.Store.UpdateParticipant(ctx, p)
}

// FormItems returns the item refs of a participant's phase (used by the games package when it
// starts a study session): ll_mock is the fixed 15-question set; test, feedback and fresh follow
// the participant's form. Form A: test B1+B2, fresh B3 · B: test B2+B3, fresh B1 · C: test
// B1+B3, fresh B2. The feedback replay uses the first two test clips.
func (s *Service) FormItems(ctx context.Context, tenant, code, phase string) ([]string, error) {
	p, err := s.Store.GetParticipant(ctx, tenant, code)
	if err != nil {
		return nil, err
	}
	if p.WithdrawnAt != nil {
		return nil, ErrWithdrawn
	}
	b, err := s.Store.FormBlocks(ctx, tenant)
	if err != nil {
		return nil, err
	}
	return ItemsFor(b, p.Form, phase)
}

// ItemsFor is FormItems over given blocks.
func ItemsFor(b *Blocks, form, phase string) ([]string, error) {
	if b == nil || len(b.B1) != 5 || len(b.B2) != 5 || len(b.B3) != 5 || len(b.LLSet) != 15 {
		return nil, ErrBlocksNotReady
	}
	var test, fresh []string
	switch form {
	case "A":
		test, fresh = concat(b.B1, b.B2), b.B3
	case "B":
		test, fresh = concat(b.B2, b.B3), b.B1
	case "C":
		test, fresh = concat(b.B1, b.B3), b.B2
	default:
		return nil, &ValidationError{"/form", "invalid"}
	}
	switch phase {
	case PhaseLLMock:
		return append([]string{}, b.LLSet...), nil
	case PhaseTest:
		return test, nil
	case PhaseFeedback:
		return append([]string{}, test[:2]...), nil
	case PhaseFresh:
		return append([]string{}, fresh...), nil
	}
	return nil, ErrUnknownPhase
}

func concat(a, b []string) []string { return append(append([]string{}, a...), b...) }

// BlockClip is a usable study clip and its curator difficulty.
type BlockClip struct {
	Ref        string
	Difficulty int
}

// BalanceBlocks splits the 15 hardest usable clips into three blocks of 5 balanced on curator
// difficulty: sorted by difficulty (then ref), dealt in snake order B1 B2 B3 B3 B2 B1 …, so block
// difficulty sums differ by at most one round's spread.
func BalanceBlocks(clips []BlockClip) ([3][]string, error) {
	var out [3][]string
	if len(clips) < 15 {
		return out, ErrNotEnoughBlocks
	}
	cs := append([]BlockClip{}, clips...)
	sort.Slice(cs, func(i, j int) bool {
		if cs[i].Difficulty != cs[j].Difficulty {
			return cs[i].Difficulty > cs[j].Difficulty
		}
		return cs[i].Ref < cs[j].Ref
	})
	for i, c := range cs[:15] {
		round, pos := i/3, i%3
		if round%2 == 1 {
			pos = 2 - pos
		}
		out[pos] = append(out[pos], c.Ref)
	}
	return out, nil
}
