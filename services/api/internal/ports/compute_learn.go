package ports

// ReviewLogEntry is gamification's ReviewLogEntry.
type ReviewLogEntry struct {
	CardID     string `json:"cardId"`
	Rating     int    `json:"rating"` // 1..4
	ReviewedAt int64  `json:"reviewedAt"`
	SourceSID  string `json:"sourceSid,omitempty"`
	Confidence string `json:"confidence,omitempty"` // "50" | "75" | "100"
}

// RatedAnswer is one confidence-rated LL answer (calibration window).
type RatedAnswer struct {
	Correct    bool   `json:"correct"`
	Confidence string `json:"confidence,omitempty"`
}

// Answer is one LL answer row of /learn/answers.
type Answer struct {
	ClientAnswerID   string  `json:"client_answer_id"`
	QRef             string  `json:"qref"`               // "C-LL1-001:v1"
	SelectedOptionID *string `json:"selected_option_id"` // null = no answer (scored wrong)
	Confidence       string  `json:"confidence,omitempty"`
	LatencyMs        *int    `json:"latency_ms,omitempty"`
	TimerMs          *int    `json:"timer_ms,omitempty"`
	AnsweredAt       int64   `json:"answered_at"` // device time; EC-15 decides whether it is kept
	SourceSID        string  `json:"source_sid,omitempty"`
}

// LearnAnswersRequest is POST /learn/answers.
type LearnAnswersRequest struct {
	Now       int64            `json:"now"`
	Answers   []Answer         `json:"answers"`   // 1–200, unique client_answer_id
	ReviewLog []ReviewLogEntry `json:"reviewLog"` // at least the stored log of the touched cards
}

// AnswerResult is one result row of /learn/answers.
type AnswerResult struct {
	ClientAnswerID string  `json:"client_answer_id"`
	QRef           string  `json:"qref"`
	CardID         string  `json:"card_id"`
	Topic          string  `json:"topic"`
	Correct        bool    `json:"correct"`
	Rating         int     `json:"rating"`
	Overconfident  bool    `json:"overconfident"`
	ReviewedAt     float64 `json:"reviewed_at"`
	NextDueAt      float64 `json:"next_due_at"`
}

// CardState is gamification's CardState (stored as returned).
type CardState struct {
	CardID        string   `json:"cardId"`
	Phase         string   `json:"phase"` // new | learning | review | relearning
	Due           float64  `json:"due"`
	Stability     float64  `json:"stability"`
	Difficulty    float64  `json:"difficulty"`
	ElapsedDays   float64  `json:"elapsedDays"`
	ScheduledDays float64  `json:"scheduledDays"`
	LearningSteps float64  `json:"learningSteps"`
	Reps          float64  `json:"reps"`
	Lapses        float64  `json:"lapses"`
	LastReview    *float64 `json:"lastReview"`
	FirstReview   *float64 `json:"firstReview"`
	Reviews       float64  `json:"reviews"`
	GoodOrEasy    float64  `json:"goodOrEasy"`
}

// LearnAnswersResponse is the 200 body of /learn/answers.
type LearnAnswersResponse struct {
	Results []AnswerResult `json:"results"`
	Cards   []CardState    `json:"cards"`
}

// GateInput feeds the readiness gate.
type GateInput struct {
	LlMockPcts  []float64 `json:"llMockPcts"`
	PassMarkPct float64   `json:"passMarkPct"`
}

// LearnStateRequest is POST /learn/state.
type LearnStateRequest struct {
	Now                int64             `json:"now"`
	ReviewLog          []ReviewLogEntry  `json:"reviewLog"`
	RatedAnswers       []RatedAnswer     `json:"ratedAnswers"` // ≤ 40, oldest first
	ConceptCounts      map[string]int    `json:"conceptCounts"`
	StateCode          string            `json:"stateCode"`
	GateInput          *GateInput        `json:"gateInput,omitempty"`
	NazarScore         *float64          `json:"nazarScore,omitempty"`
	PreviousNodeStates map[string]string `json:"previousNodeStates,omitempty"`
	GameCriteriaMet    []string          `json:"gameCriteriaMet,omitempty"`
	NewCandidates      []string          `json:"newCandidates,omitempty"`
	WeekAnswers        []RatedAnswer     `json:"weekAnswers,omitempty"`
}

// TopicMastery is one entry of masteryByTopic.
type TopicMastery struct {
	Mastery            float64  `json:"mastery"`
	Coverage           float64  `json:"coverage"`
	MeanRetrievability *float64 `json:"meanRetrievability"`
	ConceptCount       float64  `json:"conceptCount"`
	Seen               float64  `json:"seen"`
	Covered            float64  `json:"covered"`
}

// DueCard is one due card of the review queue.
type DueCard struct {
	CardID         string  `json:"cardId"`
	Retrievability float64 `json:"retrievability"`
	Due            float64 `json:"due"`
}

