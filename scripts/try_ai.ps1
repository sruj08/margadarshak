# Calls the AI endpoints (Google ADK + Gemini) on the local API as the demo persona Kabir.
# Usage: pwsh scripts/try_ai.ps1   (API on :8000 with GEMINI_API_KEY in .env)
$api = if ($env:API_BASE) { $env:API_BASE } else { "http://localhost:8000" }
$jar = New-TemporaryFile
function Post($path, $json) {
  $f = New-TemporaryFile; Set-Content $f $json -NoNewline
  curl.exe -s -b $jar -c $jar -X POST "$api$path" -H "Content-Type: application/json" -H "X-Requested-With: margdarshak" -H "Idempotency-Key: $([guid]::NewGuid())" --data-binary "@$f"
}
Write-Host "== persona session"
Post "/v1/demo/personas/kabir_day12/session" "{}" | Select-Object -First 1 | ForEach-Object { $_.Substring(0, [Math]::Min(200, $_.Length)) }
Write-Host "`n== API-43 scam check"
Post "/v1/scam/check" '{"text":"RTO notice: licence blocked. Install rto-help.apk and share OTP within 2 hours."}'
Write-Host "`n`n== API-41 tutor explain (wrong answer b, correct is a)"
Post "/v1/tutor/explain" '{"question_id":"C-LL1-001","variant_id":"v1","chosen_option_id":"b","locale":"en"}'
Write-Host "`n`n== API-42 decode (no file: expect 400/422)"
curl.exe -s -b $jar -X POST "$api/v1/decode/screenshot" -H "X-Requested-With: margdarshak" -F "case_id=x"
Write-Host ""
