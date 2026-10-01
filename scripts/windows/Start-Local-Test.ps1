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

$DbContainer = "automation-platform-local-db"
$DbPort = 55432
$DbName = "automation_local"
$DbUser = "postgres"
$DbPassword = "postgres"
$LocalUserId = "00000000-0000-4000-8000-000000000001"
$LocalUrl = "http://127.0.0.1:3000"
$DatabaseUrl = "postgresql://$DbUser`:$DbPassword@127.0.0.1:$DbPort/$DbName"
$StateDir = Join-Path $SourceRoot ".local-test"
$WebPidFile = Join-Path $StateDir "web.pid"
$WebLog = Join-Path $WorkDir "WEB_SERVER.log"
$ResultJson = Join-Path $WorkDir "LOCAL_TEST_RESULT.json"
$ResultTxt = Join-Path $WorkDir "RESULTADO.txt"

New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

function Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $ConsoleLog -Value $line
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

function Write-Result {
  param(
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $false)][string]$Message = ""
  )

  $payload = [ordered]@{
    status = $Status
    exitCode = $ExitCode
    message = $Message
    sourceRoot = $SourceRoot
    reportDirectory = $WorkDir
    localUrl = $LocalUrl
    databaseContainer = $DbContainer
    databasePort = $DbPort
    webLog = $WebLog
    finishedAt = (Get-Date).ToString("o")
  }
  $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ResultJson -Encoding UTF8

  @(
    "AUTOMATION PLATFORM - TESTE LOCAL WINDOWS"
    "Status: $Status"
    "Codigo de saida: $ExitCode"
    "Mensagem: $Message"
    "Dashboard local: $LocalUrl"
    "Relatorios: $WorkDir"
    "Banco local: $DbContainer (porta $DbPort)"
    "Para encerrar: PARAR-FERRAMENTA-WINDOWS.cmd"
  ) | Set-Content -LiteralPath $ResultTxt -Encoding UTF8
}

