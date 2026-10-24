// Package gen holds code generated from api/openapi.yaml (MD-055, contract-first):
//   - models.gen.go: request/response types (oapi-codegen, models)
//   - server.gen.go: chi router + ServerInterface + Unimplemented (oapi-codegen, chi-server)
//   - operations.gen.go: method/path -> operationId, API-xx and security table (tools/specprep)
//
// Regenerate after editing api/openapi.yaml:
//
//	go generate ./internal/httpapi/gen
package gen

//go:generate go run ../../../tools/specprep ../../../../../api/openapi.yaml openapi30.gen.json operations.gen.go
//go:generate go tool oapi-codegen -config oapi-codegen.yaml openapi30.gen.json
//go:generate go tool oapi-codegen -config server.cfg.yaml openapi30.gen.json
//go:generate gofmt -w operations.gen.go

// Operation is the contract metadata of one OpenAPI operation.
type Operation struct {
	Method      string
	Path        string
	OperationID string
	APIID       string
	Proposed    bool
	// Security is an OR-list of AND-sets, exactly as in OpenAPI. An empty AND-set ({})
	// means anonymous access is allowed.
	Security []SecurityRequirement
}

// SecurityRequirement is one AND-set of schemes.
type SecurityRequirement []SchemeRequirement

// SchemeRequirement names a security scheme and the scopes (roles) it must carry.
type SchemeRequirement struct {
	Scheme string
	Scopes []string
}
