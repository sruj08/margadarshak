// Package debrief builds the API-36 debrief card (F-25, DEBRIEF_SPEC). The template card is plain
// Go over content/catalogue/findings.json; an ADK agent may rewrite the wording, but only inside
// strict rules (no digits outside {{fact:key}} placeholders, finding IDs from the session, rule
// and drill IDs from code-built allowlists, length limits). A draft that breaks a rule is retried
// once, then the template card is kept (EC-29).
package debrief

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

type factDef struct {
	Key  string `json:"key"`
	Kind string `json:"kind"`
}

type findingDef struct {
	ID          string                       `json:"finding_id"`
	GameID      string                       `json:"game_id"`
	Polarity    string                       `json:"polarity"`
	Facts       []factDef                    `json:"facts"`
	DrillPat    *drillPat                    `json:"drill_pattern"`
	TemplateOnl bool                         `json:"template_only"`
	RuleIDs     []string                     `json:"rule_ids"`
	Templates   map[string]map[string]string `json:"templates"`
}

type drillPat struct {
	Template string `json:"template"`
	FactKey  string `json:"fact_key"`
}

type drillDef struct {
	ID       string            `json:"drill_id"`
	GameID   string            `json:"game_id"`
	Deeplink string            `json:"deeplink"`
	Why      map[string]string `json:"why"`
	Avail    string            `json:"availability"`
}

type ruleDef struct {
	ID         string  `json:"rule_id"`
	TextEn     string  `json:"text_en"`
	TextHi     string  `json:"text_hi"`
	SourceURL  *string `json:"source_url"`
	VerifiedOn *string `json:"verified_on"`
	Verified   bool    `json:"verified"`
	AICitable  bool    `json:"ai_citable"`
}

// citable is DEBRIEF_SPEC §3: only a verified, AI-citable rule with a source and a date is cited.
func (r *ruleDef) citable() bool {
	return r != nil && r.Verified && r.AICitable && r.SourceURL != nil && *r.SourceURL != "" && r.VerifiedOn != nil
}

// Catalogue is the reviewed finding, drill and rule text (content/catalogue).
type Catalogue struct {
	findings   map[string]*findingDef
	drills     map[string]*drillDef
	drillOrder []string
	rules      map[string]*ruleDef
	// defaultDrill is games.json default_drill_id per game (the next step when nothing went wrong).
	defaultDrill map[string]string
}

// LoadCatalogue reads findings.json, drills.json and (if present) rules.json from
// contentDir/catalogue.
func LoadCatalogue(contentDir string) (*Catalogue, error) {
	var f struct {
		Findings []*findingDef `json:"findings"`
	}
	var d struct {
		Drills []*drillDef `json:"drills"`
	}
	var r struct {
		Rules []*ruleDef `json:"rules"`
	}
	var g struct {
		Games []struct {
			GameID       string `json:"game_id"`
			DefaultDrill string `json:"default_drill_id"`
		} `json:"games"`
	}
	for name, dst := range map[string]any{"findings.json": &f, "drills.json": &d, "rules.json": &r, "games.json": &g} {
		raw, err := os.ReadFile(filepath.Join(contentDir, "catalogue", name))
		if (name == "rules.json" || name == "games.json") && errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("debrief: %w", err)
		}
		if err := json.Unmarshal(raw, dst); err != nil {
			return nil, fmt.Errorf("debrief: %s: %w", name, err)
		}
	}
	c := &Catalogue{findings: map[string]*findingDef{}, drills: map[string]*drillDef{}, rules: map[string]*ruleDef{}, defaultDrill: map[string]string{}}
	for _, x := range g.Games {
		c.defaultDrill[x.GameID] = x.DefaultDrill
	}
	for _, x := range f.Findings {
		c.findings[x.ID] = x
	}
	for _, x := range d.Drills {
		c.drills[x.ID] = x
		c.drillOrder = append(c.drillOrder, x.ID)
	}
	for _, x := range r.Rules {
		c.rules[x.ID] = x
	}
	return c, nil
}

func (c *Catalogue) kinds(f *findingDef) map[string]string {
	m := map[string]string{}
	for _, d := range f.Facts {
		m[d.Key] = d.Kind
	}
	return m
}
