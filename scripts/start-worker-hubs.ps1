param(
  [switch]$NoStart
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

$Hubs = @(
  @{
    Name = "JOA Worker Hub"
    Profile = "joa"
    Workspace = "C:\projects\TimOS-Agent"
    WorkerScript = "C:\projects\TimOS-Agent\scripts\command-channel-worker.js"
  },
  @{
    Name = "Finance Worker Hub"
    Profile = "finance"
    Workspace = "C:\projects\TimFinance"
    WorkerScript = "C:\projects\TimOS-Agent\scripts\command-channel-worker.js"
  },
  @{
    Name = "JuCore Worker Hub"
    Profile = "jucore"
    Workspace = "C:\projects\JuCore"
    WorkerScript = "C:\projects\TimOS-Agent\scripts\command-channel-worker.js"
  },
  @{
    Name = "Nova Worker Hub"
    Profile = "nova"
    Workspace = "C:\projects\NovaUniverse"
    WorkerScript = "C:\projects\TimOS-Agent\scripts\command-channel-worker.js"
  },
  @{
    Name = "GSync Worker Hub"
    Profile = "gsync"
    Workspace = "C:\projects\juos-knowledge-vault"
    WorkerScript = "C:\projects\TimOS-Agent\scripts\command-channel-worker.js"
  },
  @{
    Name = "SpaceA Worker Hub"
    Profile = "spacea"
    Workspace = "C:\projects\TimOS-Agent"
    WorkerScript = "C:\projects\TimOS-Agent\scripts\command-channel-worker.js"
    SkipWorkspaceExistenceCheck = $true
  },
  @{
    Name = "STUF Worker Hub"
    Profile = "stuf"
    Workspace = "C:\projects\SpaceA\STUF-Website"
    WorkerScript = "C:\projects\TimOS-Agent\scripts\command-channel-worker.js"
  },
  @{
    Name = "Ministry Worker Hub"
    Profile = "ministry"
    Workspace = "C:\projects\TimOS-Agent"
    WorkerScript = "C:\projects\TimOS-Agent\scripts\command-channel-worker.js"
    SkipWorkspaceExistenceCheck = $true
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
Write-Host "workspace=$($Hub.Workspace)"
Write-Host "Do not close this window while worker hub should remain active."
node "$($Hub.WorkerScript)" --http --worker-profile "$($Hub.Profile)" --cursor-agent
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
Write-Host "  Persistent polling hub active worker_profile=jucore"
Write-Host "  Persistent polling hub active worker_profile=nova"
Write-Host "  Persistent polling hub active worker_profile=spacea"
Write-Host "  Persistent polling hub active worker_profile=stuf"
Write-Host "  Persistent polling hub active worker_profile=ministry"
