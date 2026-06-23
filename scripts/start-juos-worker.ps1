param(
  [string]$Profile = "finance",
  [string]$JobId = "",
  [string]$Workspace = "",
  [ValidateSet("codex", "cursor")]
  [string]$Provider = "codex",
  [switch]$NoCursorAgent,
  [switch]$Loop
)

$ErrorActionPreference = "Stop"

$AgentRoot = Split-Path -Parent $PSScriptRoot
$WorkerScript = Join-Path $AgentRoot "scripts\command-channel-worker.js"

if (-not $env:COMMAND_CHANNEL_URL) {
  $env:COMMAND_CHANNEL_URL = "https://juos.vercel.app/api/command-channel"
}

if (-not $Workspace) {
  switch ($Profile) {
    "joa" { $Workspace = "C:\projects\TimOS-Agent" }
    "nova-reading" { $Workspace = "C:\projects\TimOS-Agent" }
    "finance" { $Workspace = "C:\projects\TimFinance" }
    "ob" { $Workspace = "C:\projects\TimFinance" }
    "gsync" { $Workspace = "C:\projects\juos-knowledge-vault" }
    "jucore" { $Workspace = "C:\projects\JuCore" }
    "nova" { $Workspace = "C:\projects\Nova" }
    "spacea" { $Workspace = "C:\projects\TimOS-Agent" }
    "stuf" { $Workspace = "C:\projects\SpaceA\STUF-Website" }
    "ministry" { $Workspace = "C:\projects\TimOS-Agent" }
    "timos-core" { $Workspace = "C:\projects\TimOS-Core" }
    default { $Workspace = "C:\projects\TimOS-Agent" }
  }
}

$argsList = @(
  $WorkerScript,
  "--http",
  "--worker-profile",
  $Profile,
  "--provider",
  $Provider
)

if (-not $Loop) {
  $argsList += "--once"
}

if ($JobId) {
  $argsList += "--job-id"
  $argsList += $JobId
}

if ($Provider -eq "cursor" -and -not $NoCursorAgent) {
  $argsList += "--cursor-agent"
}

Write-Host "JUOS_WORKER_START profile=$Profile provider=$Provider workspace=$Workspace"

Push-Location $Workspace
try {
  node @argsList
} finally {
  Pop-Location
}
