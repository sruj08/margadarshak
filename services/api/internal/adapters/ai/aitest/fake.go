// Package aitest has a scripted model.LLM so agent pipelines run through the real ADK runner in
// tests without calling Gemini.
package aitest

import (
	"context"
	"iter"
	"sync"

	"google.golang.org/genai"

	"google.golang.org/adk/model"
)

// Fake answers each call with the next scripted reply (the last one repeats) and records requests.
type Fake struct {
	mu       sync.Mutex
	Replies  []string
	Requests []*model.LLMRequest
}

// Name implements model.LLM.
func (f *Fake) Name() string { return "fake-model" }

// Calls returns how many model calls were made.
func (f *Fake) Calls() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.Requests) }

// LastPrompt returns the text of the last user message sent to the model.
func (f *Fake) LastPrompt() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.Requests) == 0 {
		return ""
	}
	var s string
	for _, c := range f.Requests[len(f.Requests)-1].Contents {
		if c.Role == genai.RoleUser {
			for _, p := range c.Parts {
				s += p.Text
			}
		}
	}
	return s
}

// GenerateContent implements model.LLM.
func (f *Fake) GenerateContent(_ context.Context, req *model.LLMRequest, _ bool) iter.Seq2[*model.LLMResponse, error] {
	f.mu.Lock()
	i := len(f.Requests)
	f.Requests = append(f.Requests, req)
	reply := ""
	if len(f.Replies) > 0 {
		reply = f.Replies[min(i, len(f.Replies)-1)]
	}
	f.mu.Unlock()
	return func(yield func(*model.LLMResponse, error) bool) {
		yield(&model.LLMResponse{
			Content:      genai.NewContentFromText(reply, genai.RoleModel),
			TurnComplete: true,
			ModelVersion: "fake-model",
		}, nil)
	}
}
