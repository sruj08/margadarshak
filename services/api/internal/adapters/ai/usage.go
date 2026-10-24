package ai

import (
	"maps"
	"slices"
	"strings"
	"sync"
	"time"
)

// AgentStats is the running LLM observability for one agent (MD-307): calls, outcomes, latency,
// tokens and an estimated cost. Never prompt or answer text.
type AgentStats struct {
	Agent        string         `json:"agent"`
	Model        string         `json:"model"`
	Calls        int64          `json:"calls"`
	Failures     int64          `json:"failures"`
	Fallbacks    map[string]int `json:"fallbacks"`
	TotalMs      int64          `json:"total_ms"`
	MaxMs        int64          `json:"max_ms"`
	InTokens     int64          `json:"in_tokens"`
	OutTokens    int64          `json:"out_tokens"`
	EstCostMicro int64          `json:"est_cost_micro_usd"`
	BreakerOpen  bool           `json:"breaker_open"`
}

var usage = struct {
	sync.Mutex
	by map[string]*AgentStats
}{by: map[string]*AgentStats{}}

func statsFor(agentName string) *AgentStats {
	s, ok := usage.by[agentName]
	if !ok {
		s = &AgentStats{Agent: agentName, Fallbacks: map[string]int{}}
		usage.by[agentName] = s
	}
	return s
}

// pricePerMTok is USD per million tokens (input, output) by model family. shortcut: list prices
// as of the build; update with the billing export before any spend decision.
func pricePerMTok(model string) (in, out float64) {
	switch {
	case strings.Contains(model, "lite"):
		return 0.10, 0.40
	case strings.Contains(model, "pro"):
		return 1.25, 10.0
	default:
		return 0.30, 2.50
	}
}

func recordCall(agentName, model string, d time.Duration, inTok, outTok int32, ok bool) {
	usage.Lock()
	defer usage.Unlock()
	s := statsFor(agentName)
	s.Model = model
	s.Calls++
	if !ok {
		s.Failures++
	}
	ms := d.Milliseconds()
	s.TotalMs += ms
	s.MaxMs = max(s.MaxMs, ms)
	s.InTokens += int64(inTok)
	s.OutTokens += int64(outTok)
	pi, po := pricePerMTok(model)
	s.EstCostMicro += int64(float64(inTok)*pi + float64(outTok)*po)
}

// RecordFallback counts a template fallback and its reason (timeout, validator, circuit_open,
// no_consent, …) for an agent.
func RecordFallback(agentName, reason string) {
	usage.Lock()
	defer usage.Unlock()
	statsFor(agentName).Fallbacks[reason]++
}

// Usage returns a copy of every agent's stats, sorted by agent name.
func Usage() []AgentStats {
	usage.Lock()
	defer usage.Unlock()
	out := make([]AgentStats, 0, len(usage.by))
	for _, s := range usage.by {
		c := *s
		c.Fallbacks = maps.Clone(s.Fallbacks)
		if b := breakers[s.Agent]; b != nil {
			c.BreakerOpen = b.Open()
		}
		out = append(out, c)
	}
	slices.SortFunc(out, func(a, b AgentStats) int { return strings.Compare(a.Agent, b.Agent) })
	return out
}

// breakers maps agent name to its breaker (read under usage's lock).
var breakers = map[string]*Breaker{}
