param(
  [switch]$NoStart,
  [ValidateSet("codex", "cursor")]
  [string]$Provider = "codex"
)

$ErrorActionPreference = "Stop"

$RequiredTokens = @(
  "XIAOJU_ACTION_TOKEN"
)

$MissingTokens = @()
foreach ($TokenName in $RequiredTokens) {
  if (-not [Environment]::GetEnvironmentVariable($TokenName, "Process")) {
    $MissingTokens += $TokenName
  }
}

if ($MissingTokens.Count -gt 0) {
  throw "Missing required token(s): $($MissingTokens -join ', '). 請從 Terminal B / token-loaded supervisor shell 啟動。"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node is not available in PATH. Please start from the normal development shell."
}

$AgentRoot = "C:\projects\TimOS-Agent"
$WorkerScript = Join-Path $AgentRoot "scripts\command-channel-worker.js"
$RegistryPath = Join-Path $AgentRoot "config\juos-room-registry.json"
$Registry = Get-Content -Raw -Path $RegistryPath | ConvertFrom-Json
$Hubs = @(
  $Registry.profiles.PSObject.Properties.Name |
    Sort-Object |
    ForEach-Object {
      @{
        Name = "$_ Worker Hub"
        Profile = $_
        Workspace = $Registry.profiles.$_.workspace_ref
        WorkerScript = $WorkerScript
      }
    }
)

foreach ($Hub in $Hubs) {
  if (-not $Hub.SkipWorkspaceExistenceCheck -and -not (Test-Path $Hub.Workspace)) {
    throw "Workspace not found for $($Hub.Name): $($Hub.Workspace)"
  }

  if (-not (Test-Path $Hub.WorkerScript)) {
    throw "Worker script not found for $($Hub.Name): $($Hub.WorkerScript)"
  }
}

Write-Host "Token-loaded supervisor shell verified."
Write-Host "No token values will be printed."
Write-Host "Provider: $Provider"
Write-Host ""

foreach ($Hub in $Hubs) {
  Write-Host "Configured: $($Hub.Name)"
  Write-Host "  profile:   $($Hub.Profile)"
  Write-Host "  workspace: $($Hub.Workspace)"
}

if ($NoStart) {
  Write-Host ""
  Write-Host "NoStart enabled. Validation only; no hub windows launched."
  exit 0
}

foreach ($Hub in $Hubs) {
  $ChildCommand = @"
`$Host.UI.RawUI.WindowTitle = "$($Hub.Name)"
Set-Location "$($Hub.Workspace)"
Write-Host "Starting $($Hub.Name)"
Write-Host "worker_profile=$($Hub.Profile)"
Write-Host "provider=$Provider"
Write-Host "workspace=$($Hub.Workspace)"
Write-Host "Do not close this window while worker hub should remain active."
node "$($Hub.WorkerScript)" --http --worker-profile "$($Hub.Profile)" --provider "$Provider" --allow-lane
"@

  $EncodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ChildCommand))

  Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    $EncodedCommand
  )
}

Write-Host ""
Write-Host "Worker hub windows launched from this token-loaded supervisor shell."
Write-Host "Expected in child windows:"
Write-Host "  Persistent polling hub active worker_profile=joa"
Write-Host "  Persistent polling hub active worker_profile=finance"
Write-Host "  Persistent polling hub active worker_profile=ob"
Write-Host "  Persistent polling hub active worker_profile=jucore"
Write-Host "  Persistent polling hub active worker_profile=nova"
Write-Host "  Persistent polling hub active worker_profile=gsync"
Write-Host "  Persistent polling hub active worker_profile=stuf"
