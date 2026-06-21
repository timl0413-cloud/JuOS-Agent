param(
  [string]$RepoRoot = "",
  [int]$Port = 0,
  [switch]$Start,
  [switch]$ForceStop,
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = Split-Path $PSScriptRoot -Parent
}

if ($Port -le 0) {
  $envPort = [Environment]::GetEnvironmentVariable("COMMAND_CHANNEL_PORT", "Process")
  $parsedPort = 0
  if ($envPort -and [int]::TryParse($envPort, [ref]$parsedPort)) {
    $Port = $parsedPort
  } else {
    $Port = 8790
  }
}

$TowerUrl = "http://127.0.0.1:$Port/tower"
$PreviewUrl = "http://127.0.0.1:$Port/tower/preview"

function Write-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Detail = ""
  )

  $symbol = if ($Passed) { "PASS" } else { "WARN" }
  $line = "[$symbol] $Name"
  if ($Detail) {
    $line += " — $Detail"
  }
  Write-Host $line
}

function Test-AuthProfileConfigured {
  param(
    [string]$ProfileName,
    [string]$PlaceholderPrefix = "replace-with-"
  )

  $authPath = Join-Path $RepoRoot "config\auth.json"
  if (-not (Test-Path $authPath)) {
    return $false
  }

  try {
    $auth = Get-Content -Raw -Path $authPath | ConvertFrom-Json
    $entry = $auth.api_tokens | Where-Object { $_.name -eq $ProfileName } | Select-Object -First 1
    if (-not $entry) {
      return $false
    }
    $tokenValue = [string]$entry.token
    if ([string]::IsNullOrWhiteSpace($tokenValue)) {
      return $false
    }
    if ($tokenValue.StartsWith($PlaceholderPrefix)) {
      return $false
    }
    return $true
  } catch {
    return $false
  }
}

function Resolve-TokenSource {
  param(
    [string]$EnvName,
    [string]$AuthProfileName
  )

  if ([Environment]::GetEnvironmentVariable($EnvName, "Process")) {
    return "env:$EnvName"
  }

  if (Test-AuthProfileConfigured -ProfileName $AuthProfileName) {
    return "auth.json:$AuthProfileName"
  }

  return $null
}

function Test-CommandChannelAuthConfigured {
  $xiaojuSource = Resolve-TokenSource -EnvName "XIAOJU_ACTION_TOKEN" -AuthProfileName "xiaoju-command-channel"
  $workerSource = Resolve-TokenSource -EnvName "WORKER_TOKEN" -AuthProfileName "cloud-readonly-worker"
  return @{
    Configured = [bool]($xiaojuSource -and $workerSource)
    XiaoJuSource = $xiaojuSource
    WorkerSource = $workerSource
  }
}

function Get-PortListeners {
  param([int]$LocalPort)

  $listeners = @()

  try {
    $connections = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in @($connections)) {
      if ($conn.OwningProcess -and $conn.OwningProcess -gt 0) {
        $listeners += [pscustomobject]@{
          LocalAddress = $conn.LocalAddress
          OwningProcess = $conn.OwningProcess
        }
      }
    }
  } catch {
    # Fallback below when Get-NetTCPConnection is unavailable.
  }

  if ($listeners.Count -eq 0) {
    $netstatLines = & netstat -ano 2>$null | Select-String ":$LocalPort\s"
    foreach ($line in $netstatLines) {
      if ($line -notmatch "LISTENING") {
        continue
      }
      $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
      if ($parts.Count -lt 5) {
        continue
      }
      $pidText = $parts[-1]
      if ($pidText -match "^\d+$") {
        $listeners += [pscustomobject]@{
          LocalAddress = $parts[1]
          OwningProcess = [int]$pidText
        }
      }
    }
  }

  return $listeners | Sort-Object OwningProcess -Unique
}

function Get-ProcessSummary {
  param([int]$ProcessId)

  try {
    $proc = Get-Process -Id $ProcessId -ErrorAction Stop
    return "PID $ProcessId ($($proc.ProcessName))"
  } catch {
    return "PID $ProcessId (process details unavailable)"
  }
}

function Get-TowerHttpState {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
    $content = [string]$response.Content
    if ($content -match "LIVE DATA") {
      return "LIVE"
    }
    if ($content -match "This is not live yet") {
      return "SETUP"
    }
    if ($content -match "SAMPLE DATA ONLY") {
      return "SAMPLE"
    }
    return "UNKNOWN"
  } catch {
    return "UNAVAILABLE"
  }
}

function Test-CommandChannelPreview {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
    $content = [string]$response.Content
    return ($response.StatusCode -eq 200 -and $content -match "SAMPLE DATA ONLY")
  } catch {
    return $false
  }
}

function Stop-PortListeners {
  param(
    [array]$Listeners,
    [switch]$Force
  )

  if (-not $Force) {
    throw "Stop-PortListeners requires -Force"
  }

  foreach ($listener in $Listeners) {
    $summary = Get-ProcessSummary -ProcessId $listener.OwningProcess
    Write-Host "Stopping $summary on port $Port..."
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
  }
}

Write-Host "Control Tower helper v0"
Write-Host "RepoRoot: $RepoRoot"
Write-Host "Tower URL: $TowerUrl"
Write-Host "No token values will be printed. Do not paste tokens into chat."
Write-Host ""

# Node
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  $nodeVersion = (& node -v 2>&1 | Out-String).Trim()
  Write-Check -Name "Node.js" -Passed $true -Detail $nodeVersion
} else {
  Write-Check -Name "Node.js" -Passed $false -Detail "node not in PATH — install Node 18+"
  exit 1
}

