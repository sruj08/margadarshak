// Package clips is the Nazar clip backend (MD-217..221, NAZAR §3–§7, plan §2.8): the clip.json
// document and its status machine (a Go port of packages/clip-pipeline TRANSITIONS), the API-55
// admin operations (register, rate, blur audit, adjudicate, publish), the clip_ingest and
// clip_finalize job steps, the API-37 client projection, and the scoring lookups the games
// package needs (ScoringDocs, MockEligible, AssetURL).
//
// Go decides and persists; the maths (two-rater agreement, adjudication, manifests) runs in the
// private TypeScript compute service through ClipCompute (decision D1). Nothing here reads the
// wall clock: every time comes from the injected servertime.Clock.
//
// Persistence, compute, object storage, webhooks and jobs are local interfaces (ports.go):
// internal/store/clips.go, NewComputeVia over ports.ComputePoster, a ports.ObjectStore,
// adnotify.N8n.PostEnvelope and jobs.Service.Start, wired in internal/app/p2.go.
package clips

import "fmt"

// Status is the clip.json status (NAZAR §3.2; clip-pipeline CLIP_STATUSES).
type Status string

// Clip statuses, in clip-pipeline CLIP_STATUSES order.
const (
	StatusRaw          Status = "raw"
	StatusTranscoded   Status = "transcoded"
	StatusBlurred      Status = "blurred"
	StatusAudited      Status = "audited"
	StatusProposed     Status = "proposed"
	StatusRated        Status = "rated"
	StatusAdjudication Status = "adjudication"
	StatusPublished    Status = "published"
	StatusRetired      Status = "retired"
)

// Statuses lists every status in CLIP_STATUSES order.
var Statuses = []Status{
	StatusRaw, StatusTranscoded, StatusBlurred, StatusAudited, StatusProposed,
	StatusRated, StatusAdjudication, StatusPublished, StatusRetired,
}

// Transitions is the Go port of clip-pipeline src/status.ts TRANSITIONS (same order per row).
// TestStatus_ConformsToClipPipeline compares it with a JSON export of the TS table.
//
//	raw → transcoded → blurred ─┬→ audited → proposed ─┬→ rated → published → retired
//	                    ↺ reblur └──────────→ proposed  └→ adjudication → rated
//	any status except retired → retired
//
// AI-generated clips (ADR-0013) take raw → transcoded → proposed and never enter blurred or
// audited; filmed clips never take transcoded → proposed (IsAllowedFor).
var Transitions = map[Status][]Status{
	StatusRaw:          {StatusTranscoded, StatusRetired},
	StatusTranscoded:   {StatusBlurred, StatusProposed, StatusRetired},
	StatusBlurred:      {StatusBlurred, StatusAudited, StatusProposed, StatusRetired},
	StatusAudited:      {StatusProposed, StatusRetired},
	StatusProposed:     {StatusRated, StatusAdjudication, StatusRetired},
	StatusAdjudication: {StatusRated, StatusRetired},
	StatusRated:        {StatusPublished, StatusRetired},
	StatusPublished:    {StatusRetired},
	StatusRetired:      {},
}

// ParseStatus returns the status for s.
func ParseStatus(s string) (Status, bool) {
	st := Status(s)
	_, ok := Transitions[st]
	return st, ok
}

// IsAllowedTransition reports whether from → to is an edge of the status machine.
func IsAllowedTransition(from, to Status) bool {
	for _, t := range Transitions[from] {
		if t == to {
			return true
		}
	}
	return false
}

// AISkippedStatuses are the statuses an ai_generated clip never has (nothing real to blur).
var AISkippedStatuses = map[Status]bool{StatusBlurred: true, StatusAudited: true}

// IsAllowedFor is clip-pipeline isAllowedFor: the edge for a clip of this origin. AI clips skip
// blur and audit; filmed clips never skip them.
func IsAllowedFor(origin string, from, to Status) bool {
	if !IsAllowedTransition(from, to) {
		return false
	}
	if origin == OriginAIGenerated {
		return !AISkippedStatuses[to]
	}
	return from != StatusTranscoded || to != StatusProposed
}

// TransitionError is a disallowed edge.
type TransitionError struct{ From, To Status }

func (e *TransitionError) Error() string {
	return fmt.Sprintf("clips: %s → %s is not allowed", e.From, e.To)
}

// checkPath verifies that every edge of from → path[0] → path[1] … is allowed for a clip of
// origin and returns the final status. An empty path returns from.
func checkPath(origin string, from Status, path ...Status) (Status, error) {
	cur := from
	for _, to := range path {
		if !IsAllowedFor(origin, cur, to) {
			return from, &TransitionError{From: cur, To: to}
		}
		cur = to
	}
	return cur, nil
}

// pathTo returns the shortest forward path of ingest statuses from → to for a clip of origin
// (filmed: raw, transcoded, blurred, then proposed; ai_generated: raw, transcoded, proposed), used
// by clip.open_review, which records every ingest result at once (clip-pipeline README open
// question 7). It never passes through retired.
func pathTo(origin string, from, to Status) []Status {
	if from == to {
		return nil
	}
	type node struct {
		s    Status
		path []Status
	}
	seen := map[Status]bool{from: true}
	queue := []node{{s: from}}
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		for _, next := range Transitions[n.s] {
			if seen[next] || next == StatusRetired || !IsAllowedFor(origin, n.s, next) {
				continue
			}
			p := append(append([]Status{}, n.path...), next)
			if next == to {
				return p
			}
			seen[next] = true
			queue = append(queue, node{s: next, path: p})
		}
	}
	return nil
}
