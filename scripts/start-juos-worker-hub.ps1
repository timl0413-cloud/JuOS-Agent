param(
  [string[]]$Profiles = @(),
  [int]$SleepSeconds = 5,
  [ValidateSet("codex", "cursor")]
  [string]$Provider = "codex",
  [switch]$NoCursorAgent
)

$ErrorActionPreference = "Continue"

$AgentRoot = "C:\projects\TimOS-Agent"
$WorkerScript = Join-Path $AgentRoot "scripts\command-channel-worker.js"
$RegistryPath = Join-Path $AgentRoot "config\juos-room-registry.json"
$Registry = Get-Content -Raw -Path $RegistryPath | ConvertFrom-Json

if ($Profiles.Count -eq 0) {
  $Profiles = @($Registry.profiles.PSObject.Properties.Name | Sort-Object)
}

if (-not $env:COMMAND_CHANNEL_URL) {
  $env:COMMAND_CHANNEL_URL = "https://juos.vercel.app/api/command-channel"
}

function Get-WorkspaceForProfile {
  param([string]$Profile)

  if ($Registry.profiles.PSObject.Properties.Name -contains $Profile) {
    return $Registry.profiles.$Profile.workspace_ref
  }
  return "C:\projects\TimOS-Agent"
}

Write-Host "JUOS_WORKER_HUB_START"
Write-Host "Profiles: $($Profiles -join ', ')"
Write-Host "Provider: $Provider"
Write-Host "Command channel: $env:COMMAND_CHANNEL_URL"
Write-Host "Press Ctrl+C to stop."

while ($true) {
  foreach ($profile in $Profiles) {
    $workspace = Get-WorkspaceForProfile $profile

    if (-not (Test-Path $workspace)) {
      Write-Host "SKIP profile=$profile missing workspace=$workspace"
      continue
    }

    $argsList = @(
      $WorkerScript,
      "--http",
      "--once",
      "--quiet",
      "--worker-profile",
      $profile,
      "--provider",
      $Provider,
      "--allow-lane"
    )

    if ($Provider -eq "cursor" -and -not $NoCursorAgent) {
      $argsList += "--cursor-agent"
    }

    Push-Location $workspace
    try {
      node @argsList
    } catch {
      Write-Host "WORKER_ERROR profile=$profile"
      Write-Host $_
    } finally {
      Pop-Location
    }
  }

  Start-Sleep -Seconds $SleepSeconds
}
