param(
  [string]$RepoRoot = "C:\projects\TimOS-Agent",
  [switch]$RunStatusProbe
)

$ErrorActionPreference = "Stop"

function Write-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Detail = ""
  )

  $symbol = if ($Passed) { "PASS" } else { "FAIL" }
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

$failCount = 0

Write-Host "Worker hub preflight (Station 4/5 bootstrap v0)"
Write-Host "RepoRoot: $RepoRoot"
Write-Host "No token values will be printed."
Write-Host ""

# Node
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  $nodeVersion = (& node -v 2>&1 | Out-String).Trim()
  Write-Check -Name "Node.js" -Passed $true -Detail $nodeVersion
} else {
  Write-Check -Name "Node.js" -Passed $false -Detail "node not in PATH"
  $failCount++
}

# Repo path
if (Test-Path $RepoRoot) {
  Write-Check -Name "Repo path" -Passed $true -Detail $RepoRoot
} else {
  Write-Check -Name "Repo path" -Passed $false -Detail "directory not found"
  $failCount++
}

# Git repo
$gitDir = Join-Path $RepoRoot ".git"
if ((Test-Path $RepoRoot) -and (Test-Path $gitDir)) {
  Write-Check -Name "Git repository" -Passed $true -Detail ".git present"
} else {
  Write-Check -Name "Git repository" -Passed $false -Detail ".git missing"
  $failCount++
}

# Required scripts
$requiredScripts = @(
  "scripts\start-joa-worker-loop.ps1",
  "scripts\start-juos-worker.ps1",
  "scripts\command-channel-worker.js",
  "scripts\command-channel-status.js"
)

foreach ($relativePath in $requiredScripts) {
  $fullPath = Join-Path $RepoRoot $relativePath
  $exists = Test-Path $fullPath
  Write-Check -Name "Script $relativePath" -Passed $exists
  if (-not $exists) {
    $failCount++
  }
}

# Optional env file hints (existence only — never read values)
$optionalEnvFiles = @(
  "config\command-channel-worker.env",
  ".env.command-channel-worker",
  ".env.juos.prod.local"
)

$envHints = @()
foreach ($relativePath in $optionalEnvFiles) {
  $fullPath = Join-Path $RepoRoot $relativePath
  if (Test-Path $fullPath) {
    $envHints += $relativePath
  }
}

if ($envHints.Count -gt 0) {
  Write-Check -Name "Optional env files" -Passed $true -Detail ($envHints -join ", ")
} else {
  Write-Check -Name "Optional env files" -Passed $true -Detail "none found (env vars or auth.json may still suffice)"
}

# Worker token (loop)
$workerSource = Resolve-TokenSource -EnvName "WORKER_TOKEN" -AuthProfileName "cloud-readonly-worker"
if ($workerSource) {
  Write-Check -Name "Worker token configured" -Passed $true -Detail $workerSource
} else {
  Write-Check -Name "Worker token configured" -Passed $false -Detail "set WORKER_TOKEN or config/auth.json cloud-readonly-worker"
  $failCount++
}

# XiaoJu token (status CLI)
$xiaojuSource = Resolve-TokenSource -EnvName "XIAOJU_ACTION_TOKEN" -AuthProfileName "xiaoju-command-channel"
if ($xiaojuSource) {
  Write-Check -Name "Status token configured" -Passed $true -Detail $xiaojuSource
} else {
  Write-Check -Name "Status token configured" -Passed $false -Detail "set XIAOJU_ACTION_TOKEN or config/auth.json xiaoju-command-channel"
  $failCount++
}

# COMMAND_CHANNEL_URL
$channelUrl = [Environment]::GetEnvironmentVariable("COMMAND_CHANNEL_URL", "Process")
if (-not $channelUrl) {
  $channelUrl = "https://juos.vercel.app/api/command-channel (default)"
}
Write-Check -Name "Command channel URL" -Passed $true -Detail $channelUrl

# Status command availability
$statusScript = Join-Path $RepoRoot "scripts\command-channel-status.js"
if (Test-Path $statusScript) {
  Write-Check -Name "Status CLI available" -Passed $true -Detail "scripts/command-channel-status.js"
} else {
  Write-Check -Name "Status CLI available" -Passed $false
  $failCount++
}

if ($RunStatusProbe) {
  Write-Host ""
  Write-Host "Running read-only HTTP time sweep (profile=joa)..."
  Push-Location $RepoRoot
  try {
    & node scripts/command-channel-status.js --http --time-sweep --profile joa
    if ($LASTEXITCODE -ne 0) {
      Write-Check -Name "HTTP status probe" -Passed $false -Detail "exit code $LASTEXITCODE"
      $failCount++
    } else {
      Write-Check -Name "HTTP status probe" -Passed $true -Detail "time sweep succeeded"
    }
  } catch {
    Write-Check -Name "HTTP status probe" -Passed $false -Detail $_.Exception.Message
    $failCount++
  } finally {
    Pop-Location
  }
} else {
  Write-Check -Name "HTTP status probe" -Passed $true -Detail "skipped (use -RunStatusProbe to test live API)"
}

Write-Host ""
if ($failCount -eq 0) {
  Write-Host "Preflight PASSED. Next: .\scripts\start-joa-worker-loop.ps1"
  exit 0
}

Write-Host "Preflight FAILED ($failCount check(s)). Fix items above before starting worker loop."
exit 1
