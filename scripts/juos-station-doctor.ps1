param(
  [switch]$ReportOnly,
  [string]$RegistryPath = "config\juos-room-registry.json"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RegistryFullPath = Join-Path $Root $RegistryPath
$Failures = [System.Collections.Generic.List[string]]::new()
$Warnings = [System.Collections.Generic.List[string]]::new()

function Write-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Detail = "",
    [switch]$Warning
  )

  $Status = if ($Passed) { "PASS" } elseif ($Warning) { "WARN" } else { "FAIL" }
  if ($Detail) {
    Write-Host "$Status $Name - $Detail"
  } else {
    Write-Host "$Status $Name"
  }

  if (-not $Passed) {
    if ($Warning) {
      $script:Warnings.Add($Name)
    } else {
      $script:Failures.Add($Name)
    }
  }
}

function Find-CodexCommand {
  $Cmd = Get-Command codex.cmd -ErrorAction SilentlyContinue
  if ($Cmd) { return $Cmd }
  $Exe = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($Exe) { return $Exe }
  return $null
}

function Find-CursorFallback {
  $CursorCommand = Get-Command cursor -ErrorAction SilentlyContinue
  if ($CursorCommand) { return "PATH:$($CursorCommand.Source)" }

  $LocalAppData = [Environment]::GetEnvironmentVariable("LOCALAPPDATA")
  if ($LocalAppData) {
    $Versions = Join-Path $LocalAppData "cursor-agent\versions"
    if (Test-Path $Versions) {
      return $Versions
    }
  }
  return $null
}

if (-not (Test-Path $RegistryFullPath)) {
  Write-Check "registry exists" $false $RegistryPath
  exit 1
}

$Registry = Get-Content -Raw -Path $RegistryFullPath | ConvertFrom-Json
$Profiles = @($Registry.profiles.PSObject.Properties.Name | Sort-Object)

Write-Host "JuOS station doctor"
Write-Host "Mode: $(if ($ReportOnly) { 'report-only' } else { 'strict' })"
Write-Host "No token values will be printed."
Write-Host ""

foreach ($Profile in $Profiles) {
  $Workspace = $Registry.profiles.$Profile.workspace_ref
  Write-Check "workspace $Profile" (Test-Path $Workspace) $Workspace
}

$WorkerLauncher = Join-Path $Root "scripts\start-juos-worker.ps1"
$WorkerScript = Join-Path $Root "scripts\command-channel-worker.js"
Write-Check "worker launcher exists" (Test-Path $WorkerLauncher) "scripts\start-juos-worker.ps1"
Write-Check "worker script exists" (Test-Path $WorkerScript) "scripts\command-channel-worker.js"

$Codex = Find-CodexCommand
Write-Check "Codex command available" ($null -ne $Codex) $(if ($Codex) { $Codex.Source } else { "codex.cmd or codex.exe not found" })

$CodexPs1 = Get-Command codex.ps1 -ErrorAction SilentlyContinue
if ($CodexPs1 -and -not $Codex) {
  Write-Check "Codex native shim preferred" $false "only codex.ps1 detected; install codex.cmd or codex.exe" -Warning
}

$CursorFallback = Find-CursorFallback
Write-Check "Cursor fallback detectable" ($null -ne $CursorFallback) $(if ($CursorFallback) { $CursorFallback } else { "not detected" }) -Warning

$TokenNames = @("XIAOJU_ACTION_TOKEN", "WORKER_TOKEN", "COMMAND_CHANNEL_WORKER_TOKEN")
$PresentTokens = @()
foreach ($TokenName in $TokenNames) {
  if ([Environment]::GetEnvironmentVariable($TokenName, "Process")) {
    $PresentTokens += $TokenName
  }
}
Write-Check "token env present" ($PresentTokens.Count -gt 0) $(if ($PresentTokens.Count -gt 0) { ($PresentTokens -join ", ") } else { "expected one of: $($TokenNames -join ', ')" })

Write-Host ""
Write-Host "Report-only: no workers started, no jobs claimed."

if (-not $ReportOnly -and $Failures.Count -gt 0) {
  Write-Host "Station doctor failed: $($Failures.Count) issue(s)."
  exit 1
}

if ($Failures.Count -gt 0) {
  Write-Host "Station doctor found $($Failures.Count) blocker(s) and $($Warnings.Count) warning(s)."
  exit 1
}

Write-Host "Station doctor passed with $($Warnings.Count) warning(s)."
