param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,

  [Parameter(Mandatory = $true)]
  [string]$WorkDir,

  [Parameter(Mandatory = $true)]
  [string]$ConsoleLog,

  [Parameter(Mandatory = $false)]
  [switch]$NoBrowser,

  [Parameter(Mandatory = $false)]
  [switch]$ForceInstall,

  [Parameter(Mandatory = $false)]
  [switch]$AllowSuperseded
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$DbContainer = "automation-platform-local-db"
$DbVolume = "automation-platform-local-db-data"
$DbPort = 55432
$DbName = "automation_local"
$DbUser = "postgres"
$DbPassword = "postgres"
$LocalUserId = "00000000-0000-4000-8000-000000000001"
$LocalUrl = "http://127.0.0.1:3000"
$DatabaseUrl = "postgresql://$DbUser`:$DbPassword@127.0.0.1:$DbPort/$DbName"
$StateDir = Join-Path $SourceRoot ".local-runtime"
$WebPidFile = Join-Path $StateDir "web.pid"
$AutomationPidFile = Join-Path $StateDir "automation-worker.pid"
$AutomationWorkerIdFile = Join-Path $StateDir "automation-worker.id"
$DependencyHashFile = Join-Path $StateDir "dependencies.sha256"
$LocalBinDir = Join-Path $StateDir "bin"
$PnpmShim = Join-Path $LocalBinDir "pnpm.cmd"
$AutomationWorkerId = "local-windows-{0}" -f ([Guid]::NewGuid().ToString("N").Substring(0, 12))
$StartedWebProcessId = $null
$StartedAutomationProcessId = $null
$WebLog = Join-Path $WorkDir "WEB_SERVER.log"
$AutomationLog = Join-Path $WorkDir "AUTOMATION_WORKER.log"
$ResultJson = Join-Path $WorkDir "LOCAL_RUNTIME_RESULT.json"
$ResultTxt = Join-Path $WorkDir "RESULTADO.txt"

New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

function Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $ConsoleLog -Value $line
}

function Write-Result {
  param(
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $false)][string]$Message = ""
  )

  $payload = [ordered]@{
    schemaVersion = 2
    status = $Status
    exitCode = $ExitCode
    message = $Message
    mode = "PERSISTENT_LOCAL_RUNTIME"
    sourceRoot = $SourceRoot
    reportDirectory = $WorkDir
    localUrl = $LocalUrl
    databaseContainer = $DbContainer
    databaseVolume = $DbVolume
    databasePort = $DbPort
    dataPreservedOnStop = $true
    webLog = $WebLog
    automationWorkerLog = $AutomationLog
    automationWorkerId = $AutomationWorkerId
    startupRollbackOnFailure = $true
    finishedAt = (Get-Date).ToString("o")
  }
  $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ResultJson -Encoding UTF8

  @(
    "AUTOMATION PLATFORM - RUNTIME LOCAL PERSISTENTE"
    "Status: $Status"
    "Codigo de saida: $ExitCode"
    "Mensagem: $Message"
    "Dashboard local: $LocalUrl"
    "Relatorios: $WorkDir"
    "Banco local: $DbContainer (porta $DbPort)"
    "Persistencia: PRESERVADA ao parar/iniciar"
    "Automation worker: $AutomationWorkerId"
    "Rollback de boot: processos iniciados nesta tentativa sao encerrados se o boot falhar"
    "Para encerrar sem apagar dados: PARAR-FERRAMENTA-WINDOWS.cmd"
    "Para apagar dados: RESETAR-DADOS-LOCAIS-WINDOWS.cmd"
  ) | Set-Content -LiteralPath $ResultTxt -Encoding UTF8
}

function Fail([string]$Message, [int]$Code = 1) {
  Log "FALHA: $Message"
  Write-Result -Status "FAILED" -ExitCode $Code -Message $Message
  throw [System.Exception]::new($Message)
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $false)][string[]]$Arguments = @(),
    [Parameter(Mandatory = $false)][string]$Label = $FilePath
  )

  Log "Executando: $Label"
  & $FilePath @Arguments 2>&1 | Tee-Object -FilePath $ConsoleLog -Append
  if ($LASTEXITCODE -ne 0) {
    throw "$Label falhou com codigo $LASTEXITCODE"
  }
}

