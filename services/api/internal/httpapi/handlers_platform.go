package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/tenant"
)

type healthCheck = struct {
	Detail    *string                 `json:"detail,omitempty"`
	LatencyMs *int                    `json:"latency_ms,omitempty"`
	Status    *gen.HealthChecksStatus `json:"status,omitempty"`
}

type healthAdapter = struct {
	Implementation *string                   `json:"implementation,omitempty"`
	Status         *gen.HealthAdaptersStatus `json:"status,omitempty"`
}

// GetHealth is API-64. Shallow: liveness plus the default tenant's adapter modes. deep=true also
// pings Postgres (and Key Value / the score verifier when configured), each within 300 ms.
func (s *Server) GetHealth(w http.ResponseWriter, r *http.Request, params gen.GetHealthParams) {
	status := gen.HealthStatusOk
	adaptersOut := map[string]healthAdapter{}
	checks := map[string]healthCheck{}
	if t := tenantFrom(r.Context()); t != nil {
		for port, h := range adapterHealth(r.Context(), t) {
			impl, st := h.Implementation, gen.HealthAdaptersStatus(h.Status)
			adaptersOut[port] = healthAdapter{Implementation: &impl, Status: &st}
			if h.Status != "ok" && status == gen.HealthStatusOk {
				status = gen.HealthStatusDegraded
			}
		}
		if s.deps.Registry != nil && s.deps.Registry.SarathiMock() != nil {
			if mh := s.deps.Registry.SarathiMock().Health(r.Context()); mh.Status == "down" {
				impl := "deeplink"
				if prev, ok := adaptersOut["sarathi"]; ok && prev.Implementation != nil {
					impl = *prev.Implementation
				}
				st := gen.HealthAdaptersStatus("down")
				adaptersOut["sarathi"] = healthAdapter{Implementation: &impl, Status: &st}
				if status == gen.HealthStatusOk {
					status = gen.HealthStatusDegraded
				}
			}
		}
	}
	if params.Deep != nil && *params.Deep {
		pings := map[string]func(context.Context) error{"postgres": func(ctx context.Context) error { _, err := s.deps.DB.Ping(ctx); return err }}
		for k, v := range s.deps.Ping {
			pings[k] = v
		}
		for name, ping := range pings {
			ctx, cancel := context.WithTimeout(r.Context(), 300*time.Millisecond)
			start := time.Now()
			err := ping(ctx)
			cancel()
			ms := int(time.Since(start).Milliseconds())
			st := gen.HealthChecksStatusOk
			var detail *string
			if err != nil {
				st = gen.HealthChecksStatusDown
				d := "unreachable"
				detail = &d
				if name == "postgres" {
					status = gen.HealthStatusDown
				} else if status == gen.HealthStatusOk {
					status = gen.HealthStatusDegraded
				}
			}
			checks[name] = healthCheck{Status: &st, LatencyMs: &ms, Detail: detail}
		}
	}
	ok := status != gen.HealthStatusDown
	commit := s.deps.Commit
	out := gen.Health{Status: status, Version: s.deps.Version, Time: s.now().UTC(), Ok: &ok, Commit: &commit}
	if len(adaptersOut) > 0 {
		out.Adapters = (*map[string]struct {
			Implementation *string                   `json:"implementation,omitempty"`
			Status         *gen.HealthAdaptersStatus `json:"status,omitempty"`
		})(&adaptersOut)
	}
	if len(checks) > 0 {
		out.Checks = (*map[string]struct {
			Detail    *string                 `json:"detail,omitempty"`
			LatencyMs *int                    `json:"latency_ms,omitempty"`
			Status    *gen.HealthChecksStatus `json:"status,omitempty"`
		})(&checks)
	}
	code := http.StatusOK
	if !ok {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, out)
}

type portHealth struct{ Implementation, Status string }