// ReviewQueue is the review queue.
type ReviewQueue struct {
	Due                []DueCard `json:"due"`
	Fresh              []string  `json:"fresh"`
	DueRemaining       float64   `json:"dueRemaining"`
	NewIntroducedToday float64   `json:"newIntroducedToday"`
}

// TopicWeight is one readiness topic.
type TopicWeight struct {
	Topic   string  `json:"topic"`
	Mastery float64 `json:"mastery"`
	Weight  float64 `json:"weight"`
}

// Readiness is Test Readiness ("78 = knowledge 84 − calibration 6").
type Readiness struct {
	Readiness   float64       `json:"readiness"`
	Knowledge   float64       `json:"knowledge"`
	CalPenalty  float64       `json:"calPenalty"`
	Topics      []TopicWeight `json:"topics"`
	Calibration struct {
		N      float64  `json:"n"`
		OC     *float64 `json:"oc"`
		Enough bool     `json:"enough"`
	} `json:"calibration"`
	WeightsSource string `json:"weightsSource"`
	Gate          struct {
		Met               bool     `json:"met"`
		Reasons           []string `json:"reasons"`
		WeakTopics        []string `json:"weakTopics"`
		BookAnywayVisible bool     `json:"bookAnywayVisible"`
	} `json:"gate"`
}

// CalibrationBin is one stated-confidence bin.
type CalibrationBin struct {
	Stated   string   `json:"stated"`
	P        float64  `json:"p"`
	N        float64  `json:"n"`
	Accuracy *float64 `json:"accuracy"`
}

// Calibration is the calibration summary.
type Calibration struct {
	N              float64          `json:"n"`
	Brier          *float64         `json:"brier"`
	Overconfidence *float64         `json:"overconfidence"`
	Bins           []CalibrationBin `json:"bins"`
	SureAndWrong   float64          `json:"sureAndWrong"`
	Calibrated     bool             `json:"calibrated"`
}

// RoadReadiness is Road Readiness.
type RoadReadiness struct {
	Score         *float64 `json:"score"`
	KnowledgePart float64  `json:"knowledgePart"`
	NazarPart     *float64 `json:"nazarPart"`
	Modules       []string `json:"modules"`
}

// LearnStateResponse is the 200 body of /learn/state.
type LearnStateResponse struct {
	Cards          []CardState             `json:"cards"`
	MasteryByTopic map[string]TopicMastery `json:"masteryByTopic"`
	NodeStates     map[string]string       `json:"nodeStates"`
	ReviewQueue    ReviewQueue             `json:"reviewQueue"`
	Readiness      Readiness               `json:"readiness"`
	Calibration    Calibration             `json:"calibration"`
	RoadReadiness  RoadReadiness           `json:"roadReadiness"`
}

// SessionLike is the strict SessionResult subset XP and badges read.
type SessionLike struct {
	GameID string `json:"gameId"`
	Mode   string `json:"mode"`
	Score  struct {
		Pct        float64 `json:"pct"`
		CapApplied *string `json:"capApplied,omitempty"`
	} `json:"score"`
	Findings  []SessionFinding `json:"findings,omitempty"`
	Integrity SessionIntegrity `json:"integrity"`
}

// SessionFinding is a finding as XP and badges read it.
type SessionFinding struct {
	FindingID string `json:"findingId"`
	Critical  bool   `json:"critical"`
}

// SessionIntegrity is trust and flags.
type SessionIntegrity struct {
	Trust float64  `json:"trust"`
	Flags []string `json:"flags"`
}

// BadgeSession is a verified session in the badge history.
type BadgeSession struct {
	SessionLike
	CompletedAt int64 `json:"completedAt"`
}

// ReviewSitting is a review sitting (5 XP per due card).
type ReviewSitting struct {
	DueCardsReviewed int     `json:"dueCardsReviewed"`
	ReviewMinutes    float64 `json:"reviewMinutes"`
}

// StreakState is gamification's StreakState (stored as returned).
type StreakState struct {
	Status         string  `json:"status"` // active | repairable | archived
	Weeks          int     `json:"weeks"`
	Tokens         int     `json:"tokens"`
	Goal           int     `json:"goal"`
	LastClosedWeek *string `json:"lastClosedWeek"`
	ArchivedOn     string  `json:"archivedOn,omitempty"`
}

// ClosedWeek is a finished week not yet closed.
type ClosedWeek struct {
	WeekKey  string `json:"weekKey"`
	Sessions int    `json:"sessions"`
}

// KhudLicence is the self-declared licence (badge B-Khud Licence).
type KhudLicence struct {
	DLIssueDate string `json:"dlIssueDate"` // ISO date
}

// Declarations are self-declarations ("your word").
type Declarations struct {
	KhudLicence      *KhudLicence `json:"khudLicence,omitempty"`
	FirstAttemptPass *bool        `json:"firstAttemptPass,omitempty"`
}