function Command-Exists([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-DockerDaemon {
  & docker.exe info *> $null
  if ($LASTEXITCODE -eq 0) { return $true }

  $candidates = @(
    (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe")
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_) }

  $desktop = $candidates | Select-Object -First 1
  if ($null -eq $desktop) { return $false }

  Log "Docker Desktop instalado, mas daemon inativo; tentando iniciar automaticamente."
  try { Start-Process -FilePath $desktop | Out-Null } catch { return $false }
  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep -Seconds 3
    & docker.exe info *> $null
    if ($LASTEXITCODE -eq 0) {
      Log "Docker Desktop ficou pronto apos bootstrap automatico."
      return $true
    }
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Wait-Http200([string]$Url, [int]$TimeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if ($response.StatusCode -eq 200) { return $true }
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Wait-LocalRuntimeBootReady {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $false)][int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if ($response.StatusCode -eq 200) {
        $payload = $response.Content | ConvertFrom-Json
        if ($payload.bootReady -eq $true -and $payload.automationWorker.healthy -eq $true) { return $payload }
      }
    } catch { }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Test-ProcessRunning([int]$ProcessId) {
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-ProcessTree([Nullable[int]]$ProcessId, [string]$Label) {
  if ($null -eq $ProcessId) { return }
  if (-not (Test-ProcessRunning -ProcessId $ProcessId.Value)) { return }
  & taskkill.exe /PID $ProcessId.Value /T /F *> $null
  if ($LASTEXITCODE -ne 0) {
    Stop-Process -Id $ProcessId.Value -Force -ErrorAction SilentlyContinue
  }
  Log "$Label encerrado com arvore de processos (PID $($ProcessId.Value))."
}

function Rollback-StartedProcesses {
  Log "Rollback seguro do boot: encerrando somente processos iniciados nesta tentativa."
  Stop-ProcessTree -ProcessId $StartedWebProcessId -Label "Web desta tentativa"
  Stop-ProcessTree -ProcessId $StartedAutomationProcessId -Label "Automation worker desta tentativa"
  Remove-Item -LiteralPath $WebPidFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $AutomationPidFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $AutomationWorkerIdFile -Force -ErrorAction SilentlyContinue
}

function Wait-AppHealth {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$ExpectedStatus,
    [Parameter(Mandatory = $false)][string]$ExpectedService = "",
    [Parameter(Mandatory = $false)][int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if ($response.StatusCode -eq 200) {
        $payload = $response.Content | ConvertFrom-Json
        $statusOk = [string]$payload.status -eq $ExpectedStatus
        $serviceOk = [string]::IsNullOrWhiteSpace($ExpectedService) -or [string]$payload.service -eq $ExpectedService
        if ($statusOk -and $serviceOk) { return $true }
      }
    } catch { }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Wait-AutomationWorkerReady {
  param(
    [Parameter(Mandatory = $true)][string]$WorkerId,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $false)][int]$TimeoutSeconds = 45
  )

  $safeWorkerId = $WorkerId.Replace("'", "''")
  $query = "select case when runtime_state='active' and stopped_at is null and last_seen_at >= now() - interval '20 seconds' then 'ready' else 'not_ready' end from app_private.worker_heartbeats where worker_kind='worker-automation' and worker_id='$safeWorkerId' order by last_seen_at desc limit 1;"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (-not (Test-ProcessRunning -ProcessId $ProcessId)) { return $false }
    try {
      $result = (& docker.exe exec $DbContainer psql -U $DbUser -d $DbName -Atqc $query 2>$null | Select-Object -Last 1)
      if (([string]$result).Trim() -eq "ready") { return $true }
    } catch { }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Stop-PidFromFile([string]$PidFile, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PidFile)) { return }
  $oldPid = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($oldPid -match '^\d+$') {
    & taskkill.exe /PID $oldPid /T /F *> $null
    if ($LASTEXITCODE -ne 0) { Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue }
    Log "$Label anterior encerrado com arvore de processos (PID $oldPid)."
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Drain-PreviousAutomationWorker {
  param([Parameter(Mandatory = $false)][int]$TimeoutSeconds = 120)
  if (-not (Test-Path -LiteralPath $AutomationPidFile)) { return }
  $oldPidValue = (Get-Content -LiteralPath $AutomationPidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($oldPidValue -notmatch '^\d+$') {
    Remove-Item -LiteralPath $AutomationPidFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $AutomationWorkerIdFile -Force -ErrorAction SilentlyContinue
    return
  }
  $oldPid = [int]$oldPidValue
  if (-not (Test-ProcessRunning -ProcessId $oldPid)) {
    Remove-Item -LiteralPath $AutomationPidFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $AutomationWorkerIdFile -Force -ErrorAction SilentlyContinue
    return
  }

  $oldWorkerId = ""
  if (Test-Path -LiteralPath $AutomationWorkerIdFile) {
    $oldWorkerId = ((Get-Content -LiteralPath $AutomationWorkerIdFile -ErrorAction SilentlyContinue | Select-Object -First 1) + "").Trim()
  }
  if (-not [string]::IsNullOrWhiteSpace($oldWorkerId)) {
    $safeWorkerId = $oldWorkerId.Replace("'", "''")
    $request = "update app_private.worker_heartbeats set drain_requested_at=coalesce(drain_requested_at,now()),drain_requested_by='windows-local-restart',runtime_state=case when runtime_state='stopped' then runtime_state else 'draining' end where worker_kind='worker-automation' and worker_id='$safeWorkerId' and stopped_at is null;"
    & docker.exe exec $DbContainer psql -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -c $request *> $null
    if ($LASTEXITCODE -eq 0) {
      Log "Restart seguro: drain solicitado ao worker anterior $oldWorkerId."
      $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
      do {
        if (-not (Test-ProcessRunning -ProcessId $oldPid)) { break }
        $stateQuery = "select case when stopped_at is not null or runtime_state='stopped' then 'stopped' else coalesce(runtime_state,'unknown') end from app_private.worker_heartbeats where worker_kind='worker-automation' and worker_id='$safeWorkerId' limit 1;"
        $state = (& docker.exe exec $DbContainer psql -U $DbUser -d $DbName -Atqc $stateQuery 2>$null | Select-Object -Last 1)
        if (([string]$state).Trim() -eq 'stopped') { break }
        Start-Sleep -Seconds 2
      } while ((Get-Date) -lt $deadline)
    }
  }

  if (Test-ProcessRunning -ProcessId $oldPid) {
    if (-not [string]::IsNullOrWhiteSpace($oldWorkerId)) {
      $safeWorkerId = $oldWorkerId.Replace("'", "''")
      $forced = "update app_private.worker_heartbeats set shutdown_forced_at=now(),shutdown_forced_reason='restart-drain-timeout',runtime_state='stopped',stopped_at=now(),current_work_type=null,current_work_id=null where worker_kind='worker-automation' and worker_id='$safeWorkerId';"
      & docker.exe exec $DbContainer psql -U $DbUser -d $DbName -c $forced *> $null
    }
    Stop-ProcessTree -ProcessId $oldPid -Label "Automation worker anterior (fallback apos drain)"
  } else {
    Log "Automation worker anterior encerrou apos graceful drain."
  }
  Remove-Item -LiteralPath $AutomationPidFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $AutomationWorkerIdFile -Force -ErrorAction SilentlyContinue
}

function Ensure-Pnpm {
  $pnpmOk = $false
  if (Command-Exists "pnpm.cmd") {
    try {
      $pnpmVersion = (& pnpm.cmd --version 2>$null).Trim()
      if ($pnpmVersion -eq "9.15.4") {
        $pnpmOk = $true
        Log "pnpm 9.15.4 ja esta ativo."
      }
    } catch { }
  }

  if ($pnpmOk) { return }
  if (-not (Command-Exists "corepack.cmd")) { throw "COREPACK_NOT_AVAILABLE" }
  Invoke-External -FilePath "corepack.cmd" -Arguments @("prepare", "pnpm@9.15.4", "--activate") -Label "preparar pnpm 9.15.4 via Corepack"
  New-Item -ItemType Directory -Path $LocalBinDir -Force | Out-Null
  @"
@echo off
corepack.cmd pnpm %*
"@ | Set-Content -LiteralPath $PnpmShim -Encoding ASCII
  $env:PATH = "$LocalBinDir;$env:PATH"
  $pnpmVersion = (& $PnpmShim --version 2>$null | Select-Object -First 1).Trim()
  if ($pnpmVersion -ne "9.15.4") { throw "PNPM_VERSION_MISMATCH:$pnpmVersion" }
  Log "pnpm 9.15.4 disponivel via shim local sem alterar a instalacao global do Node."
}

function Ensure-Dependencies {
  $lockFile = Join-Path $SourceRoot "pnpm-lock.yaml"
  $nodeModulesMarker = Join-Path $SourceRoot "node_modules\.modules.yaml"
  $lockHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash.ToLowerInvariant()
  $recordedHash = ""
  if (Test-Path -LiteralPath $DependencyHashFile) {
    $recordedHash = ((Get-Content -LiteralPath $DependencyHashFile -ErrorAction SilentlyContinue | Select-Object -First 1) + "").Trim().ToLowerInvariant()
  }

  if ((-not $ForceInstall) -and (Test-Path -LiteralPath $nodeModulesMarker) -and $recordedHash -eq $lockHash) {
    Log "Dependencias ja correspondem ao pnpm-lock.yaml; install completo ignorado."
    return
  }

  Invoke-External -FilePath "pnpm.cmd" -Arguments @("install", "--frozen-lockfile") -Label "pnpm install --frozen-lockfile"
  Set-Content -LiteralPath $DependencyHashFile -Value $lockHash -Encoding ASCII
}

function Ensure-DatabaseContainer {
  $existing = (& docker.exe ps -a --filter "name=^/$DbContainer$" --format "{{.Names}}") -join ""
  if ($existing -eq $DbContainer) {
    $running = (& docker.exe inspect -f "{{.State.Running}}" $DbContainer 2>$null) -join ""
    if ($running -ne "true") {
      Invoke-External -FilePath "docker.exe" -Arguments @("start", $DbContainer) -Label "docker start $DbContainer"
    } else {
      Log "PostgreSQL local persistente ja esta em execucao."
    }
    return
  }

  Invoke-External -FilePath "docker.exe" -Arguments @("volume", "create", $DbVolume) -Label "docker volume create $DbVolume"
  Invoke-External -FilePath "docker.exe" -Arguments @(
    "run", "-d",
    "--name", $DbContainer,
    "--restart", "unless-stopped",
    "-e", "POSTGRES_USER=$DbUser",
    "-e", "POSTGRES_PASSWORD=$DbPassword",
    "-e", "POSTGRES_DB=$DbName",
    "-p", "127.0.0.1:$DbPort`:5432",
    "-v", "$DbVolume`:/var/lib/postgresql/data",
    "postgres:17-alpine"
  ) -Label "docker postgres:17-alpine persistente"
}

try {
  Set-Location -LiteralPath $SourceRoot
  Log "Inicio do runtime local persistente. Nenhum dado local sera apagado por este fluxo."

  $supersededMarker = Join-Path $SourceRoot "SUPERSEDED_BY.json"
  if ((-not $AllowSuperseded) -and (Test-Path -LiteralPath $supersededMarker)) {
    Fail "PACKAGE_SUPERSEDED_BY_NEWER_RELEASE. Use o pacote ativo ou REVERTER-ATUALIZACAO-WINDOWS.cmd." 9
  }

  Log "[1/8] Validando Node, Corepack e Docker..."
  if (-not (Command-Exists "node.exe")) { Fail "Node.js nao encontrado. Instale Node.js 22 LTS e execute novamente." 10 }
  if (-not (Command-Exists "corepack.cmd")) { Fail "Corepack nao encontrado na instalacao do Node.js." 11 }
  if (-not (Command-Exists "docker.exe")) { Fail "Docker Desktop nao encontrado. Instale/abra o Docker Desktop e execute novamente." 12 }

  $nodeVersion = (& node.exe --version).TrimStart("v")
  $nodeMajor = [int]($nodeVersion.Split(".")[0])
  if ($nodeMajor -lt 20) { Fail "Node.js 20+ obrigatorio. Detectado: v$nodeVersion" 13 }
  Log "Node detectado: v$nodeVersion"

  if (-not (Ensure-DockerDaemon)) { Fail "Docker Desktop esta instalado, mas o daemon nao ficou ativo. Abra o Docker Desktop e execute novamente." 14 }

  Log "[2/8] Preparando pnpm e dependencias sem reinstalacao desnecessaria..."
  Ensure-Pnpm
  Ensure-Dependencies

  Log "[3/8] Preparando PostgreSQL persistente..."
  Ensure-DatabaseContainer

  $dbReady = $false
  for ($attempt = 1; $attempt -le 45; $attempt++) {
    & docker.exe exec $DbContainer pg_isready -U $DbUser -d $DbName *> $null
    if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $dbReady) { Fail "PostgreSQL local nao ficou pronto em 45 segundos." 20 }

  Log "[4/8] Garantindo Auth local e usuario de desenvolvimento..."
  $bootstrapSql = Join-Path $WorkDir "bootstrap-local.sql"
  @"
do `$`$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
`$`$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);
insert into auth.users (id, email)
values ('$LocalUserId', 'local-test@example.test')
on conflict (id) do nothing;
"@ | Set-Content -LiteralPath $bootstrapSql -Encoding UTF8

  Invoke-External -FilePath "docker.exe" -Arguments @("cp", $bootstrapSql, "$DbContainer`:/tmp/bootstrap-local.sql") -Label "docker cp bootstrap"
  Invoke-External -FilePath "docker.exe" -Arguments @("exec", $DbContainer, "psql", "-U", $DbUser, "-d", $DbName, "-v", "ON_ERROR_STOP=1", "-f", "/tmp/bootstrap-local.sql") -Label "bootstrap auth local"

  Log "[5/8] Aplicando somente migrations pendentes..."
  $previousDatabaseUrl = $env:DATABASE_URL
  $env:DATABASE_URL = $DatabaseUrl
  try {
    Invoke-External -FilePath "pnpm.cmd" -Arguments @("--filter", "@automation/storage-postgres", "migrate") -Label "migration runner"
  } finally {
    if ($null -eq $previousDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
    else { $env:DATABASE_URL = $previousDatabaseUrl }
  }

  Log "[6/8] Preparando configuracao efemera de processo sem sobrescrever .env.local..."
  $webRuntimeEnv = @(
    "`$env:APP_ORIGIN='$LocalUrl'",
    "`$env:DATABASE_URL='$DatabaseUrl'",
    "`$env:DATABASE_POOL_MAX='4'",
    "`$env:LOCAL_TEST_MODE='true'",
    "`$env:LOCAL_TEST_USER_ID='$LocalUserId'",
    "`$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'",
    "`$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='local-test-only'",
    "`$env:GOOGLE_AUTH_ENABLED='false'",
    "`$env:LEGAL_ENTITY_NAME='Automation Platform Local Runtime'",
    "`$env:SUPPORT_EMAIL='local-test@example.test'",
    "`$env:INSTAGRAM_GRAPH_BASE_URL='https://graph.instagram.com/'",
    "`$env:INSTAGRAM_GRAPH_API_VERSION='v26.0'",
    "`$env:INSTAGRAM_OAUTH_TOKEN_ENCODING='multipart'",
    "`$env:INSTAGRAM_LONG_LIVED_TOKEN_URL='https://graph.instagram.com/access_token'"
  ) -join "; "
  Log "Configuracao local sera aplicada somente aos processos iniciados por este launcher."

  Log "[7/8] Iniciando worker e dashboard..."
  Drain-PreviousAutomationWorker -TimeoutSeconds 120
  Stop-PidFromFile -PidFile $WebPidFile -Label "Web"

  $automationCommand = "Set-Location -LiteralPath '$($SourceRoot.Replace("'", "''"))'; `$env:DATABASE_URL='$DatabaseUrl'; `$env:AUTOMATION_WORKER_ID='$AutomationWorkerId'; pnpm.cmd --filter @automation/worker-automation start *>> '$($AutomationLog.Replace("'", "''"))'"
  $automationProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $automationCommand
  ) -WorkingDirectory $SourceRoot -WindowStyle Hidden -PassThru
  $StartedAutomationProcessId = $automationProcess.Id
  Set-Content -LiteralPath $AutomationPidFile -Value $automationProcess.Id -Encoding ASCII
  Set-Content -LiteralPath $AutomationWorkerIdFile -Value $AutomationWorkerId -Encoding ASCII
  Log "Automation worker PID: $($automationProcess.Id) / ID: $AutomationWorkerId"

  $webCommand = "Set-Location -LiteralPath '$($SourceRoot.Replace("'", "''"))'; $webRuntimeEnv; pnpm.cmd --filter @automation/web dev *>> '$($WebLog.Replace("'", "''"))'"
  $webProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $webCommand
  ) -WorkingDirectory $SourceRoot -WindowStyle Hidden -PassThru
  $StartedWebProcessId = $webProcess.Id
  Set-Content -LiteralPath $WebPidFile -Value $webProcess.Id -Encoding ASCII
  Log "Web PID: $($webProcess.Id)"

  if (-not (Wait-AutomationWorkerReady -WorkerId $AutomationWorkerId -ProcessId $automationProcess.Id -TimeoutSeconds 60)) {
    Fail "Automation worker nao publicou heartbeat valido. Consulte AUTOMATION_WORKER.log." 29
  }
  Log "Automation worker confirmou heartbeat no PostgreSQL."

  if (-not (Wait-AppHealth -Url "$LocalUrl/api/health/live" -ExpectedStatus "ok" -ExpectedService "web" -TimeoutSeconds 120)) {
    Fail "Servidor web nao respondeu com a identidade esperada em /api/health/live. Consulte WEB_SERVER.log." 30
  }
  if (-not (Wait-AppHealth -Url "$LocalUrl/api/health/ready" -ExpectedStatus "ready" -ExpectedService "web" -TimeoutSeconds 60)) {
    Fail "Servidor web iniciou, mas /api/health/ready nao ficou pronto. Consulte WEB_SERVER.log." 31
  }
  $bootStatus = Wait-LocalRuntimeBootReady -Url "$LocalUrl/api/runtime/local-status?probe=boot" -TimeoutSeconds 30
  if ($null -eq $bootStatus) {
    Fail "Runtime abriu, mas o supervisor local nao confirmou worker/banco prontos." 33
  }
  if ([string]$bootStatus.status -ne "healthy") {
    $reasons = @($bootStatus.automationQueue.reasons) -join ", "
    Log "AVISO: runtime iniciou, mas o SLO operacional esta $($bootStatus.status). A fila permanecera ativa para auto-healing/drain. Motivos: $reasons"
  } else {
    Log "Supervisor operacional confirmou SLO healthy."
  }

  Log "[8/8] Smoke das telas essenciais..."
  $paths = @("/", "/inbox", "/contacts", "/automations", "/campaigns", "/analytics", "/ai", "/connections", "/reliability", "/testing")
  foreach ($path in $paths) {
    if (-not (Wait-Http200 "$LocalUrl$path" 30)) {
      Fail "Tela local falhou no smoke test: $path" 32
    }
    Log "HTTP 200: $path"
  }

  Write-Result -Status "PASS" -ExitCode 0 -Message "Runtime local ativo com persistencia preservada."
  Log "RUNTIME LOCAL ATIVO. Dashboard: $LocalUrl"
  if (-not $NoBrowser) { Start-Process "$LocalUrl/testing" | Out-Null }
  exit 0
} catch {
  $message = $_.Exception.Message
  Rollback-StartedProcesses
  if (-not (Test-Path -LiteralPath $ResultJson)) {
    Write-Result -Status "FAILED" -ExitCode 1 -Message $message
  }
  Log "Erro final: $message"
  exit 1
}
