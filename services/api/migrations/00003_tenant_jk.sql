-- MD-056: the single hackathon tenant (Jammu & Kashmir). Multi-tenant ready: another state is
-- one more row here plus its rule pack; nothing in code names JK except DEFAULT tenant config.
-- Adapter modes follow the hackathon defaults (INTEGRATIONS §1): Sarathi Mode A deeplink, mocks
-- elsewhere, payment by redirect to the state's own page (Margdarshak never collects fees).

-- +goose Up
INSERT INTO core.tenants (tenant_id, display_name, display_name_key, hosting_mode, languages, theme,
  rule_pack_id, rule_pack_version, rule_pack_base_version, features, grievance_officer, hosts, web_origins)
VALUES (
  'JK',
  '{"en": "Jammu & Kashmir", "hi": "जम्मू और कश्मीर"}',
  'tenant.jk',
  'independent',
  ARRAY['en', 'hi', 'doi'],
  '{"primary": "#1F4E79", "surface": "#FFFFFF", "logo_url": null}',
  'JK', '2026.10.0', 'IN-base@2026.10.0',
  '{"ai_coach": true, "voice_guide": true, "live_intel": true, "school_portal": true, "family_mode": true, "sms": false, "aadhaar_offline": true}',
  '{"name": "Grievance Officer (Team Chanakya, synthetic)", "email": "grievance@margdarshak.example"}',
  ARRAY['localhost', 'jk.margdarshak.example'],
  ARRAY['http://localhost:3000']
)
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO core.tenant_adapter_config (tenant_id, port, implementation, contract_suite_version) VALUES
  ('JK', 'sarathi', 'deeplink', 'contract-2026.10.0'),
  ('JK', 'digilocker', 'mock', 'contract-2026.10.0'),
  ('JK', 'aadhaar_offline', 'mock', 'contract-2026.10.0'),
  ('JK', 'bhashini', 'mock', 'contract-2026.10.0'),
  ('JK', 'payment', 'sarathi_redirect', 'contract-2026.10.0'),
  ('JK', 'notification', 'console', 'contract-2026.10.0'),
  ('JK', 'slot', 'mock', 'contract-2026.10.0')
ON CONFLICT (tenant_id, port) DO NOTHING;

-- +goose Down
DELETE FROM core.tenant_adapter_config WHERE tenant_id = 'JK';
DELETE FROM core.tenants WHERE tenant_id = 'JK';
