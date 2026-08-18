<#
.SYNOPSIS
  Pushes prompts/digital-finance-manager/pricing.json to the live Tavus persona.

.DESCRIPTION
  Run this after editing pricing.json (product coverage bullets, negotiation tiers).
  It does NOT edit any code — it just re-reads the JSON file (already wired into the
  running app) and pushes the regenerated tool schema to Tavus. The app itself picks up
  content-panel changes automatically on the next page load; this script is only needed
  to update the persona's tool definitions on Tavus's side (the daily_rate/product enums).

  Requires the app to be running (npm run start, or npm run dev) on the URL you pass in.

  If DEMO_API_TOKEN is set (true for any "npm run start" / production run), the login
  cookie is marked Secure — meaning, same as a real browser, it will NOT be sent over
  plain http://. Point -BaseUrl at an https:// URL (your ngrok tunnel or real deployed
  URL) when running against a production server. Plain http://localhost only works
  against "npm run dev" (DEMO_API_TOKEN skipped) or if DEMO_API_TOKEN is unset.

.PARAMETER BaseUrl
  Where the app is running. Defaults to http://localhost:3000 (dev). Use your https://
  ngrok/deployed URL when the target is running in production mode — see note above.

.EXAMPLE
  ./scripts/push-pricing-config.ps1

.EXAMPLE
  ./scripts/push-pricing-config.ps1 -BaseUrl https://your-deployed-url.example.com
#>
param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env.local"

if (-not (Test-Path $envPath)) {
  Write-Error "No .env.local found at $envPath."
}

$envVars = @{}
foreach ($line in Get-Content $envPath) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $parts = $line -split '=', 2
  $envVars[$parts[0].Trim()] = $parts[1].Trim()
}

$demoToken = $envVars["DEMO_API_TOKEN"]
$webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

if (-not [string]::IsNullOrWhiteSpace($demoToken)) {
  Write-Host "Authenticating..."
  Invoke-WebRequest -Uri "$BaseUrl/api/auth" -Method Post -UseBasicParsing -WebSession $webSession `
    -ContentType "application/json" -Body (@{ token = $demoToken } | ConvertTo-Json) | Out-Null
}

Write-Host "Pushing pricing.json to the live persona..."
$response = Invoke-RestMethod -Uri "$BaseUrl/api/persona/setup-tools" -Method Post -WebSession $webSession

if ($response.ok) {
  Write-Host "Done. Persona tools updated from pricing.json." -ForegroundColor Green
} else {
  Write-Error "Push failed: $($response.error)"
}
