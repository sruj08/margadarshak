package adapters_test

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"gopkg.in/yaml.v3"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/aadhaaroffline"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/sarathi"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/slot"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

const adapterSpecURL = "mem://adapters.openapi.json"

func loadAdapterSpec(t *testing.T) (map[string]any, *jsonschema.Compiler) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "api", "adapters.openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var y any
	if err := yaml.Unmarshal(raw, &y); err != nil {
		t.Fatalf("adapters.openapi.yaml is not valid YAML: %v", err)
	}
	j, _ := json.Marshal(y)
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(j))
	if err != nil {
		t.Fatal(err)
	}
	c := jsonschema.NewCompiler()
	c.DefaultDraft(jsonschema.Draft2020)
	if err := c.AddResource(adapterSpecURL, doc); err != nil {
		t.Fatal(err)
	}
	return doc.(map[string]any), c
}

// TestContractAdapterSpecLints is the offline lint of api/adapters.openapi.yaml (MD-044):
// OpenAPI 3.1, every operation has an operationId, tags or webhook role, declared responses and
// problem+json errors; every schema compiles as JSON Schema 2020-12; no schema can carry
// prohibited data; slots are read-only.
func TestContractAdapterSpecLints(t *testing.T) {
	doc, c := loadAdapterSpec(t)
	if doc["openapi"] != "3.1.0" {
		t.Fatalf("openapi version %v", doc["openapi"])
	}
	seenIDs := map[string]bool{}
	check := func(where string, ops map[string]any) {
		for method, raw := range ops {
			op, ok := raw.(map[string]any)
			if !ok || method == "parameters" {
				continue
			}
			id, _ := op["operationId"].(string)
			if id == "" || seenIDs[id] {
				t.Errorf("%s %s: missing or duplicate operationId %q", method, where, id)
			}
			seenIDs[id] = true
			if _, ok := op["responses"].(map[string]any); !ok {
				t.Errorf("%s %s: no responses", method, where)
			}
			if strings.HasPrefix(where, "/offices") && method != "get" {
				t.Errorf("slots must be read-only (D-08): %s %s", method, where)
			}
		}
	}
	for p, item := range doc["paths"].(map[string]any) {
		check(p, item.(map[string]any))
	}
	for name, item := range doc["webhooks"].(map[string]any) {
		check("webhook:"+name, item.(map[string]any))
	}
	if len(seenIDs) < 10 {
		t.Fatalf("expected at least 10 operations, got %d", len(seenIDs))
	}
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	for name := range schemas {
		if _, err := c.Compile(adapterSpecURL + "#/components/schemas/" + name); err != nil {
			t.Errorf("schema %s does not compile: %v", name, err)
		}
		props, _ := schemas[name].(map[string]any)["properties"].(map[string]any)
		for prop := range props {
			for _, bad := range []string{"aadhaar", "uid", "vid", "otp", "biometric", "face", "photo", "name_", "address_line"} {
				if strings.Contains(strings.ToLower(prop), bad) {
					t.Errorf("schema %s property %s could carry prohibited data", name, prop)
				}
			}
		}
	}
	// Every $ref resolves.
	var walk func(v any)
	walk = func(v any) {
		switch tv := v.(type) {
		case map[string]any:
			if ref, ok := tv["$ref"].(string); ok && strings.HasPrefix(ref, "#/") {
				cur := any(doc)
				for _, part := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
					m, ok := cur.(map[string]any)
					if !ok {
						t.Errorf("unresolved $ref %s", ref)
						return
					}
					cur = m[part]
				}
				if cur == nil {
					t.Errorf("unresolved $ref %s", ref)
				}
			}
			for _, x := range tv {
				walk(x)
			}
		case []any:
			for _, x := range tv {
				walk(x)
			}
		}
	}
	walk(doc)
}

func validateAgainst(t *testing.T, c *jsonschema.Compiler, schema string, v any) {
	t.Helper()
	sch, err := c.Compile(adapterSpecURL + "#/components/schemas/" + schema)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(v)
	inst, _ := jsonschema.UnmarshalJSON(bytes.NewReader(b))
	if err := sch.Validate(inst); err != nil {
		t.Fatalf("%s does not match the adapter spec: %v\n%s", schema, err, b)
	}
}

// TestContractMocksValidateAgainstAdapterSpec: what the mocks return, rendered in the
// government-side wire format, validates against api/adapters.openapi.yaml (MD-044).
func TestContractMocksValidateAgainstAdapterSpec(t *testing.T) {
	_, c := loadAdapterSpec(t)
	ctx := context.Background()

	m := sarathi.NewMock(now)
	ref := m.StartApplication("JK")
	st, err := m.ApplicationStatus(ctx, ref)
	if err != nil {
		t.Fatal(err)
	}
	validateAgainst(t, c, "ApplicationStatus", map[string]any{"app_ref": st.AppRef, "stage": st.Stage, "status_code": st.StatusCode,
		"payment": st.Payment, "as_of": st.AsOf.UTC().Format(time.RFC3339)})

	slots, err := slot.NewMock(1).ListSlots(ctx, "off_jk02", "ll_test", fixedNow, fixedNow.AddDate(0, 0, 6))
	if err != nil {
		t.Fatal(err)
	}
	capacity := map[string]int{"none": 0, "few": 3, "some": 10, "many": 25, "unknown": 0}
	for _, s := range slots {
		validateAgainst(t, c, "Slot", map[string]any{"date": s.Date.Format(time.DateOnly), "kind": s.Kind, "window": s.Window,
			"capacity": capacity[s.CapacityBand], "available": capacity[s.CapacityBand]})
	}

	v, err := aadhaaroffline.NewMock([]byte("contract-aadhaar-key"), now, nil).Verify(ctx, aadhaarFixtures().Valid)
	if err != nil {
		t.Fatal(err)
	}
	validateAgainst(t, c, "OfflineVerdict", map[string]any{"signature_valid": v.SignatureValid, "age_band": v.AgeBand, "dob_precision": v.DOBPrecision,
		"address_state_matches": v.AddressStateMatches, "relation_line_present": v.RelationLinePresent, "reference_hash": v.ReferenceHash,
		"retained_fields": v.RetainedFields})
	_ = ports.KindInvalid
}
