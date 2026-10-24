package store

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

// TenantRow is E-31 as stored.
type TenantRow struct {
	TenantID            string
	DisplayName         map[string]string
	DisplayNameKey      string
	HostingMode         string
	Languages           []string
	Theme               map[string]any
	RulePackID          string
	RulePackVersion     string
	RulePackBaseVersion *string
	Features            map[string]bool
	GrievanceOfficer    map[string]string
	Hosts               []string
	WebOrigins          []string
	DisclaimerKey       string
	DataRegion          string
	Adapters            map[string]string // port -> implementation
}

// GetTenant loads a tenant and its adapter configuration.
func GetTenant(ctx context.Context, tx pgx.Tx, id string) (*TenantRow, error) {
	var t TenantRow
	var displayName, theme, features, grievance []byte
	err := tx.QueryRow(ctx, `
		SELECT tenant_id, display_name, display_name_key, hosting_mode, languages, theme,
		       rule_pack_id, rule_pack_version, rule_pack_base_version, features, grievance_officer,
		       hosts, web_origins, disclaimer_key, data_region
		FROM core.tenants WHERE tenant_id = $1`, id).Scan(
		&t.TenantID, &displayName, &t.DisplayNameKey, &t.HostingMode, &t.Languages, &theme,
		&t.RulePackID, &t.RulePackVersion, &t.RulePackBaseVersion, &features, &grievance,
		&t.Hosts, &t.WebOrigins, &t.DisclaimerKey, &t.DataRegion)
	if err != nil {
		return nil, mapErr(err)
	}
	for _, p := range []struct {
		raw []byte
		dst any
	}{{displayName, &t.DisplayName}, {theme, &t.Theme}, {features, &t.Features}, {grievance, &t.GrievanceOfficer}} {
		if err := json.Unmarshal(p.raw, p.dst); err != nil {
			return nil, err
		}
	}
	rows, err := tx.Query(ctx, `SELECT port, implementation FROM core.tenant_adapter_config WHERE tenant_id = $1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	t.Adapters = map[string]string{}
	for rows.Next() {
		var port, impl string
		if err := rows.Scan(&port, &impl); err != nil {
			return nil, err
		}
		t.Adapters[port] = impl
	}
	return &t, rows.Err()
}

// ListTenantIDs returns every tenant code.
func ListTenantIDs(ctx context.Context, tx pgx.Tx) ([]string, error) {
	rows, err := tx.Query(ctx, `SELECT tenant_id FROM core.tenants ORDER BY tenant_id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// UpsertAdapterConfig sets the implementation of one port for a tenant (system scope).
func UpsertAdapterConfig(ctx context.Context, tx pgx.Tx, tenant, port, impl, by string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO core.tenant_adapter_config (tenant_id, port, implementation, contract_suite_version, activated_by)
		VALUES ($1, $2, $3, 'contract-2026.10.0', $4)
		ON CONFLICT (tenant_id, port) DO UPDATE SET implementation = EXCLUDED.implementation,
		  activated_at = now(), activated_by = EXCLUDED.activated_by`, tenant, port, impl, by)
	return mapErr(err)
}
