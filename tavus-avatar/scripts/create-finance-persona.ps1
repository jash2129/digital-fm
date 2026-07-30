<#
.SYNOPSIS
  One-time setup: creates the Tavus persona for the Digital Finance Manager.

.DESCRIPTION
  Reads TAVUS_API_KEY (and, if -UseOpenAI is passed, OPENAI_API_KEY) from
  .env.local so the keys never need to be typed into a terminal command or
  pasted into chat. Creates a persona using the placeholder system prompt at
  prompts/digital-finance-manager/system-instruction.md, then prints the
  persona_id to paste into TAVUS_PERSONA_ID in .env.local.

.PARAMETER ReplicaId
  A stock replica ID from your Tavus dashboard (Replicas -> Stock Replicas),
  e.g. r72f7f7f7c8b.

.PARAMETER UseOpenAI
  If set, points the persona's LLM layer at your own OpenAI account
  (gpt-4o-mini) instead of Tavus's built-in tavus-gpt-4o model. Requires
  OPENAI_API_KEY to be set in .env.local.

.EXAMPLE
  ./scripts/create-finance-persona.ps1 -ReplicaId r72f7f7f7c8b

.EXAMPLE
  ./scripts/create-finance-persona.ps1 -ReplicaId r72f7f7f7c8b -UseOpenAI
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$ReplicaId,

  [switch]$UseOpenAI
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env.local"
$promptPath = Join-Path (Split-Path -Parent $repoRoot) "prompts/digital-finance-manager/system-instruction.md"

if (-not (Test-Path $envPath)) {
  Write-Error "No .env.local found at $envPath. Create it first (see env.example)."
}

$envVars = @{}
foreach ($line in Get-Content $envPath) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $parts = $line -split '=', 2
  $envVars[$parts[0].Trim()] = $parts[1].Trim()
}

$tavusKey = $envVars["TAVUS_API_KEY"]
if ([string]::IsNullOrWhiteSpace($tavusKey)) {
  Write-Error "TAVUS_API_KEY is empty in .env.local. Fill it in first."
}

if (-not (Test-Path $promptPath)) {
  Write-Error "System prompt not found at $promptPath."
}
$systemPrompt = Get-Content $promptPath -Raw

$llmLayer = @{ model = "tavus-gpt-4o" }
if ($UseOpenAI) {
  $openAiKey = $envVars["OPENAI_API_KEY"]
  if ([string]::IsNullOrWhiteSpace($openAiKey)) {
    Write-Error "OPENAI_API_KEY is empty in .env.local but -UseOpenAI was passed."
  }
  $llmLayer = @{
    model    = "gpt-4o"
    base_url = "https://api.openai.com/v1"
    api_key  = $openAiKey
  }
}

$body = @{
  persona_name        = "Digital Finance Manager - Prototype"
  default_replica_id  = $ReplicaId
  system_prompt       = $systemPrompt
  layers              = @{ llm = $llmLayer }
} | ConvertTo-Json -Depth 10

Write-Host "Creating Tavus persona (replica: $ReplicaId, LLM: $(if ($UseOpenAI) { 'OpenAI gpt-4o-mini' } else { 'Tavus built-in gpt-4o' }))..."

$response = Invoke-RestMethod -Uri "https://tavusapi.com/v2/personas" `
  -Method Post `
  -Headers @{ "x-api-key" = $tavusKey; "Content-Type" = "application/json" } `
  -Body $body

Write-Host ""
Write-Host "Created persona: $($response.persona_id)" -ForegroundColor Green
Write-Host "Next step: set TAVUS_PERSONA_ID=$($response.persona_id) in .env.local"
