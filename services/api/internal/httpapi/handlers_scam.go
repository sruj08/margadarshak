package httpapi

import (
	"net/http"
	"strings"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/scam"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
)

// CheckScam implements API-43. Rules decide the verdict; the ADK explainer only narrates.
func (s *Server) CheckScam(w http.ResponseWriter, r *http.Request) {
	if s.deps.Scam == nil {
		serviceMissing(w, r)
		return
	}
	var body gen.ScamCheckRequest
	if !decodeJSON(w, r, &body, false) {
		return
	}
	in := scam.Input{}
	if body.Text != nil {
		in.Text = strings.TrimSpace(*body.Text)
	}
	if body.Url != nil {
		in.URL = strings.TrimSpace(*body.Url)
	}
	if body.Sender != nil {
		in.Sender = strings.TrimSpace(*body.Sender)
	}
	if in.Text == "" && in.URL == "" {
		validation(w, r, "/text", "required")
		return
	}
	if len([]rune(in.Text)) > 4000 || len(in.URL) > 2000 {
		validation(w, r, "/text", "too_long")
		return
	}
	writeJSON(w, http.StatusOK, s.deps.Scam.Check(r.Context(), in, s.aiGate(r, aiCoachFeature) == ""))
}
