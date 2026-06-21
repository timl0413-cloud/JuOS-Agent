param(
  [string]$RepoRoot = "",
  [int]$Port = 0,
  [switch]$Start,
  [switch]$ForceStop,
  [switch]$OpenBrowser,
  [switch]$Watch
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
    $line += " - $Detail"
  }
  Write-Host $line
}

function Get-AuthJsonToken {
  param(
    [string]$ProfileName,
    [string]$PlaceholderPrefix = "replace-with-"
  )

  $authPath = Join-Path $RepoRoot "config\auth.json"
  if (-not (Test-Path $authPath)) {
    return $null
  }

  try {
    $auth = Get-Content -Raw -Path $authPath | ConvertFrom-Json
    $entry = $auth.api_tokens | Where-Object { $_.name -eq $ProfileName } | Select-Object -First 1
    if (-not $entry) {
      return $null
    }
    $tokenValue = [string]$entry.token
    if ([string]::IsNullOrWhiteSpace($tokenValue)) {
      return $null
    }
    if ($tokenValue.StartsWith($PlaceholderPrefix)) {
      return $null
    }
    return @{ Value = $tokenValue }
  } catch {
    return $null
  }
}

function Resolve-CommandChannelToken {
  param(
    [string]$EnvName,
    [string]$AuthProfileName
  )

  foreach ($scope in @("Process", "User", "Machine")) {
    $value = [Environment]::GetEnvironmentVariable($EnvName, $scope)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return @{
        Value = $value
        Source = "env:$EnvName ($scope)"
      }
    }
  }

  $authToken = Get-AuthJsonToken -ProfileName $AuthProfileName
  if ($authToken) {
    return @{
      Value = $authToken.Value
      Source = "auth.json:$AuthProfileName"
    }
  }

  return $null
}

