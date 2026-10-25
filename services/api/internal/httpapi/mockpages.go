package httpapi

import (
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// The /mock/* pages stand in for government systems in the hackathon build (MD-038, MD-041).
// They are clearly labelled simulated, carry the non-affiliation footer and are not part of the
// public contract (api/openapi.yaml): a government-mode tenant never routes users here.

var mockPage = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;color:#1b1b1b;background:#fff}
.banner{background:#fff4ce;border:1px solid #c9a227;padding:.75rem;border-radius:.5rem;font-weight:600}
dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem 1rem}dt{font-weight:600}
button{font-size:1rem;min-height:48px;padding:0 1.25rem;margin:.25rem .5rem .25rem 0;border-radius:.5rem;border:1px solid #1f4e79}
.primary{background:#1f4e79;color:#fff}
footer{margin-top:2rem;font-size:.85rem;color:#555}
</style></head><body>
<p class="banner">{{.Banner}}</p>
<h1>{{.Title}}</h1>
{{range .Lines}}<p>{{.}}</p>{{end}}
<dl>{{range .Facts}}<dt>{{.K}}</dt><dd>{{.V}}</dd>{{end}}</dl>
<form method="post" action="{{.Action}}">
{{range $k, $v := .Hidden}}<input type="hidden" name="{{$k}}" value="{{$v}}">{{end}}
{{range .Buttons}}<button type="submit" name="{{.Name}}" value="{{.Value}}"{{if .Primary}} class="primary"{{end}}>{{.Label}}</button>{{end}}
</form>
<footer>Independent prototype by team Chanakya. Not affiliated with MoRTH, NIC, NeGD or any State Transport Department. Uses simulated government data.</footer>
</body></html>`))

type kv struct{ K, V string }

type button struct {
	Name, Value, Label string
	Primary            bool
}

type pageData struct {
	Title, Banner, Action string
	Lines                 []string
	Facts                 []kv
	Hidden                map[string]string
	Buttons               []button
}

func (s *Server) renderMock(w http.ResponseWriter, d pageData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' "+originOf(s.deps.WebBaseURL)+"; frame-ancestors 'none'")
	_ = mockPage.Execute(w, d)
}

func originOf(u string) string {
	p, err := url.Parse(u)
	if err != nil || p.Host == "" {
		return ""
	}
	return p.Scheme + "://" + p.Host
}

func (s *Server) mountMockPages(r chi.Router) {
	r.Get("/mock/digilocker/authorize", s.mockDigiLockerScreen)
	r.Post("/mock/digilocker/authorize", s.mockDigiLockerDecide)
	r.Get("/mock/payment/{intent}", s.mockPaymentPage)
	r.Post("/mock/payment/{intent}", s.mockPaymentComplete)
	r.Get("/mock/sarathi/watchdog", s.mockSarathiWatchdog)
	r.Post("/mock/sarathi/watchdog", s.mockSarathiWatchdog)
	// P2 clip media (OBJECT_STORE=mock): signed, expiring URLs with Range support (decision D5).
	if s.deps.MockMedia != nil {
		r.Handle("/mock/media/*", s.deps.MockMedia)
	}
}

func (s *Server) mockDigiLockerScreen(w http.ResponseWriter, r *http.Request) {
	m := s.deps.Registry.DigiLockerMock()
	screen, ok := m.Screen(r.URL.Query().Get("request"))
	if !ok {
		notFound(w, r)
		return
	}
	s.renderMock(w, pageData{
		Title:  "Simulated DigiLocker consent",
		Banner: "Simulated: in production this screen is DigiLocker's own consent page.",
		Lines:  []string{"Margdarshak is asking to read one issued document. Only the classes, validity dates and the last 4 characters of the number are kept; the document itself is discarded."},
		Facts: []kv{{"Purpose", screen.Purpose}, {"Documents", strings.Join(screen.Doctypes, ", ") + " (driving licence)"},
			{"Valid for", fmt.Sprintf("%d days (you can revoke it any time in Privacy)", int(screen.ValidFor.Hours()/24))}},
		Action:  "/mock/digilocker/authorize",
		Hidden:  map[string]string{"request": screen.RequestID},
		Buttons: []button{{Name: "decision", Value: "allow", Label: "Allow", Primary: true}, {Name: "decision", Value: "deny", Label: "Deny"}},
	})
}

func (s *Server) mockDigiLockerDecide(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		badRequest(w, r, "form expected")
		return
	}
	cb, err := s.deps.Registry.DigiLockerMock().Decide(r.PostForm.Get("request"), r.PostForm.Get("decision") == "allow")
	if err != nil {
		notFound(w, r)
		return
	}
	http.Redirect(w, r, cb, http.StatusFound)
}

func (s *Server) loadMockIntent(r *http.Request) (*store.PaymentIntent, bool) {
	id, err := ids.Decode(ids.PaymentIntent, chi.URLParam(r, "intent"))
	if err != nil {
		return nil, false
	}
	t, err := s.deps.Tenants.Resolve(r.Context(), "", r.Host)
	if err != nil {
		return nil, false
	}
	var p *store.PaymentIntent
	err = s.deps.DB.Tenant(r.Context(), t.TenantID, func(tx pgx.Tx) error {
		var err error
		p, err = store.GetPaymentIntent(r.Context(), tx, id)
		return err
	})
	if err != nil || p.Adapter != "mock" {
		return nil, false
	}
	return p, true
}

func (s *Server) mockPaymentPage(w http.ResponseWriter, r *http.Request) {
	p, ok := s.loadMockIntent(r)
	if !ok {
		notFound(w, r)
		return
	}
	def := s.deps.Registry.PaymentMock().DefaultOutcome()
	btn := func(v, label string) button {
		return button{Name: "outcome", Value: v, Label: label, Primary: v == def}
	}
	s.renderMock(w, pageData{
		Title:   "Simulated payment page",
		Banner:  "Simulated: no money moves. Margdarshak never collects government fees; in production you pay on Sarathi or the state's gateway.",
		Facts:   []kv{{"Reference", ids.Encode(ids.PaymentIntent, p.ID)}, {"Amount (from your fee quote)", formatPaise(p.AmountPaise)}, {"Collected by", "State gateway (simulated)"}},
		Action:  "/mock/payment/" + ids.Encode(ids.PaymentIntent, p.ID),
		Hidden:  map[string]string{"return": r.URL.Query().Get("return")},
		Buttons: []button{btn("success", "Pay (success)"), btn("failed", "Payment fails"), btn("pending", "Debited but pending")},
	})
}

// formatPaise renders integer paise for display; the amount itself always comes from the quote.
func formatPaise(p int) string { return fmt.Sprintf("₹%d.%02d", p/100, p%100) }

func (s *Server) mockPaymentComplete(w http.ResponseWriter, r *http.Request) {
	p, ok := s.loadMockIntent(r)
	if !ok {
		notFound(w, r)
		return
	}
	if err := r.ParseForm(); err != nil {
		badRequest(w, r, "form expected")
		return
	}
	outcome := r.PostForm.Get("outcome")
	if outcome != "success" && outcome != "failed" && outcome != "pending" {
		validation(w, r, "/outcome", "invalid_enum")
		return
	}
	cb := ports.PaymentCallback{IntentRef: ids.Encode(ids.PaymentIntent, p.ID), Status: outcome, At: s.now()}
	if outcome != "failed" {
		cb.ReceiptNumber = "SIM-RCPT-" + strings.ToUpper(ids.New().String()[:8])
	}
	sig, body := s.deps.Registry.PaymentMock().SignCallback(cb)
	status := s.dispatchInternal(r, http.MethodPost, "/internal/webhooks/payment/mock", map[string]string{
		"Content-Type": "application/json", hmacsig.Header: sig, "Authorization": "Bearer " + firstToken(s.deps.InternalTokens), "X-Tenant": p.TenantID,
	}, body)
	if status != http.StatusNoContent {
		writeProblem(w, r, Problem{Status: http.StatusBadGateway, Code: "ADAPTER_UNAVAILABLE", Detail: "the simulated gateway callback was rejected"})
		return
	}
	ret := r.PostForm.Get("return")
	web := strings.TrimRight(s.deps.WebBaseURL, "/")
	if ret == "" || !strings.HasPrefix(ret, web+"/") {
		ret = web + p.ReturnPath
	}
	sep := "?"
	if strings.Contains(ret, "?") {
		sep = "&"
	}
	http.Redirect(w, r, ret+sep+"payment="+outcome+"&ref="+url.QueryEscape(cb.IntentRef), http.StatusSeeOther)
}

func firstToken(t []string) string {
	if len(t) == 0 {
		return ""
	}
	return t[0]
}

type sarathiEndpointStatus struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	HTTPStatus int    `json:"http_status"`
	LatencyMs  int    `json:"latency_ms"`
}

type sarathiWatchdogResponse struct {
	Status     string                  `json:"status"`
	Mode       string                  `json:"mode"`
	HTTPStatus int                     `json:"http_status"`
	LatencyMs  int                     `json:"latency_ms"`
	CheckedAt  string                  `json:"checked_at"`
	Source     string                  `json:"source"`
	WorkflowID string                  `json:"workflow_id"`
	Reason     string                  `json:"reason"`
	Endpoints  []sarathiEndpointStatus `json:"endpoints"`
}

// mockSarathiWatchdog backs the 1-click judge toggle for W15 (Sarathi Portal Outage Watchdog, EC-11).
// It allows either the n8n W15 workflow or the browser fallback to inject/clear FaultOutage on
// SarathiMock so GET /v1/health immediately reflects adapters.sarathi.status = "down" | "ok".
func (s *Server) mockSarathiWatchdog(w http.ResponseWriter, r *http.Request) {
	mode := strings.TrimSpace(r.URL.Query().Get("mode"))
	if mode == "" && r.Body != nil {
		var body struct {
			Mode string `json:"mode"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		mode = strings.TrimSpace(body.Mode)
	}
	if mode == "" {
		mode = "status"
	}

	if s.deps.Registry != nil && s.deps.Registry.SarathiMock() != nil {
		switch mode {
		case "simulate_down":
			s.deps.Registry.SarathiMock().InjectFault(ports.FaultOutage)
		case "restore", "probe":
			s.deps.Registry.SarathiMock().InjectFault(ports.FaultNone)
		}
	}

	status := "ok"
	if s.deps.Registry != nil && s.deps.Registry.SarathiMock() != nil {
		if h := s.deps.Registry.SarathiMock().Health(r.Context()); h.Status == "down" {
			status = "down"
		}
	}

	httpStatus := 200
	latencyMs := 178
	reason := "Sarathi stateSelection.do responded within normal threshold"
	if status == "down" {
		httpStatus = 503
		latencyMs = 4210
		reason = "HTTP 503 Service Unavailable · Parivahan afternoon peak timeout (via n8n W15)"
	}

	writeJSON(w, http.StatusOK, sarathiWatchdogResponse{
		Status:     status,
		Mode:       mode,
		HTTPStatus: httpStatus,
		LatencyMs:  latencyMs,
		CheckedAt:  s.now().UTC().Format(time.RFC3339),
		Source:     "n8n-w15-bridge",
		WorkflowID: "W15-sarathi-outage-watchdog",
		Reason:     reason,
		Endpoints: []sarathiEndpointStatus{
			{Name: "State Selection (stateSelection.do)", Status: status, HTTPStatus: httpStatus, LatencyMs: latencyMs},
			{Name: "LL Application (newLLDet.do)", Status: status, HTTPStatus: httpStatus, LatencyMs: latencyMs + 110},
			{Name: "Form 1A / Slot Booking (llSlotBook.do)", Status: status, HTTPStatus: httpStatus, LatencyMs: latencyMs + 85},
		},
	})
}
