package clips

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// ParseRef parses `clip:JMU-0012@3` or `JMU-0012@3`.
func ParseRef(ref string) (clipID string, version int, err error) {
	r := strings.TrimPrefix(ref, "clip:")
	id, v, ok := strings.Cut(r, "@")
	if !ok || !ValidClipID(id) {
		return "", 0, &ValidationError{"/ref", "invalid"}
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return "", 0, &ValidationError{"/ref", "invalid"}
	}
	return id, n, nil
}

// ScoringHazard is a game-core NazarHazard.
type ScoringHazard struct {
	HazardID   string `json:"hazardId"`
	HazardType string `json:"hazardType"`
	Window     Window `json:"window"`
}

// ScoringClip is the game-core NazarClip the verifier takes inline (/verify content.items),
// the same projection as clip-pipeline toScoringClip.
type ScoringClip struct {
	ClipID        string          `json:"clipId"`
	Version       int             `json:"version"`
	SpeedKmhEst   float64         `json:"speedKmhEst"`
	DurationMs    int             `json:"durationMs"`
	Hazards       []ScoringHazard `json:"hazards"`
	QuietSegments []QuietSegment  `json:"quietSegments"`
}

func scoringClip(c *Clip) (*ScoringClip, error) {
	if (c.Status != StatusPublished && c.Status != StatusRetired) || c.Doc.SpeedKmhEst == nil {
		return nil, fmt.Errorf("%w: %s", ErrNotScorable, c.Ref())
	}
	sc := &ScoringClip{ClipID: c.ClipID, Version: c.Version, SpeedKmhEst: *c.Doc.SpeedKmhEst, DurationMs: c.Doc.DurationMs,
		Hazards: []ScoringHazard{}, QuietSegments: append([]QuietSegment{}, c.Doc.QuietSegments...)}
	for _, h := range c.Doc.Hazards {
		sc.Hazards = append(sc.Hazards, ScoringHazard{HazardID: h.HazardID, HazardType: h.HazardType, Window: h.Window})
	}
	return sc, nil
}

// ScoringDoc is the scoring document of a published or retired clip version: what the store
// caches in content.clip_scoring (ErrNotScorable for any other status).
func ScoringDoc(c *Clip) (json.RawMessage, error) {
	sc, err := scoringClip(c)
	if err != nil {
		return nil, err
	}
	return json.Marshal(sc)
}

// ScoringDocs returns the scoring documents for item refs, in order, for the games package to
// send inline to /verify. Server-side only: these carry hazard windows.
func (s *Service) ScoringDocs(ctx context.Context, refs []string) ([]json.RawMessage, error) {
	out := make([]json.RawMessage, 0, len(refs))
	for _, ref := range refs {
		id, v, err := ParseRef(ref)
		if err != nil {
			return nil, err
		}
		c, err := s.Store.GetClip(ctx, id, v)
		if err != nil {
			return nil, err
		}
		sc, err := scoringClip(c)
		if err != nil {
			return nil, err
		}
		raw, err := json.Marshal(sc)
		if err != nil {
			return nil, err
		}
		out = append(out, raw)
	}
	return out, nil
}

// Item is a playable clip for session selection.
type Item struct {
	Ref            string `json:"ref"` // clip:JMU-0012@3 (game-core ItemRef)
	ClipID         string `json:"clip_id"`
	Version        int    `json:"version"`
	ContentVersion string `json:"content_version"`
	DurationMs     int    `json:"duration_ms"`
	Difficulty     *int   `json:"difficulty,omitempty"`
}

// MockEligible returns up to n mock-eligible published clips for state, excluding refs (seen
// clips), ordered by curator difficulty then ref so the caller's seeded selection is
// deterministic. It returns what it found plus ErrNotEnoughClips when fewer than n exist
// (API-34 409 NO_UNSEEN_CLIPS).
func (s *Service) MockEligible(ctx context.Context, state string, exclude []string, n int) ([]Item, error) {
	clips, err := s.Store.ListClips(ctx, ListFilter{Status: []Status{StatusPublished}, Tenant: state})
	if err != nil {
		return nil, err
	}
	skip := map[string]bool{}
	for _, r := range exclude {
		skip[strings.TrimPrefix(r, "clip:")] = true
	}
	var items []Item
	for _, c := range clips {
		if !c.MockEligible || skip[c.Ref()] || (state != "" && !hasTag(c.Doc.TenantTags, state)) {
			continue
		}
		items = append(items, Item{Ref: "clip:" + c.Ref(), ClipID: c.ClipID, Version: c.Version,
			ContentVersion: strconv.Itoa(c.Version), DurationMs: c.Doc.DurationMs, Difficulty: c.Doc.Difficulty.Curator})
	}
	sort.Slice(items, func(i, j int) bool {
		di, dj := diffOf(items[i]), diffOf(items[j])
		if di != dj {
			return di < dj
		}
		return items[i].Ref < items[j].Ref
	})
	if len(items) < n {
		return items, ErrNotEnoughClips
	}
	return items[:n], nil
}

func diffOf(it Item) int {
	if it.Difficulty == nil {
		return 0
	}
	return *it.Difficulty
}

// AssetURL returns the 360p media URL (presigned per session unless MEDIA_PUBLIC_BASE_URL is
// set), its sha256 and size, for a published clip ref.
func (s *Service) AssetURL(ctx context.Context, ref string, sid uuid.UUID) (url, sha string, bytes int64, err error) {
	id, v, err := ParseRef(ref)
	if err != nil {
		return "", "", 0, err
	}
	c, err := s.Store.GetClip(ctx, id, v)
	if err != nil {
		return "", "", 0, err
	}
	if c.Status != StatusPublished {
		return "", "", 0, fmt.Errorf("%w: %s", ErrNotScorable, c.Ref())
	}
	m, ok := c.Doc.MediaFor("360p")
	if !ok {
		return "", "", 0, errors.New("clips: no 360p rendition")
	}
	u, err := s.mediaURL(ctx, MediaObjectKey(id, v, "360p"))
	if err != nil {
		return "", "", 0, err
	}
	s.log().DebugContext(ctx, "clip asset url issued", "clip", c.Ref(), "sid", sid)
	return u, m.SHA256, m.Bytes, nil
}

// RaterOnset is one raters.csv row source: the two raters' onsets of the first matched hazard
// pair of a clip (field kit H4, per clip), from the stored agreement (raw pairs, before any
// adjudication).
type RaterOnset struct {
	ClipID        string
	RaterAOnsetMs int
	RaterBOnsetMs int
}

// RaterOnsets returns one row per clip ID that has a stored agreement with a matched pair.
func (s *Service) RaterOnsets(ctx context.Context, clipIDs []string) ([]RaterOnset, error) {
	var out []RaterOnset
	for _, id := range clipIDs {
		c, err := s.Store.GetClip(ctx, id, 0)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if len(c.Agreement) == 0 {
			continue
		}
		var g AgreementResult
		if err := json.Unmarshal(c.Agreement, &g); err != nil || len(g.Pairs) == 0 {
			continue
		}
		p := g.Pairs[0]
		for _, q := range g.Pairs[1:] {
			if q.A.AMs < p.A.AMs {
				p = q
			}
		}
		out = append(out, RaterOnset{ClipID: c.ClipID, RaterAOnsetMs: p.A.AMs, RaterBOnsetMs: p.B.AMs})
	}
	return out, nil
}
