package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/rules"
)

// rulesPort adapts the RULES agent's engine (internal/rules) to ports.RulesPort.
type rulesPort struct{ lib *rules.Library }

func (r rulesPort) PackFor(_ context.Context, state string) (ports.RulePackRef, error) {
	c, ok := r.lib.Pack(state)
	if !ok {
		return ports.RulePackRef{}, fmt.Errorf("rules: no pack for %s", state)
	}
	return ports.RulePackRef{PackID: c.PackID, Version: c.Version, BaseVersion: c.BaseVersion}, nil
}

// LoadRules loads rule packs from dir (RULEPACK_DIR), or from the repository's rulepacks/
// directory found by walking up from the working directory.
func LoadRules(dir string) (ports.RulesPort, string, error) {
	if dir == "" {
		wd, _ := os.Getwd()
		for d := wd; ; d = filepath.Dir(d) {
			if st, err := os.Stat(filepath.Join(d, "rulepacks")); err == nil && st.IsDir() {
				dir = filepath.Join(d, "rulepacks")
				break
			}
			if filepath.Dir(d) == d {
				return nil, "", fmt.Errorf("rules: rulepacks directory not found (set RULEPACK_DIR)")
			}
		}
	}
	lib, err := rules.LoadDir(dir)
	if err != nil {
		return nil, dir, err
	}
	return rulesPort{lib: lib}, dir, nil
}

// FeeTotal returns a function computing the fee quote total (integer paise) from the rule pack,
// or nil when rp is not the rules engine. Fees never come from literals (D-06).
func FeeTotal(rp ports.RulesPort) func(state string, classes []string) (int64, error) {
	r, ok := rp.(rulesPort)
	if !ok {
		return nil
	}
	return func(state string, classes []string) (int64, error) {
		c, ok := r.lib.Pack(state)
		if !ok {
			return 0, fmt.Errorf("rules: no pack for %s", state)
		}
		return c.FeeQuote(classes).TotalPaise, nil
	}
}

// RulesLibrary returns the engine library behind a RulesPort from LoadRules (nil otherwise).
func RulesLibrary(rp ports.RulesPort) *rules.Library {
	if r, ok := rp.(rulesPort); ok {
		return r.lib
	}
	return nil
}