// BadgeNazar is the Nazar Score and its eligible mock count.
type BadgeNazar struct {
	Score         *float64 `json:"score"`
	EligibleMocks int      `json:"eligibleMocks"`
}

// BadgeHistory feeds the badge evaluation.
type BadgeHistory struct {
	HasAccount               bool              `json:"hasAccount"`
	Declarations             *Declarations     `json:"declarations,omitempty"`
	Nazar                    *BadgeNazar       `json:"nazar,omitempty"`
	Answers                  []RatedAnswer     `json:"answers,omitempty"`
	Sessions                 []BadgeSession    `json:"sessions,omitempty"`
	HelmetSelfChecks         []int64           `json:"helmetSelfChecks,omitempty"`
	NodeStates               map[string]string `json:"nodeStates,omitempty"`
	NightNazarTypesMastered  *bool             `json:"nightNazarTypesMastered,omitempty"`
	GoldenHourMedicalSignOff *bool             `json:"goldenHourMedicalSignOff,omitempty"`
}

// EvaluateRequest is POST /gamification/evaluate.
type EvaluateRequest struct {
	Now                int64             `json:"now"`
	Session            *SessionLike      `json:"session,omitempty"`
	MinutesToday       float64           `json:"minutesToday"`
	SessionMinutes     float64           `json:"sessionMinutes"`
	Reviews            *ReviewSitting    `json:"reviews,omitempty"`
	XPTotal            int64             `json:"xpTotal"`
	NodeStates         map[string]string `json:"nodeStates"`
	VerifiedNazarMocks int               `json:"verifiedNazarMocks"`
	CurrentRank        *string           `json:"currentRank"` // null = none yet
	StreakState        *StreakState      `json:"streakState"` // null starts one
	StreakGoal         *int              `json:"streakGoal,omitempty"`
	WeekKey            string            `json:"weekKey"` // IST ISO week of now
	SessionsThisWeek   int               `json:"sessionsThisWeek"`
	ClosedWeeks        []ClosedWeek      `json:"closedWeeks,omitempty"`
	TestPassedAt       *int64            `json:"testPassedAt,omitempty"`
	BadgeHistory       BadgeHistory      `json:"badgeHistory"`
	EarnedBadges       []string          `json:"earnedBadges,omitempty"`
}

// XPAward is gamification's XpAward.
type XPAward struct {
	XP          float64 `json:"xp"`
	Base        float64 `json:"base"`
	Quality     float64 `json:"quality"`
	Diminish    float64 `json:"diminish"`
	TrustFactor float64 `json:"trustFactor"`
	ZeroReason  string  `json:"zeroReason,omitempty"`
}

// RankGap is what the next rank still needs.
type RankGap struct {
	Rank         string  `json:"rank"`
	XPRequired   float64 `json:"xpRequired"`
	XPMissing    float64 `json:"xpMissing"`
	NodesMissing []struct {
		Node  string `json:"node"`
		Needs string `json:"needs"`
	} `json:"nodesMissing"`
	NazarMocksMissing float64 `json:"nazarMocksMissing"`
}

// StreakView is the weekly card.
type StreakView struct {
	WeekKey  string  `json:"weekKey"`
	Dots     float64 `json:"dots"`
	Filled   float64 `json:"filled"`
	Pothole  bool    `json:"pothole"`
	Weeks    float64 `json:"weeks"`
	Archived bool    `json:"archived"`
}

// BadgeStatus is one of the 9 badge slots.
type BadgeStatus struct {
	ID         string   `json:"id"`
	Key        string   `json:"key"`
	Shape      string   `json:"shape"`
	Earned     bool     `json:"earned"`
	Available  bool     `json:"available"`
	YourWord   bool     `json:"yourWord"`
	VerifiedBy string   `json:"verifiedBy"`
	Label      *string  `json:"label"`
	Count      *float64 `json:"count,omitempty"`
}

// EvaluateResponse is the 200 body of /gamification/evaluate.
type EvaluateResponse struct {
	XP struct {
		Session *XPAward `json:"session"`
		Reviews *XPAward `json:"reviews"`
		Gained  float64  `json:"gained"`
		Total   float64  `json:"total"`
	} `json:"xp"`
	Rank struct {
		Rank     string   `json:"rank"`
		Name     string   `json:"name"`
		Shape    string   `json:"shape"`
		Next     *RankGap `json:"next"`
		Promoted bool     `json:"promoted"`
	} `json:"rank"`
	Streak struct {
		State  StreakState `json:"state"`
		Events []string    `json:"events"`
		Notify bool        `json:"notify"` // always false (DP-10)
		View   StreakView  `json:"view"`
	} `json:"streak"`
	Badges struct {
		Statuses []BadgeStatus `json:"statuses"`
		Awarded  []string      `json:"awarded"`
		Revoked  []string      `json:"revoked"`
	} `json:"badges"`
}
