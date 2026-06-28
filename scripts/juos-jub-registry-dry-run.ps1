param(
  [string]$RegistryPath = "config\juos-room-registry.json",
  [string]$SchemaPath = "docs\openapi\juos-actions.generated.openapi.yaml",
  [string]$CandidateProfile = "jub",
  [string]$CandidateRepoRef = "JUB",
  [string]$CandidateWorkspaceRef = "C:\projects\JUB",
  [string]$CandidateStatus = "shadow",
  [switch]$LiveClaimEnabled,
  [switch]$SchemaExposed
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RegistryFullPath = Join-Path $Root $RegistryPath
$SchemaFullPath = Join-Path $Root $SchemaPath
$Failures = [System.Collections.Generic.List[string]]::new()

function Write-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Detail = ""
  )

  $Status = if ($Passed) { "PASS" } else { "FAIL" }
  if ($Detail) {
    Write-Host "$Status $Name - $Detail"
  } else {
    Write-Host "$Status $Name"
  }

  if (-not $Passed) {
    $script:Failures.Add($Name)
  }
}

function Normalize-PathText {
  param([string]$PathText)

  if (-not $PathText) {
    return ""
  }

  if (Test-Path -LiteralPath $PathText) {
    return (Resolve-Path -LiteralPath $PathText).Path.TrimEnd("\")
  }

  return ([System.IO.Path]::GetFullPath($PathText)).TrimEnd("\")
}

function Test-SameText {
  param(
    [string]$Actual,
    [string]$Expected
  )

  return [string]::Equals($Actual, $Expected, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-SamePath {
  param(
    [string]$Actual,
    [string]$Expected
  )

  return (Test-SameText (Normalize-PathText $Actual) (Normalize-PathText $Expected))
}

function Get-TargetWorkerProfileEnumText {
  param([string[]]$Lines)

  $EnumLines = [System.Collections.Generic.List[string]]::new()
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    if ($Lines[$i] -match "^\s*target_worker_profile:\s*$") {
      for ($j = $i; $j -lt [Math]::Min($Lines.Count, $i + 40); $j++) {
        $EnumLines.Add($Lines[$j])
      }
    }
  }
  return ($EnumLines -join "`n")
}

Write-Host "JuOS JUB registry dry-run"
Write-Host "Mode: report-only validation; no registry, schema, worker, or backend files are modified."
Write-Host ""

Write-Check "registry exists" (Test-Path -LiteralPath $RegistryFullPath) $RegistryPath
if (-not (Test-Path -LiteralPath $RegistryFullPath)) {
  exit 1
}

Write-Check "generated schema exists" (Test-Path -LiteralPath $SchemaFullPath) $SchemaPath
if (-not (Test-Path -LiteralPath $SchemaFullPath)) {
  exit 1
}

$Registry = Get-Content -Raw -Path $RegistryFullPath | ConvertFrom-Json
$ProfileNames = @($Registry.profiles.PSObject.Properties.Name | Sort-Object)

$Baseline = @(
  @{ Profile = "joa"; RepoRef = "TimOS-Agent"; WorkspaceRef = "C:\projects\TimOS-Agent"; Detail = "JOA stays in TimOS-Agent" },
  @{ Profile = "finance"; RepoRef = "TimFinance"; WorkspaceRef = "C:\projects\TimFinance"; Detail = "Finance stays in TimFinance" },
  @{ Profile = "ob"; RepoRef = "TimFinance"; WorkspaceRef = "C:\projects\TimFinance"; Detail = "OB remains TimFinance alias" }
)

foreach ($Expected in $Baseline) {
  $Profile = $Expected.Profile
  $Entry = $Registry.profiles.$Profile
  Write-Check "baseline profile $Profile exists" ($null -ne $Entry) $Expected.Detail
  if ($null -ne $Entry) {
    Write-Check "baseline repo $Profile" (Test-SameText $Entry.repo_ref $Expected.RepoRef) "$($Entry.repo_ref) -> $($Expected.RepoRef)"
    Write-Check "baseline workspace $Profile" (Test-SamePath $Entry.workspace_ref $Expected.WorkspaceRef) "$($Entry.workspace_ref) -> $($Expected.WorkspaceRef)"
  }
}

$LiveJubInRegistry = $ProfileNames -contains $CandidateProfile
Write-Check "no live registry profile $CandidateProfile" (-not $LiveJubInRegistry) "config/juos-room-registry.json profiles"

$SchemaText = Get-Content -Raw -Path $SchemaFullPath
$SchemaLines = Get-Content -Path $SchemaFullPath
$TargetWorkerProfileEnums = Get-TargetWorkerProfileEnumText $SchemaLines
$JubInTargetWorkerProfileEnum = $TargetWorkerProfileEnums -match "(?m)[-]\s+'?$([Regex]::Escape($CandidateProfile))'?\s*$"
Write-Check "no action schema target_worker_profile $CandidateProfile" (-not $JubInTargetWorkerProfileEnum) $SchemaPath

$JubLiteralInSchema = $SchemaText -match "(?i)\bjub\b"
Write-Check "no action schema literal $CandidateProfile" (-not $JubLiteralInSchema) "shadow JUB must stay out of generated GPT Action schema"

$CandidateShapeOk =
  (Test-SameText $CandidateProfile "jub") -and
  (Test-SameText $CandidateRepoRef "JUB") -and
  (Test-SamePath $CandidateWorkspaceRef "C:\projects\JUB") -and
  (Test-SameText $CandidateStatus "shadow")
Write-Check "shadow candidate shape" $CandidateShapeOk "profile=$CandidateProfile repo_ref=$CandidateRepoRef workspace_ref=$CandidateWorkspaceRef status=$CandidateStatus"

Write-Check "candidate live_claim_enabled false" (-not $LiveClaimEnabled.IsPresent) "dry-run cannot create a claimable worker route"
Write-Check "candidate schema_exposed false" (-not $SchemaExposed.IsPresent) "dry-run cannot expose jub in GPT Action schema"

$JubWorkspaceExists = Test-Path -LiteralPath $CandidateWorkspaceRef
if ($JubWorkspaceExists) {
  Write-Check "JUB workspace remains shadow" (-not $LiveClaimEnabled.IsPresent) "$CandidateWorkspaceRef exists; explicit live activation is still out of scope"
} else {
  Write-Check "JUB workspace absent fails closed" (-not $LiveClaimEnabled.IsPresent) "$CandidateWorkspaceRef absent; no executable JUB route is allowed"
}

Write-Host ""
if ($Failures.Count -gt 0) {
  Write-Host "JUB registry dry-run failed: $($Failures.Count) issue(s)."
  exit 1
}

Write-Host "JUB registry dry-run passed. Candidate remains shadow-only and live routing is unchanged."
