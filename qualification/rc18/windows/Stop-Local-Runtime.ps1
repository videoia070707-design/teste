param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,

  [Parameter(Mandatory = $false)]
  [int]$DrainTimeoutSeconds = 120,

  [Parameter(Mandatory = $false)]
  [switch]$KeepDatabaseRunning
)

$ErrorActionPreference = "SilentlyContinue"
$StateDir = Join-Path $SourceRoot ".local-runtime"
$WebPidFile = Join-Path $StateDir "web.pid"
$AutomationPidFile = Join-Path $StateDir "automation-worker.pid"
$AutomationWorkerIdFile = Join-Path $StateDir "automation-worker.id"
$DbContainer = "automation-platform-local-db"
$DbName = "automation_local"
$DbUser = "postgres"

function Test-ProcessRunning([int]$ProcessId) {
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Invoke-DbScalar([string]$Query) {
  $value = (& docker.exe exec $DbContainer psql -U $DbUser -d $DbName -Atqc $Query 2>$null | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0) { return $null }
  return ([string]$value).Trim()
}

function Stop-ProcessTree([int]$ProcessId, [string]$Label, [switch]$Force) {
  if (-not (Test-ProcessRunning -ProcessId $ProcessId)) { return }
  $args = @("/PID", "$ProcessId", "/T")
  if ($Force) { $args += "/F" }
  & taskkill.exe @args *> $null
  if ($LASTEXITCODE -ne 0 -and $Force) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
  Write-Host "$Label encerrado (PID $ProcessId)."
}

Write-Host "Encerrando Automation Platform local sem apagar dados..."

$automationPid = $null
$workerId = $null
if (Test-Path -LiteralPath $AutomationPidFile) {
  $value = Get-Content -LiteralPath $AutomationPidFile | Select-Object -First 1
  if ($value -match '^\d+$') { $automationPid = [int]$value }
}
if (Test-Path -LiteralPath $AutomationWorkerIdFile) {
  $workerId = ((Get-Content -LiteralPath $AutomationWorkerIdFile | Select-Object -First 1) + "").Trim()
}

$existing = (& docker.exe ps -a --filter "name=^/$DbContainer$" --format "{{.Names}}" 2>$null) -join ""
$dbRunning = $false
if ($existing -eq $DbContainer) {
  $dbRunning = ((& docker.exe inspect -f "{{.State.Running}}" $DbContainer 2>$null) -join "") -eq "true"
}

$drainCompleted = $false
if ($null -ne $automationPid -and (Test-ProcessRunning -ProcessId $automationPid) -and $dbRunning -and -not [string]::IsNullOrWhiteSpace($workerId)) {
  $safeWorkerId = $workerId.Replace("'", "''")
  $request = @"
update app_private.worker_heartbeats
set drain_requested_at=coalesce(drain_requested_at,now()),
    drain_requested_by='windows-local-stop',
    runtime_state=case when runtime_state='stopped' then runtime_state else 'draining' end
where worker_kind='worker-automation' and worker_id='$safeWorkerId' and stopped_at is null;
"@
  & docker.exe exec $DbContainer psql -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -c $request *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Drain solicitado ao automation worker $workerId. Aguardando trabalho em andamento concluir..."
    $deadline = (Get-Date).AddSeconds($DrainTimeoutSeconds)
    do {
      if (-not (Test-ProcessRunning -ProcessId $automationPid)) {
        $drainCompleted = $true
        break
      }
      $state = Invoke-DbScalar "select coalesce(runtime_state,'')||'|'||coalesce(current_work_type,'')||'|'||coalesce(current_work_id,'')||'|'||case when stopped_at is null then 'running' else 'stopped' end from app_private.worker_heartbeats where worker_kind='worker-automation' and worker_id='$safeWorkerId' limit 1;"
      if ($state -match '^stopped\|.*\|stopped$') {
        $drainCompleted = $true
        break
      }
      if (-not [string]::IsNullOrWhiteSpace($state)) { Write-Host "  Worker: $state" }
      Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
  }
}

if ($null -ne $automationPid -and (Test-ProcessRunning -ProcessId $automationPid)) {
  if (-not $drainCompleted -and $dbRunning -and -not [string]::IsNullOrWhiteSpace($workerId)) {
    $safeWorkerId = $workerId.Replace("'", "''")
    $reason = "drain-timeout-${DrainTimeoutSeconds}s"
    $forced = "update app_private.worker_heartbeats set shutdown_forced_at=now(),shutdown_forced_reason='$reason',runtime_state='stopped',stopped_at=now(),current_work_type=null,current_work_id=null where worker_kind='worker-automation' and worker_id='$safeWorkerId';"
    & docker.exe exec $DbContainer psql -U $DbUser -d $DbName -c $forced *> $null
    Write-Host "AVISO: drain excedeu ${DrainTimeoutSeconds}s. Encerramento forcado registrado como evidencia."
  }
  Stop-ProcessTree -ProcessId $automationPid -Label "Automation worker" -Force
} elseif ($null -ne $automationPid) {
  Write-Host "Automation worker ja estava encerrado (PID $automationPid)."
}

if (Test-Path -LiteralPath $WebPidFile) {
  $pidValue = Get-Content -LiteralPath $WebPidFile | Select-Object -First 1
  if ($pidValue -match '^\d+$') {
    Stop-ProcessTree -ProcessId ([int]$pidValue) -Label "Servidor web" -Force
  }
}

if ($existing -eq $DbContainer) {
  if ($KeepDatabaseRunning) {
    Write-Host "PostgreSQL local mantido ativo para cutover/rollback seguro."
  } else {
    & docker.exe stop $DbContainer *> $null
    Write-Host "PostgreSQL local parado. Container e dados foram preservados."
  }
}

Remove-Item -LiteralPath $WebPidFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $AutomationPidFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $AutomationWorkerIdFile -Force -ErrorAction SilentlyContinue

if ($drainCompleted) {
  Write-Host "Automation worker drenado com sucesso antes do shutdown."
}
Write-Host "Ambiente local encerrado. Seus dados permanecem salvos para a proxima abertura."
exit 0
