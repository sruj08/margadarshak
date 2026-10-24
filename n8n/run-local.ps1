# Prototype n8n without Docker: pwsh n8n/run-local.ps1   (then open http://localhost:5678)
# Staff operations only; no WhatsApp / Telegram / SMTP needed. Reads secrets from the repo .env.
$root = Split-Path $PSScriptRoot -Parent
Get-Content "$root\.env" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] }
}
$env:N8N_USER_FOLDER = "$root\.n8n-data"
$env:GENERIC_TIMEZONE = "Asia/Kolkata"
$env:N8N_BLOCK_ENV_ACCESS_IN_NODE = "false"
$env:NODE_FUNCTION_ALLOW_BUILTIN = "crypto"
$env:N8N_DIAGNOSTICS_ENABLED = "false"
$env:N8N_PERSONALIZATION_ENABLED = "false"
$env:MD_API_BASE = if ($env:MD_API_BASE) { $env:MD_API_BASE } else { "http://localhost:8000" }
$env:MD_HMAC_SECRET = $env:INTERNAL_HMAC_SECRET
$env:MD_N8N_READ_TOKEN = if ($env:N8N_BEARER_TOKEN) { $env:N8N_BEARER_TOKEN } else { "dev-internal-token" }
npx -y n8n import:workflow --separate --input="$PSScriptRoot\workflows\P01-demo-sweep.json"
npx -y n8n start