try {
  Set-Location -LiteralPath $SourceRoot
  Log "Inicio do teste local completo."

  Log "[1/9] Validando Node, Corepack e Docker..."
  if (-not (Command-Exists "node.exe")) { Fail "Node.js nao encontrado. Instale Node.js 22 LTS e execute novamente." 10 }
  if (-not (Command-Exists "corepack.cmd")) { Fail "Corepack nao encontrado na instalacao do Node.js." 11 }
  if (-not (Command-Exists "docker.exe")) { Fail "Docker Desktop nao encontrado. Instale/abra o Docker Desktop e execute novamente." 12 }

  $nodeVersion = (& node.exe --version).TrimStart("v")
  $nodeMajor = [int]($nodeVersion.Split(".")[0])
  if ($nodeMajor -lt 20) { Fail "Node.js 20+ obrigatorio. Detectado: v$nodeVersion" 13 }
  Log "Node detectado: v$nodeVersion"

  & docker.exe info *> $null
  if ($LASTEXITCODE -ne 0) { Fail "Docker Desktop esta instalado, mas o daemon nao esta ativo." 14 }

  Log "[2/9] Preparando pnpm e dependencias..."
  Invoke-External -FilePath "corepack.cmd" -Arguments @("enable") -Label "corepack enable"
  Invoke-External -FilePath "corepack.cmd" -Arguments @("prepare", "pnpm@9.15.4", "--activate") -Label "pnpm 9.15.4"
  Invoke-External -FilePath "pnpm.cmd" -Arguments @("install", "--frozen-lockfile") -Label "pnpm install --frozen-lockfile"

  Log "[3/9] Criando PostgreSQL local isolado..."
  $existing = (& docker.exe ps -a --filter "name=^/$DbContainer$" --format "{{.Names}}") -join ""
  if ($existing -eq $DbContainer) {
    & docker.exe rm -f $DbContainer *> $null
  }

  Invoke-External -FilePath "docker.exe" -Arguments @(
    "run", "-d",
    "--name", $DbContainer,
    "-e", "POSTGRES_USER=$DbUser",
    "-e", "POSTGRES_PASSWORD=$DbPassword",
    "-e", "POSTGRES_DB=$DbName",
    "-p", "127.0.0.1:$DbPort`:5432",
    "postgres:16-alpine"
  ) -Label "docker postgres:16-alpine"

  $dbReady = $false
  for ($attempt = 1; $attempt -le 45; $attempt++) {
    & docker.exe exec $DbContainer pg_isready -U $DbUser -d $DbName *> $null
    if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $dbReady) { Fail "PostgreSQL local nao ficou pronto em 45 segundos." 20 }

  Log "[4/9] Criando stubs Supabase Auth e usuario local..."
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

  Log "[5/9] Aplicando migrations portaveis 001-012..."
  $previousDatabaseUrl = $env:DATABASE_URL
  $env:DATABASE_URL = $DatabaseUrl
  try {
    Invoke-External -FilePath "pnpm.cmd" -Arguments @("--filter", "@automation/storage-postgres", "migrate") -Label "migration runner"
  } finally {
    if ($null -eq $previousDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
    else { $env:DATABASE_URL = $previousDatabaseUrl }
  }

  Log "[6/9] Gravando ambiente local seguro..."
  $envFile = Join-Path $SourceRoot "apps\web\.env.local"
  @"
APP_ORIGIN=http://127.0.0.1:3000
DATABASE_URL=$DatabaseUrl
DATABASE_POOL_MAX=4
LOCAL_TEST_MODE=true
LOCAL_TEST_USER_ID=$LocalUserId
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-test-only
GOOGLE_AUTH_ENABLED=false
LEGAL_ENTITY_NAME=Automation Platform Local Test
SUPPORT_EMAIL=local-test@example.test
INSTAGRAM_GRAPH_BASE_URL=https://graph.instagram.com/
INSTAGRAM_GRAPH_API_VERSION=v26.0
INSTAGRAM_OAUTH_TOKEN_ENCODING=multipart
INSTAGRAM_LONG_LIVED_TOKEN_URL=https://graph.instagram.com/access_token
"@ | Set-Content -LiteralPath $envFile -Encoding UTF8

  Log "[7/9] Rodando typecheck, testes e build..."
  Invoke-External -FilePath "pnpm.cmd" -Arguments @("typecheck") -Label "pnpm typecheck"
  Invoke-External -FilePath "pnpm.cmd" -Arguments @("test") -Label "pnpm test"
  Invoke-External -FilePath "pnpm.cmd" -Arguments @("build") -Label "pnpm build"

  Log "[8/9] Iniciando dashboard local..."
  if (Test-Path -LiteralPath $WebPidFile) {
    $oldPid = (Get-Content -LiteralPath $WebPidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($oldPid -match '^\d+$') {
      Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $WebPidFile -Force -ErrorAction SilentlyContinue
  }

  $webCommand = "Set-Location -LiteralPath '$($SourceRoot.Replace("'", "''"))'; pnpm.cmd --filter @automation/web dev *>> '$($WebLog.Replace("'", "''"))'"
  $webProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $webCommand
  ) -WorkingDirectory $SourceRoot -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $WebPidFile -Value $webProcess.Id -Encoding ASCII
  Log "Web PID: $($webProcess.Id)"

  if (-not (Wait-Http200 "$LocalUrl/api/health/live" 120)) {
    Fail "Servidor web nao respondeu /api/health/live. Consulte WEB_SERVER.log." 30
  }
  if (-not (Wait-Http200 "$LocalUrl/api/health/ready" 60)) {
    Fail "Servidor web iniciou, mas /api/health/ready nao ficou pronto. Consulte WEB_SERVER.log." 31
  }

  Log "[9/9] Smoke test das telas principais..."
  $paths = @("/", "/connections", "/reliability")
  foreach ($path in $paths) {
    if (-not (Wait-Http200 "$LocalUrl$path" 30)) {
      Fail "Tela local falhou no smoke test: $path" 32
    }
    Log "HTTP 200: $path"
  }

  Write-Result -Status "PASS" -ExitCode 0 -Message "Auditoria completa concluida; dashboard local ativo."
  Log "TESTE LOCAL PASS. Dashboard: $LocalUrl"
  Start-Process $LocalUrl | Out-Null
  Start-Process explorer.exe $WorkDir | Out-Null
  exit 0
} catch {
  $message = $_.Exception.Message
  if (-not (Test-Path -LiteralPath $ResultJson)) {
    Write-Result -Status "FAILED" -ExitCode 1 -Message $message
  }
  Log "Erro final: $message"
  Start-Process explorer.exe $WorkDir -ErrorAction SilentlyContinue | Out-Null
  exit 1
}
