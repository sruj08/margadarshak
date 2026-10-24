# Calls API-43 (POST /v1/scam/check) on the local API. Usage: pwsh scripts/try_scam.ps1 "message text"
param([string]$Text = "RTO notice: your licence is blocked. Install rto-help.apk and share the OTP within 2 hours.")
$api = if ($env:API_BASE) { $env:API_BASE } else { "http://localhost:8000" }
$jar = New-TemporaryFile
$key = "MCowBQYDK2VwAyEA" + ("x" * 43)
$body = @{ device_public_key = $key; platform = "android_web"; app_version = "0.1.0"; lite_mode = $false } | ConvertTo-Json
$tmp = New-TemporaryFile; Set-Content $tmp $body -NoNewline
curl.exe -s -c $jar -X POST "$api/v1/sessions/device" -H "Content-Type: application/json" -H "Idempotency-Key: $([guid]::NewGuid())" --data-binary "@$tmp" | Out-Null
$tmp2 = New-TemporaryFile; Set-Content $tmp2 (@{ text = $Text } | ConvertTo-Json) -NoNewline
curl.exe -s -b $jar -X POST "$api/v1/scam/check" -H "Content-Type: application/json" -H "X-Requested-With: margdarshak" --data-binary "@$tmp2"
Write-Host ""
