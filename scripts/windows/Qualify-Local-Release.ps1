param(
  [Parameter(Mandatory = $true)][string]$SourceRoot,
  [Parameter(Mandatory = $true)][string]$WorkDir,
  [Parameter(Mandatory = $true)][string]$ConsoleLog
)

$ErrorActionPreference = "Stop"
$LocalUrl = "http://127.0.0.1:3000"
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

function Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $ConsoleLog -Value $line
}

try {
  Set-Location -LiteralPath $SourceRoot
  Log "RC17 Final Release Qualification iniciada."
  Log "Executando Environment Doctor antes da bateria..."
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $SourceRoot "scripts\windows\Repair-Local-Environment.ps1") -SourceRoot $SourceRoot -WorkDir $WorkDir -ConsoleLog $ConsoleLog
  $doctorExit = $LASTEXITCODE
  if ($doctorExit -ne 0) {
    throw "ENVIRONMENT_DOCTOR_BLOCKED. Consulte ENVIRONMENT_DOCTOR.json antes de executar a bateria."
  }
  Log "Environment Doctor: READY."
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $SourceRoot "scripts\windows\Run-Local-Battery.ps1") -SourceRoot $SourceRoot -WorkDir $WorkDir -ConsoleLog $ConsoleLog
  $batteryExit = $LASTEXITCODE
  $runMetadata = Join-Path $WorkDir "TEST_RUN.json"
  if (-not (Test-Path -LiteralPath $runMetadata)) { throw "TEST_RUN_METADATA_MISSING" }
  $run = Get-Content -LiteralPath $runMetadata -Raw | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$run.runId)) { throw "TEST_RUN_ID_MISSING" }

  $headers = @{ Origin = $LocalUrl; Referer = "$LocalUrl/testing" }
  $body = @{ runId = [string]$run.runId } | ConvertTo-Json -Compress
  $response = $null
  try {
    $response = Invoke-RestMethod -Method Post -Uri "$LocalUrl/api/testing/qualification" -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 60
  } catch {
    if ($_.ErrorDetails.Message) {
      try { $response = $_.ErrorDetails.Message | ConvertFrom-Json } catch {}
    }
    if ($null -eq $response) { throw }
  }
  if ($null -eq $response.report) { throw "RELEASE_QUALIFICATION_REPORT_MISSING" }

  $qualificationPath = Join-Path $WorkDir "RELEASE_QUALIFICATION.json"
  $response.report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $qualificationPath -Encoding UTF8
  $textPath = Join-Path $WorkDir "RELEASE_QUALIFICATION.txt"
  @(
    "AUTOMATION PLATFORM - FINAL RELEASE QUALIFICATION"
    "Run: $($response.report.runId)"
    "Release: $($response.report.release)"
    "Verdict: $($response.report.verdict)"
    "Core ready: $($response.report.coreReady)"
    "Digest: $($response.report.qualificationDigest)"
    "Root blockers: $(@($response.report.blockers).Count)"
    "Failed checks: $(@($response.report.failedChecks).Count)"
    "Battery exit: $batteryExit"
    "Environment doctor: READY"
    "Environment report: $(Join-Path $WorkDir 'ENVIRONMENT_DOCTOR.json')"
    "Dashboard: $LocalUrl/testing"
  ) | Set-Content -LiteralPath $textPath -Encoding UTF8

  Log "Verdict: $($response.report.verdict)"
  Log "Relatorio: $qualificationPath"
  if ($response.report.verdict -ne "CORE_RELEASE_READY") { exit 1 }
  exit 0
} catch {
  Log "FALHA: $($_.Exception.Message)"
  exit 1
}
