// Package debrief builds the API-36 debrief card (F-25, DEBRIEF_SPEC). The template card is plain
// Go over content/catalogue/findings.json; an ADK agent may rewrite the wording, but only inside
// strict rules (no digits outside {{fact:key}} placeholders, finding IDs from the session, length
// limits). A draft that breaks a rule is retried once, then the template card is kept (EC-29).
package debrief

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type factDef struct {
	Key  string `json:"key"`
	Kind string `json:"kind"`
}

type findingDef struct {
	ID          string                       `json:"finding_id"`
	Polarity    string                       `json:"polarity"`
	Facts       []factDef                    `json:"facts"`
	DrillPat    *drillPat                    `json:"drill_pattern"`
	TemplateOnl bool                         `json:"template_only"`
	Templates   map[string]map[string]string `json:"templates"`
}

type drillPat struct {
	Template string `json:"template"`
	FactKey  string `json:"fact_key"`
}

type drillDef struct {
	ID       string            `json:"drill_id"`
	Deeplink string            `json:"deeplink"`
	Why      map[string]string `json:"why"`
	Avail    string            `json:"availability"`
}

// Catalogue is the reviewed finding and drill text (content/catalogue). Rules are not loaded:
// every rule is unverified today, so a debrief cites none (DEBRIEF_SPEC §3; AI never cites).
type Catalogue struct {
	findings map[string]*findingDef
	drills   map[string]*drillDef
}

// LoadCatalogue reads findings.json and drills.json from contentDir/catalogue.
func LoadCatalogue(contentDir string) (*Catalogue, error) {
	var f struct {
		Findings []*findingDef `json:"findings"`
	}
	var d struct {
		Drills []*drillDef `json:"drills"`
	}
	for name, dst := range map[string]any{"findings.json": &f, "drills.json": &d} {
		raw, err := os.ReadFile(filepath.Join(contentDir, "catalogue", name))
		if err != nil {
			return nil, fmt.Errorf("debrief: %w", err)
		}
		if err := json.Unmarshal(raw, dst); err != nil {
			return nil, fmt.Errorf("debrief: %s: %w", name, err)
		}
	}
	c := &Catalogue{findings: map[string]*findingDef{}, drills: map[string]*drillDef{}}
	for _, x := range f.Findings {
		c.findings[x.ID] = x
	}
	for _, x := range d.Drills {
		c.drills[x.ID] = x
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
