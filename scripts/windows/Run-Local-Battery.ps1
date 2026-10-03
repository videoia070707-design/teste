param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,

  [Parameter(Mandatory = $true)]
  [string]$WorkDir,

  [Parameter(Mandatory = $true)]
  [string]$ConsoleLog
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$LocalUrl = "http://127.0.0.1:3000"
$ResultTxt = Join-Path $WorkDir "RESULTADO.txt"
$RunMetadata = Join-Path $WorkDir "TEST_RUN.json"

New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

function Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $ConsoleLog -Value $line
}

function Is-Healthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$LocalUrl/api/health/live" -TimeoutSec 4
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-Runs {
  $response = Invoke-RestMethod -Method Get -Uri "$LocalUrl/api/testing/runs?limit=10" -TimeoutSec 15
  if ($null -eq $response.runs) { return @() }
  return @($response.runs)
}

function Save-Run([object]$Run) {
  $Run | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $RunMetadata -Encoding UTF8
}

try {
  Set-Location -LiteralPath $SourceRoot
  Log "Bateria local via Test Center iniciada."

  if (-not (Is-Healthy)) {
    Log "Dashboard ainda nao esta ativo; iniciando runtime persistente primeiro."
    $runtimeDir = Join-Path $WorkDir "runtime"
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $runtimeLog = Join-Path $runtimeDir "CONSOLE_OUTPUT.log"
    & (Join-Path $SourceRoot "scripts\windows\Start-Local-Runtime.ps1") -SourceRoot $SourceRoot -WorkDir $runtimeDir -ConsoleLog $runtimeLog -NoBrowser
    if ($LASTEXITCODE -ne 0) { throw "RUNTIME_START_FAILED:$LASTEXITCODE" }
  } else {
    Log "Dashboard ja estava ativo; runtime existente sera preservado."
  }

  $runs = Get-Runs
  $active = $runs | Where-Object { $_.state -eq "QUEUED" -or $_.state -eq "RUNNING" } | Select-Object -First 1
  $runId = $null

  if ($null -ne $active) {
    $runId = [string]$active.runId
    Log "Reconectando ao run ativo: $runId"
  } else {
    Log "Solicitando nova bateria ao Test Center..."
    $headers = @{
      Origin = $LocalUrl
      Referer = "$LocalUrl/testing"
    }
    $created = Invoke-RestMethod -Method Post -Uri "$LocalUrl/api/testing/runs" -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 20
    $runId = [string]$created.runId
    if ([string]::IsNullOrWhiteSpace($runId)) { throw "TEST_RUN_ID_MISSING" }
    Log "Run criado: $runId"
  }

  $deadline = (Get-Date).AddHours(1)
  $lastPhase = ""
  $final = $null

  while ((Get-Date) -lt $deadline) {
    $current = Invoke-RestMethod -Method Get -Uri "$LocalUrl/api/testing/runs/$runId" -TimeoutSec 15
    Save-Run $current
    if ([string]$current.phase -ne $lastPhase) {
      $lastPhase = [string]$current.phase
      Log ("{0}% | {1} | {2}" -f $current.progress, $current.state, $current.phase)
    }

    if ($current.state -eq "PASS" -or $current.state -eq "FAIL" -or $current.state -eq "PARTIAL") {
      $final = $current
      break
    }
    Start-Sleep -Milliseconds 1200
  }

  if ($null -eq $final) { throw "TEST_RUN_TIMEOUT" }

  $zipPath = ""
  if ($final.artifactReady -eq $true) {
    $zipPath = Join-Path $WorkDir ("Automation-Test-Results-{0}.zip" -f $runId)
    Invoke-WebRequest -UseBasicParsing -Uri "$LocalUrl/api/testing/runs/$runId/download" -OutFile $zipPath -TimeoutSec 120
    Log "ZIP de evidencias salvo: $zipPath"
  }

  $summary = $final.summary
  @(
    "AUTOMATION PLATFORM - TEST CENTER"
    "Run: $runId"
    "Status: $($final.state)"
    "Fase final: $($final.phase)"
    "Progresso: $($final.progress)%"
    "PASS: $($summary.passed)"
    "FAIL: $($summary.failed)"
    "SKIP: $($summary.skipped)"
    "Mandatory failed: $($summary.mandatoryFailed)"
    "ZIP: $zipPath"
    "Dashboard: $LocalUrl/testing"
  ) | Set-Content -LiteralPath $ResultTxt -Encoding UTF8

  Start-Process "$LocalUrl/testing" | Out-Null
  if ($final.state -eq "FAIL") { exit 1 }
  exit 0
} catch {
  $message = $_.Exception.Message
  Log "FALHA: $message"
  @(
    "AUTOMATION PLATFORM - TEST CENTER"
    "Status: FAILED_TO_RUN"
    "Mensagem: $message"
    "Dashboard: $LocalUrl/testing"
  ) | Set-Content -LiteralPath $ResultTxt -Encoding UTF8
  exit 1
}