func adapterHealth(ctx context.Context, t *tenant.Tenant) map[string]portHealth {
	a := t.Adapters
	out := map[string]portHealth{}
	add := func(port string, impl string, status string) { out[port] = portHealth{impl, status} }
	if a.Sarathi != nil {
		h := a.Sarathi.Health(ctx)
		add("sarathi", h.Implementation, h.Status)
	}
	if a.DigiLocker != nil {
		h := a.DigiLocker.Health(ctx)
		add("digilocker", h.Implementation, h.Status)
	}
	if a.AadhaarOffline != nil {
		h := a.AadhaarOffline.Health(ctx)
		add("aadhaar_offline", h.Implementation, h.Status)
	}
	if a.Bhashini != nil {
		h := a.Bhashini.Health(ctx)
		add("bhashini", h.Implementation, h.Status)
	}
	if a.Payment != nil {
		h := a.Payment.Health(ctx)
		add("payment", h.Implementation, h.Status)
	}
	if a.Slot != nil {
		h := a.Slot.Health(ctx)
		add("slot", h.Implementation, h.Status)
	}
	add("notification", a.Modes["notification"], "ok")
	return out
}

// GetTenant is API-23: public tenant configuration with typed feature flags (MD-056).
func (s *Server) GetTenant(w http.ResponseWriter, r *http.Request, state gen.State) {
	t, err := s.deps.Tenants.Get(r.Context(), string(state))
	if err != nil {
		writeProblem(w, r, Problem{Status: http.StatusNotFound, Code: "TENANT_UNKNOWN", Detail: "unknown state/tenant code"})
		return
	}
	out := gen.Tenant{
		Tenant:         gen.StateCode(t.TenantID),
		DisplayNameKey: t.DisplayNameKey,
		Features:       t.Features,
		RulePack:       gen.RulePackRef{PackId: t.RulePack.PackID, Version: t.RulePack.Version},
	}
	if t.RulePack.BaseVersion != "" {
		bv := t.RulePack.BaseVersion
		out.RulePack.BaseVersion = &bv
	}
	for _, l := range t.Languages {
		out.Languages = append(out.Languages, gen.TenantLanguages(l))
	}
	hm := gen.TenantHostingMode(t.HostingMode)
	out.HostingMode = &hm
	dk := t.DisclaimerKey
	out.DisclaimerKey = &dk
	m := t.Adapters.Modes
	sar, dl, aad, bh, pay, ntf, slot := gen.TenantAdaptersSarathi(m["sarathi"]), gen.TenantAdaptersDigilocker(m["digilocker"]),
		gen.TenantAdaptersAadhaarOffline(m["aadhaar_offline"]), gen.TenantAdaptersBhashini(m["bhashini"]), gen.TenantAdaptersPayment(m["payment"]),
		gen.TenantAdaptersNotification(m["notification"]), gen.TenantAdaptersSlot(m["slot"])
	out.Adapters.Sarathi, out.Adapters.Digilocker, out.Adapters.AadhaarOffline, out.Adapters.Bhashini = &sar, &dl, &aad, &bh
	out.Adapters.Payment, out.Adapters.Notification, out.Adapters.Slot = &pay, &ntf, &slot
	theme := struct {
		LogoUrl *string `json:"logo_url,omitempty"`
		Primary *string `json:"primary,omitempty"`
		Surface *string `json:"surface,omitempty"`
	}{}
	if v, ok := t.Theme["primary"].(string); ok {
		theme.Primary = &v
	}
	if v, ok := t.Theme["surface"].(string); ok {
		theme.Surface = &v
	}
	if v, ok := t.Theme["logo_url"].(string); ok && v != "" {
		theme.LogoUrl = &v
	}
	out.Theme = &theme
	if name, ok := t.GrievanceOfficer["name"]; ok {
		email := t.GrievanceOfficer["email"]
		g := struct {
			Email *openapi_types.Email `json:"email,omitempty"`
			Name  *string              `json:"name,omitempty"`
		}{Name: &name}
		if email != "" {
			e := openapi_types.Email(email)
			g.Email = &e
		}
		out.GrievanceOfficer = (*struct {
			Email *openapi_types.Email `json:"email,omitempty"`
			Name  *string              `json:"name,omitempty"`
		})(&g)
	}
	b, _ := json.Marshal(out)
	sum := sha256.Sum256(b)
	etag := `W/"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
