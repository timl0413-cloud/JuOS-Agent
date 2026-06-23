param(
  [ValidateSet("codex", "cursor")]
  [string]$Provider = "codex",
  [switch]$NoCursorAgent
)

$ErrorActionPreference = "Stop"

<#
.SYNOPSIS
  Start the JOA command-channel worker in persistent polling mode (Station 1).

.DESCRIPTION
  Wrapper around start-juos-worker.ps1 that keeps a single JOA worker alive:
  approved + pending + unclaimed jobs are claimed automatically without -JobId.

  Requires WORKER_TOKEN (or config/auth.json worker profile) and COMMAND_CHANNEL_URL
  (defaults to production JuOS API). Run from a token-loaded supervisor shell.

  Press Ctrl+C in this window to stop the loop.
#>

$launcherArgs = @{
  Profile = "joa"
  Loop    = $true
  Provider = $Provider
}

if ($NoCursorAgent) {
  $launcherArgs.NoCursorAgent = $true
}

Write-Host "JOA worker loop - persistent polling (no JobId required)"
Write-Host "Expected banner: Persistent polling hub active worker_profile=joa"
Write-Host ""

$workerLauncher = Join-Path $PSScriptRoot "start-juos-worker.ps1"
& $workerLauncher @launcherArgs
