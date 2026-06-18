param(
  [string[]]$Profiles = @("joa", "nova-reading", "finance", "ob", "gsync"),
  [int]$SleepSeconds = 5,
  [switch]$NoCursorAgent
)

$ErrorActionPreference = "Continue"

$AgentRoot = "C:\projects\TimOS-Agent"
$WorkerScript = Join-Path $AgentRoot "scripts\command-channel-worker.js"

if (-not $env:COMMAND_CHANNEL_URL) {
  $env:COMMAND_CHANNEL_URL = "https://juos.vercel.app/api/command-channel"
}

function Get-WorkspaceForProfile {
  param([string]$Profile)

  switch ($Profile) {
    "joa" { return "C:\projects\TimOS-Agent" }
    "nova-reading" { return "C:\projects\TimOS-Agent" }
    "finance" { return "C:\projects\TimFinance" }
    "ob" { return "C:\projects\TimFinance" }
    "gsync" { return "C:\projects\TimFinance" }
    "timos-core" { return "C:\projects\TimOS-Core" }
    default { return "C:\projects\TimOS-Agent" }
  }
}

Write-Host "JUOS_WORKER_HUB_START"
Write-Host "Profiles: $($Profiles -join ', ')"
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
      "--allow-lane"
    )

    if (-not $NoCursorAgent) {
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

