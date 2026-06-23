param(
  [string]$RegistryPath = "config\juos-room-registry.json",
  [string]$SchemaPath = "docs\openapi\juos-actions.generated.openapi.yaml"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RegistryFullPath = Join-Path $Root $RegistryPath
$SchemaFullPath = Join-Path $Root $SchemaPath
$Failures = [System.Collections.Generic.List[string]]::new()
$Warnings = [System.Collections.Generic.List[string]]::new()

function Add-Check {
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

if (-not (Test-Path $RegistryFullPath)) {
  Add-Check "registry exists" $false $RegistryPath
  exit 1
}

$Registry = Get-Content -Raw -Path $RegistryFullPath | ConvertFrom-Json
$Profiles = @($Registry.profiles.PSObject.Properties.Name | Sort-Object)

Add-Check "generated schema exists" (Test-Path $SchemaFullPath) $SchemaPath
if (-not (Test-Path $SchemaFullPath)) {
  exit 1
}

$Schema = Get-Content -Raw -Path $SchemaFullPath
$Lines = Get-Content -Path $SchemaFullPath

$RequiredOperationIds = @(
  "checkTimOsAssistantHealth",
  "assistantEcho",
  "createTimOsTasks",
  "searchTimOsTasks",
  "updateTimOsTask",
  "listCommandChannelJobs",
  "createApprovedFinalizeCommandChannelJob",
  "createSupervisedImplementCommandChannelJob",
  "getCommandChannelJob",
  "approveCommandChannelJob"
)

foreach ($OperationId in $RequiredOperationIds) {
  Add-Check "operationId $OperationId" ($Schema -match "operationId:\s*$([Regex]::Escape($OperationId))\b")
}

$AllEnumText = ""
for ($i = 0; $i -lt $Lines.Count; $i++) {
  if ($Lines[$i] -match "^\s*target_worker_profile:\s*$") {
    $Block = [System.Collections.Generic.List[string]]::new()
    for ($j = $i; $j -lt [Math]::Min($Lines.Count, $i + 30); $j++) {
      $Block.Add($Lines[$j])
    }
    $AllEnumText += ($Block -join "`n") + "`n"
  }
}

foreach ($Profile in $Profiles) {
  Add-Check "profile enum $Profile" ($AllEnumText -match "(?m)[-]\s+'?$([Regex]::Escape($Profile))'?\s*$") "target_worker_profile"
}

$LongDescriptions = @()
foreach ($Line in $Lines) {
  if ($Line -match "^\s*description:\s*(.+)$") {
    $Description = $Matches[1].Trim()
    if ($Description.Length -gt 300) {
      $LongDescriptions += $Description
    }
  }
}
Add-Check "descriptions <= 300 chars" ($LongDescriptions.Count -eq 0) "$($LongDescriptions.Count) long description(s)"

$PlaceholderPatterns = @("YOUR-", "replace before use", "YOUR_TUNNEL", "YOUR-COORDINATOR", "localhost")
$PlaceholderHits = @()
foreach ($Pattern in $PlaceholderPatterns) {
  if ($Schema -match [Regex]::Escape($Pattern)) {
    $PlaceholderHits += $Pattern
  }
}
Add-Check "no placeholder URLs" ($PlaceholderHits.Count -eq 0) ($PlaceholderHits -join ", ")

$SecurityOk =
  ($Schema -match "securitySchemes:\s*") -and
  ($Schema -match "bearerAuth:\s*") -and
  ($Schema -match "scheme:\s*bearer")
Add-Check "security scheme exists" $SecurityOk "bearerAuth"

if ($Failures.Count -gt 0) {
  Write-Host ""
  Write-Host "Action doctor failed: $($Failures.Count) issue(s)."
  exit 1
}

Write-Host ""
Write-Host "Action doctor passed."
