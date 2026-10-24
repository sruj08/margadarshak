package games

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// CatalogSchema is the schema of content/generated/game-items.json.
const CatalogSchema = "margdarshak.game-items/1"

// Catalog is the committed playable-item index written by the verifier's build:content
// (content/generated/game-items.json). It never contains a key or a window.
type Catalog struct {
	Schema          string          `json:"schema"`
	GameCoreVersion string          `json:"gameCoreVersion"`
	ContentVersion  string          `json:"contentVersion"`
	Formats         []CatalogFormat `json:"formats"`
	GameList        []*CatalogGame  `json:"games"`

	games map[string]*CatalogGame
}

// CatalogFormat is one format row with its provenance flags.
type CatalogFormat struct {
	RuleID     string   `json:"ruleId"`
	Row        string   `json:"row"`
	Verified   bool     `json:"verified"`
	Confidence string   `json:"confidence"`
	CheckedOn  string   `json:"checkedOn"`
	Derived    []string `json:"derived"`
}

// CatalogGame is one game's versions and items.
type CatalogGame struct {
	GameID          string        `json:"gameId"`
	ItemKind        string        `json:"itemKind"`
	GameVersion     string        `json:"gameVersion"`
	ScoringVersion  string        `json:"scoringVersion"`
	ScoringVersions []string      `json:"scoringVersions"`
	Source          string        `json:"source"` // content/questions | game-core-fixtures | api
	Formats         []string      `json:"formats"`
	Items           []CatalogItem `json:"items"`
}

// CatalogItem is one playable item.
type CatalogItem struct {
	Ref            string `json:"ref"`
	ContentVersion string `json:"contentVersion"`
	Difficulty     *int   `json:"difficulty"`
	Pool           string `json:"pool,omitempty"` // LL: practice | mock
	Topic          string `json:"topic,omitempty"`
	ConceptID      string `json:"conceptId,omitempty"`
}

// ParseCatalog parses and indexes game-items.json.
func ParseCatalog(raw []byte) (*Catalog, error) {
	var c Catalog
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("games: game-items.json: %w", err)
	}
	if c.Schema != CatalogSchema {
		return nil, fmt.Errorf("games: game-items.json schema %q, want %q", c.Schema, CatalogSchema)
	}
	c.games = map[string]*CatalogGame{}
	for _, g := range c.GameList {
		if g.GameID == "" || g.GameVersion == "" || g.ScoringVersion == "" {
			return nil, fmt.Errorf("games: game-items.json: incomplete game entry %q", g.GameID)
		}
		for _, it := range g.Items {
			if !strings.HasPrefix(it.Ref, g.ItemKind+":") || it.ContentVersion == "" {
				return nil, fmt.Errorf("games: game-items.json: bad item %q in %s", it.Ref, g.GameID)
			}
		}
		c.games[g.GameID] = g
	}
	return &c, nil
}

// LoadCatalog reads game-items.json (CONTENT_DIR/generated/game-items.json).
func LoadCatalog(path string) (*Catalog, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("games: %w", err)
	}
	return ParseCatalog(raw)
}

// Game returns a game's entry, or nil.
func (c *Catalog) Game(id string) *CatalogGame {
	if c == nil {
		return nil
	}
	return c.games[id]
}