# Repo
if (-not (Test-Path $RepoRoot)) {
  Write-Check -Name "Repo path" -Passed $false -Detail "directory not found"
  exit 1
}
Write-Check -Name "Repo path" -Passed $true -Detail $RepoRoot

$serverScript = Join-Path $RepoRoot "scripts\server-command-channel.js"
if (-not (Test-Path $serverScript)) {
  Write-Check -Name "Command channel server" -Passed $false -Detail "scripts/server-command-channel.js missing"
  exit 1
}
Write-Check -Name "Command channel server" -Passed $true -Detail "scripts/server-command-channel.js"

# Auth in this shell (what a server started here would see)
$authState = Test-CommandChannelAuthConfigured
if ($authState.Configured) {
  Write-Check -Name "Auth in this shell" -Passed $true -Detail ("xiaoju via {0}; worker via {1}" -f $authState.XiaoJuSource, $authState.WorkerSource)
  $expectedIfStartedHere = "LIVE DATA"
} else {
  $missing = @()
  if (-not $authState.XiaoJuSource) {
    $missing += "XIAOJU_ACTION_TOKEN or auth.json xiaoju-command-channel"
  }
  if (-not $authState.WorkerSource) {
    $missing += "WORKER_TOKEN or auth.json cloud-readonly-worker"
  }
  Write-Check -Name "Auth in this shell" -Passed $false -Detail ($missing -join "; ")
  $expectedIfStartedHere = "SETUP REQUIRED"
}

Write-Host ""
Write-Host "Port $Port check..."

$listeners = @(Get-PortListeners -LocalPort $Port)

if ($ForceStop -and $listeners.Count -gt 0) {
  Stop-PortListeners -Listeners $listeners -Force
  Start-Sleep -Seconds 1
  $listeners = @(Get-PortListeners -LocalPort $Port)
}

if ($listeners.Count -gt 0) {
  foreach ($listener in $listeners) {
    $summary = Get-ProcessSummary -ProcessId $listener.OwningProcess
    Write-Check -Name "Port $Port in use" -Passed $false -Detail "$summary listening on $($listener.LocalAddress)"
  }

  $previewOk = Test-CommandChannelPreview -Url $PreviewUrl
  if ($previewOk) {
    Write-Check -Name "Command channel server" -Passed $true -Detail "responding at $PreviewUrl"
    $towerState = Get-TowerHttpState -Url $TowerUrl
    switch ($towerState) {
      "LIVE" {
        Write-Host ""
        Write-Host "Server already running."
        Write-Host "Open: $TowerUrl"
        Write-Host "Expected browser result: LIVE DATA"
      }
      "SETUP" {
        Write-Host ""
        Write-Host "Server already running, but live bridge is not active in that process."
        Write-Host "Open: $TowerUrl"
        Write-Host "Expected browser result: SETUP REQUIRED (setup landing page)"
        Write-Host "Fix: stop that server and restart from a token-loaded supervisor shell in this repo."
        Write-Host "     Use -ForceStop only if you are sure nothing important owns port $Port."
      }
      default {
        Write-Host ""
        Write-Host "Server responds on port $Port but /tower state could not be classified."
        Write-Host "Open: $TowerUrl"
        Write-Host "Sample preview (always safe to open): $PreviewUrl"
      }
    }

    if ($OpenBrowser) {
      Start-Process $TowerUrl
    }

    exit 0
  }

  Write-Host ""
  Write-Host "EADDRINUSE: port $Port is owned by another process (not the command-channel preview probe)."
  Write-Host "This script does not stop processes unless you pass -ForceStop."
  Write-Host ""
  Write-Host "Safe options:"
  Write-Host "  1. If this is an old command-channel server, stop it manually or rerun with -ForceStop."
  Write-Host "  2. Or set COMMAND_CHANNEL_PORT to a free port before starting the server."
  Write-Host "  3. Or identify the owning PID above and stop only that process you recognize."
  exit 1
}

Write-Check -Name "Port $Port available" -Passed $true -Detail "no listener detected"

Write-Host ""
Write-Host "Summary"
Write-Host "-------"
Write-Host "Tower URL: $TowerUrl"
Write-Host "If you start the server from THIS shell: expected browser result = $expectedIfStartedHere"
Write-Host "Sample preview (no auth): $PreviewUrl"
Write-Host ""
Write-Host "CLI without server: npm run status:tower"
Write-Host ""

if (-not $Start) {
  Write-Host "Port is free. To start the server in this window:"
  Write-Host "  .\scripts\start-control-tower.ps1 -Start"
  Write-Host "Or:"
  Write-Host "  npm run tower:start"
  Write-Host ""
  Write-Host "Then open: $TowerUrl"
  if ($expectedIfStartedHere -eq "SETUP REQUIRED") {
    Write-Host ""
    Write-Host "Auth is missing in this shell — browser will show SETUP REQUIRED until you restart"
    Write-Host "from a token-loaded supervisor shell (do not paste tokens into chat)."
  }
  exit 0
}

Write-Host "Starting command-channel server (Ctrl+C to stop)..."
Write-Host "Watch startup for: Local live bridge: available/unavailable"
Write-Host ""

Push-Location $RepoRoot
try {
  if ($OpenBrowser) {
    Start-Job -ScriptBlock {
      param($Url)
      Start-Sleep -Seconds 2
      Start-Process $Url
    } -ArgumentList $TowerUrl | Out-Null
  }

  & npm run server:command-channel
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
