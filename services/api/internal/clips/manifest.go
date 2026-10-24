package clips

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// MediaObjectKey mirrors clip-pipeline mediaObjectKey: clips/<id>/v<n>/<res>.mp4.
func MediaObjectKey(clipID string, version int, res string) string {
	return fmt.Sprintf("clips/%s/v%d/%s.mp4", clipID, version, res)
}

// PosterObjectKey mirrors clip-pipeline artefactKey(…, "poster").
func PosterObjectKey(clipID string, version int) string {
	return fmt.Sprintf("clips/%s/v%d/poster.jpg", clipID, version)
}

// ClipQuery is the API-37 query.
type ClipQuery struct {
	State      string   // tenant tag filter (state=JK)
	Resolution string   // 360p (default) | 480p: which rendition `bytes`, `sha256` and `total_bytes` describe
	Seen       []string // exclude_seen: refs (`JMU-0012@3`) the session's subject has already played
	Cursor     string   // last clip_id of the previous page
	Limit      int      // default 50, max 200
}

// ClipListItem is one API-37 entry. It is an allowlist: there is no field for hazard windows,
// hazard types or counts, quiet segments, cues or speed, so none can leak (NAZAR §3.2: windows
// are never shipped before a session completes; the verifier's client manifest is just as strict).
type ClipListItem struct {
	ClipID       string   `json:"clip_id"`
	Ref          string   `json:"ref"`
	Version      int      `json:"version"`
	State        string   `json:"state"`
	TenantTags   []string `json:"tenant_tags"`
	RoadType     string   `json:"road_type"`
	TimeOfDay    string   `json:"time_of_day"`
	Weather      string   `json:"weather"`
	POV          string   `json:"pov"`
	DurationMs   int      `json:"duration_ms"`
	URL360p      string   `json:"url_360p,omitempty"`
	URL480p      string   `json:"url_480p,omitempty"`
	PosterURL    string   `json:"poster_url,omitempty"`
	SHA256       string   `json:"sha256"`
	Bytes        int64    `json:"bytes"`
	Difficulty   *int     `json:"difficulty,omitempty"`
	Licence      string   `json:"licence"`
	Attribution  string   `json:"attribution"`
	MockEligible bool     `json:"mock_eligible"`
}

// ClipPage is the API-37 response.
type ClipPage struct {
	ManifestVersion string         `json:"manifest_version"`
	TotalBytes      int64          `json:"total_bytes"`
	Items           []ClipListItem `json:"items"`
	NextCursor      *string        `json:"next_cursor"`
}

func (s *Service) mediaURL(ctx context.Context, key string) (string, error) {
	if s.MediaBaseURL != "" {
		return strings.TrimRight(s.MediaBaseURL, "/") + "/" + key, nil
	}
	if s.Objects == nil {
		return key, nil
	}
	ttl := s.MediaURLTTL
	if ttl <= 0 {
		ttl = 2 * time.Hour
	}
	return s.Objects.PresignGet(ctx, key, ttl)
}

func hasTag(tags []string, t string) bool {
	for _, x := range tags {
		if x == t {
			return true
		}
	}
	return false
}

// ListNazarClips is API-37: published clips, newest version per clip, without any hazard
// information, minus the refs in q.Seen (exclude_seen).
func (s *Service) ListNazarClips(ctx context.Context, q ClipQuery) (*ClipPage, error) {
	res := q.Resolution
	if res == "" {
		res = "360p"
	}
	if res != "360p" && res != "480p" {
		return nil, &ValidationError{"/resolution", "invalid_enum"}
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	clips, err := s.Store.ListClips(ctx, ListFilter{Status: []Status{StatusPublished}, Tenant: q.State})
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, r := range q.Seen {
		seen[strings.TrimPrefix(r, "clip:")] = true
	}
	latest := map[string]*Clip{}
	for _, c := range clips {
		if p, ok := latest[c.ClipID]; !ok || c.Version > p.Version {
			latest[c.ClipID] = c
		}
	}
	ids := make([]string, 0, len(latest))
	for id := range latest {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	page := &ClipPage{Items: []ClipListItem{}}
	if m, err := s.Store.LatestManifest(ctx); err == nil {
		page.ManifestVersion = m.Version
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	for _, id := range ids {
		c := latest[id]
		if q.State != "" && !hasTag(c.Doc.TenantTags, q.State) {
			continue
		}
		if seen[c.Ref()] || id <= q.Cursor {
			continue
		}
		if len(page.Items) == limit {
			next := page.Items[len(page.Items)-1].ClipID
			page.NextCursor = &next
			break
		}
		item, err := s.listItem(ctx, c, res, q.State)
		if err != nil {
			return nil, err
		}
		page.TotalBytes += item.Bytes
		page.Items = append(page.Items, item)
	}
	return page, nil
}

func (s *Service) listItem(ctx context.Context, c *Clip, res, state string) (ClipListItem, error) {
	d := &c.Doc
	st := state
	if st == "" && len(d.TenantTags) > 0 {
		st = d.TenantTags[0]
	}
	it := ClipListItem{ClipID: d.ClipID, Ref: d.Ref(), Version: d.Version, State: st, TenantTags: append([]string{}, d.TenantTags...),
		RoadType: d.RoadType, TimeOfDay: d.TimeOfDay, Weather: d.Weather, POV: d.POV, DurationMs: d.DurationMs,
		Difficulty: d.Difficulty.Curator, Licence: d.Licence, Attribution: d.Attribution, MockEligible: c.MockEligible}
	for _, r := range Renditions {
		m, ok := d.MediaFor(r)
		if !ok {
			continue
		}
		u, err := s.mediaURL(ctx, MediaObjectKey(d.ClipID, d.Version, r))
		if err != nil {
			return it, err
		}
		if r == "360p" {
			it.URL360p = u
		} else {
			it.URL480p = u
		}
		if r == res {
			it.SHA256, it.Bytes = m.SHA256, m.Bytes
		}
	}
	u, err := s.mediaURL(ctx, PosterObjectKey(d.ClipID, d.Version))
	if err != nil {
		return it, err
	}
	it.PosterURL = u
	return it, nil
}