function Import-CommandChannelAuthToProcess {
  $xiaoju = Resolve-CommandChannelToken -EnvName "XIAOJU_ACTION_TOKEN" -AuthProfileName "xiaoju-command-channel"
  $worker = Resolve-CommandChannelToken -EnvName "WORKER_TOKEN" -AuthProfileName "cloud-readonly-worker"

  if ($xiaoju -and -not [Environment]::GetEnvironmentVariable("XIAOJU_ACTION_TOKEN", "Process")) {
    $env:XIAOJU_ACTION_TOKEN = $xiaoju.Value
  }
  if ($worker -and -not [Environment]::GetEnvironmentVariable("WORKER_TOKEN", "Process")) {
    $env:WORKER_TOKEN = $worker.Value
  }

  return @{
    Configured = [bool]($xiaoju -and $worker)
    XiaoJuSource = if ($xiaoju) { $xiaoju.Source } else { $null }
    WorkerSource = if ($worker) { $worker.Source } else { $null }
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

function Get-TowerHealthUrl {
  param([int]$LocalPort)

  return "http://127.0.0.1:$LocalPort/health"
}

function Test-TowerHealthEndpoint {
  param(
    [int]$LocalPort,
    [int]$TimeoutSec = 2
  )

  $healthUrl = Get-TowerHealthUrl -LocalPort $LocalPort
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec $TimeoutSec
    if ($response.StatusCode -ne 200) {
      return $false
    }
    $content = [string]$response.Content
    return ($content -match '"ok"\s*:\s*true')
  } catch {
    return $false
  }
}

function Wait-TowerServerReady {
  param(
    [int]$LocalPort,
    [System.Diagnostics.Process]$ServerProcess = $null,
    [int]$TimeoutSeconds = 60,
    [int]$PollIntervalMs = 500
  )

  $healthUrl = Get-TowerHealthUrl -LocalPort $LocalPort
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $attempt = 0

  Write-Host "Waiting for Tower server at $healthUrl ..."

  while ((Get-Date) -lt $deadline) {
    $attempt++
    if ($ServerProcess -and $ServerProcess.HasExited) {
      $exitCode = $ServerProcess.ExitCode
      throw [System.InvalidOperationException]::new(
        "Server process exited before health check passed (exit code $exitCode). Command: npm run server:command-channel"
      )
    }

    if (Test-TowerHealthEndpoint -LocalPort $LocalPort -TimeoutSec 2) {
      Write-Check -Name "Tower server ready" -Passed $true -Detail $healthUrl
      return
    }

    if ($attempt -eq 1 -or ($attempt % 10) -eq 0) {
      Write-Host "  still waiting... (attempt $attempt)"
    }

    Start-Sleep -Milliseconds $PollIntervalMs
  }

  throw [System.InvalidOperationException]::new(
    "Tower server did not respond within ${TimeoutSeconds}s. Probe: $healthUrl. Command: npm run server:command-channel"
  )
}

function Write-TowerStartupFailure {
  param(
    [string]$Message,
    [System.Diagnostics.Process]$ServerProcess = $null,
    [string]$Root = $RepoRoot
  )

  Write-Host ""
  Write-Host "ERROR: Tower server failed to start."
  Write-Host $Message
  Write-Host "Command: npm run server:command-channel"
  Write-Host "Working directory: $Root"
  if ($ServerProcess -and $ServerProcess.HasExited) {
    Write-Host "Process exit code: $($ServerProcess.ExitCode)"
  }
  Write-Host ""
  Write-Host "Browser was NOT opened. Fix the issue above and retry:"
  Write-Host "  .\scripts\start-control-tower.ps1 -Start -Watch -ForceStop -OpenBrowser"
}

function Start-CommandChannelServerProcess {
  param([string]$Root)

  $serverScript = Join-Path $Root "scripts\server-command-channel.js"
  return Start-Process -FilePath "node" -ArgumentList @($serverScript) -WorkingDirectory $Root -PassThru -NoNewWindow
}

function Open-TowerBrowser {
  param([string]$Url)

  Write-Host "Opening browser: $Url"
  Start-Process $Url
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

function Get-TowerWatchFilePaths {
  param([string]$Root)

  return @(
    (Join-Path $Root "config\tower-current-batch.json"),
    (Join-Path $Root "lib\tower-current-batch-manifest.js"),
    (Join-Path $Root "lib\tower-server-build-marker.js"),
    (Join-Path $Root "lib\command-channel-short-status-page.js"),
    (Join-Path $Root "scripts\start-control-tower.ps1")
  )
}

function Start-TowerWatchLoop {
  param(
    [string]$Root,
    [int]$LocalPort,
    [string]$TowerPageUrl,
    [switch]$OpenBrowserOnStart
  )

  $watchPaths = @(Get-TowerWatchFilePaths -Root $Root | Where-Object { Test-Path $_ })
  if ($watchPaths.Count -eq 0) {
    Write-Host "Watch mode: no watch files found - starting server once."
    $serverProcess = Start-CommandChannelServerProcess -Root $Root
    try {
      Wait-TowerServerReady -LocalPort $LocalPort -ServerProcess $serverProcess
      if ($OpenBrowserOnStart) {
        Open-TowerBrowser -Url $TowerPageUrl
      }
      Wait-Process -Id $serverProcess.Id
      return $serverProcess.ExitCode
    } catch {
      if ($serverProcess -and -not $serverProcess.HasExited) {
        try { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue } catch {}
      }
      Write-TowerStartupFailure -Message $_.Exception.Message -ServerProcess $serverProcess -Root $Root
      return 1
    }
  }

  Write-Host "Watch mode: auto-restart when Tower files change (Ctrl+C to stop)."
  Write-Host "Watching:"
  foreach ($watchPath in $watchPaths) {
    Write-Host "  - $watchPath"
  }
  Write-Host ""

  function Get-WatchBaselines {
    param([array]$Paths)

    $baselines = @{}
    foreach ($watchPath in $Paths) {
      $baselines[$watchPath] = (Get-Item -LiteralPath $watchPath).LastWriteTimeUtc
    }
    return $baselines
  }

  function Test-WatchPathsChanged {
    param(
      [array]$Paths,
      [hashtable]$Baselines,
      [ref]$ChangedPath
    )

    foreach ($watchPath in $Paths) {
      $current = (Get-Item -LiteralPath $watchPath).LastWriteTimeUtc
      if ($current -gt $Baselines[$watchPath]) {
        $Baselines[$watchPath] = $current
        $ChangedPath.Value = $watchPath
        return $true
      }
    }
    return $false
  }

  $watchBaselines = Get-WatchBaselines -Paths $watchPaths
  $openedBrowser = $false
  $pollIntervalSeconds = 2

  while ($true) {
    Write-Host "Starting command-channel server..."
    $serverProcess = Start-CommandChannelServerProcess -Root $Root
    $restartRequested = $false
    $restartReason = ""

    try {
      Wait-TowerServerReady -LocalPort $LocalPort -ServerProcess $serverProcess
      if ($OpenBrowserOnStart -and -not $openedBrowser) {
        Open-TowerBrowser -Url $TowerPageUrl
        $openedBrowser = $true
      }
    } catch {
      if ($serverProcess -and -not $serverProcess.HasExited) {
        try { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue } catch {}
      }
      Write-TowerStartupFailure -Message $_.Exception.Message -ServerProcess $serverProcess -Root $Root
      return 1
    }

    while (-not $serverProcess.HasExited) {
      Start-Sleep -Seconds $pollIntervalSeconds
      $changedPath = ""
      if (Test-WatchPathsChanged -Paths $watchPaths -Baselines $watchBaselines -ChangedPath ([ref]$changedPath)) {
        $restartRequested = $true
        $restartReason = $changedPath
        Write-Host ""
        Write-Host "Tower file changed: $restartReason"
        Write-Host "Restarting command-channel server..."
        try {
          Stop-Process -Id $serverProcess.Id -Force -ErrorAction Stop
        } catch {
          Write-Host "WARN: could not stop server PID $($serverProcess.Id) cleanly."
        }
        Start-Sleep -Seconds 1
        break
      }
    }

    if ($serverProcess.HasExited -and -not $restartRequested) {
      Write-Host ""
      Write-Host "ERROR: command-channel server exited unexpectedly (exit code $($serverProcess.ExitCode))."
      Write-Host "Command: npm run server:command-channel"
      Write-Host "Working directory: $Root"
      return $serverProcess.ExitCode
    }
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
  Write-Check -Name "Node.js" -Passed $false -Detail "node not in PATH - install Node 18+"
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

# Load auth from Process/User/Machine env or auth.json into this process for the server child.
$authState = Import-CommandChannelAuthToProcess
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
        Write-Host "Fix: stop that server and restart so auth loads into the server process."
        Write-Host "     Example: .\scripts\start-control-tower.ps1 -Start -ForceStop -OpenBrowser"
        Write-Host "     Auth may live in User/Machine env or config\auth.json; this script copies found values into the server process without printing them."
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
  Write-Host "Dev watch (auto-restart on Tower file changes):"
  Write-Host "  .\scripts\start-control-tower.ps1 -Start -Watch -ForceStop -OpenBrowser"
  Write-Host "Or:"
  Write-Host "  npm run tower:start"
  Write-Host ""
  Write-Host "Then open: $TowerUrl"
  if ($expectedIfStartedHere -eq "SETUP REQUIRED") {
    Write-Host ""
    Write-Host "Auth is missing from Process/User/Machine env and config\auth.json - browser will show SETUP REQUIRED."
    Write-Host "Configure tokens in Windows User env or config\auth.json (do not paste tokens into chat)."
  }
  exit 0
}

Write-Host "Starting command-channel server (Ctrl+C to stop)..."
if ($Watch) {
  Write-Host "Watch mode enabled - server restarts when Tower code/config files change."
} else {
  Write-Host "Tip: add -Watch to auto-restart after Tower code changes."
}
Write-Host "Watch startup for: Local live bridge: available/unavailable"
Write-Host ""

Push-Location $RepoRoot
try {
  if ($Watch) {
    $watchExit = Start-TowerWatchLoop -Root $RepoRoot -LocalPort $Port -TowerPageUrl $TowerUrl -OpenBrowserOnStart:$OpenBrowser
    exit $watchExit
  }

  $serverProcess = Start-CommandChannelServerProcess -Root $RepoRoot
  try {
    Wait-TowerServerReady -LocalPort $Port -ServerProcess $serverProcess
    if ($OpenBrowser) {
      Open-TowerBrowser -Url $TowerUrl
    }
    Write-Host ""
    Write-Host "Command-channel server running (Ctrl+C to stop this launcher)..."
    Wait-Process -Id $serverProcess.Id
    exit $serverProcess.ExitCode
  } catch {
    if ($serverProcess -and -not $serverProcess.HasExited) {
      try { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    Write-TowerStartupFailure -Message $_.Exception.Message -ServerProcess $serverProcess -Root $RepoRoot
    exit 1
  }
} finally {
  Pop-Location
}
