param(
  [Parameter(Mandatory = $true)][string]$SourceRoot,
  [Parameter(Mandatory = $true)][string]$WorkDir,
  [Parameter(Mandatory = $true)][string]$ConsoleLog,
  [Parameter(Mandatory = $false)][switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$RequiredPnpmVersion = "9.15.4"
$StateDir = Join-Path $SourceRoot ".local-runtime"
$DependencyHashFile = Join-Path $StateDir "dependencies.sha256"
$LocalBinDir = Join-Path $StateDir "bin"
$PnpmShim = Join-Path $LocalBinDir "pnpm.cmd"
$ReportPath = Join-Path $WorkDir "ENVIRONMENT_DOCTOR.json"
$TextPath = Join-Path $WorkDir "ENVIRONMENT_DOCTOR.txt"
$checks = New-Object System.Collections.Generic.List[object]
$autoFixes = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]
$blockers = New-Object System.Collections.Generic.List[string]
$packageIntegrityOk = $false

New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

function Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $ConsoleLog -Value $line
}

function Add-Check([string]$Name, [bool]$Pass, [string]$Value, [string]$Action = "") {
  $checks.Add([ordered]@{ name = $Name; pass = $Pass; value = $Value; action = $Action }) | Out-Null
  if (-not $Pass -and -not [string]::IsNullOrWhiteSpace($Action)) { $blockers.Add($Action) | Out-Null }
}

function Command-Exists([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$Label) {
  Log "Executando: $Label"
  & $FilePath @Arguments 2>&1 | Tee-Object -FilePath $ConsoleLog -Append
  if ($LASTEXITCODE -ne 0) { throw "$Label falhou com codigo $LASTEXITCODE" }
}

function Test-DockerDaemon {
  if (-not (Command-Exists "docker.exe")) { return $false }
  & docker.exe info *> $null
  return $LASTEXITCODE -eq 0
}

function Find-DockerDesktop {
  $candidates = @(
    (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe")
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Ensure-DockerDaemon {
  if (-not (Command-Exists "docker.exe")) {
    Add-Check "docker-cli" $false "nao encontrado" "Instale Docker Desktop e marque a opcao para adicionar Docker ao PATH."
    return $false
  }
  Add-Check "docker-cli" $true ((& docker.exe --version 2>$null | Select-Object -First 1) + "")
  if (Test-DockerDaemon) {
    Add-Check "docker-daemon" $true "ativo"
    return $true
  }

  $desktop = Find-DockerDesktop
  if ($null -eq $desktop) {
    Add-Check "docker-daemon" $false "inativo; Docker Desktop executavel nao localizado" "Abra o Docker Desktop e execute a qualificacao novamente."
    return $false
  }

  try {
    Log "Docker daemon inativo; tentando abrir Docker Desktop automaticamente."
    Start-Process -FilePath $desktop | Out-Null
    $autoFixes.Add("Docker Desktop iniciado automaticamente") | Out-Null
  } catch {
    Add-Check "docker-daemon" $false "falha ao abrir Docker Desktop: $($_.Exception.Message)" "Abra o Docker Desktop manualmente e execute novamente."
    return $false
  }

  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep -Seconds 3
    if (Test-DockerDaemon) {
      Add-Check "docker-daemon" $true "ativo apos bootstrap"
      return $true
    }
  } while ((Get-Date) -lt $deadline)

  Add-Check "docker-daemon" $false "nao ficou pronto em 180s" "Abra o Docker Desktop, confirme que o engine iniciou e execute novamente."
  return $false
}

function Ensure-Pnpm {
  if (-not (Command-Exists "corepack.cmd")) {
    Add-Check "corepack" $false "nao encontrado" "Reinstale Node.js 22 LTS com Corepack disponivel."
    return $false
  }
  Add-Check "corepack" $true ((& corepack.cmd --version 2>$null | Select-Object -First 1) + "")

  $current = ""
  if (Command-Exists "pnpm.cmd") {
    try { $current = ((& pnpm.cmd --version 2>$null | Select-Object -First 1) + "").Trim() } catch {}
  }
  if ($current -eq $RequiredPnpmVersion) {
    Add-Check "pnpm" $true $current
    return $true
  }

  try {
    Invoke-Checked "corepack.cmd" @("prepare", "pnpm@$RequiredPnpmVersion", "--activate") "preparar pnpm $RequiredPnpmVersion via Corepack"
    New-Item -ItemType Directory -Path $LocalBinDir -Force | Out-Null
    @"
@echo off
corepack.cmd pnpm %*
"@ | Set-Content -LiteralPath $PnpmShim -Encoding ASCII
    $env:PATH = "$LocalBinDir;$env:PATH"
    $autoFixes.Add("shim local de pnpm $RequiredPnpmVersion criado sem exigir permissao administrativa") | Out-Null
  } catch {
    Add-Check "pnpm" $false "nao foi possivel preparar $RequiredPnpmVersion" "Verifique internet/DNS para registry.npmjs.org e execute novamente."
    return $false
  }

  $current = ((& $PnpmShim --version 2>$null | Select-Object -First 1) + "").Trim()
  $ok = $current -eq $RequiredPnpmVersion
  Add-Check "pnpm" $ok $current $(if ($ok) { "" } else { "Nao foi possivel ativar o pnpm exigido pelo pacote." })
  return $ok
}

function Ensure-Dependencies {
  if ($SkipDependencyInstall) {
    $warnings.Add("Instalacao de dependencias ignorada por parametro.") | Out-Null
    return $true
  }
  $lockFile = Join-Path $SourceRoot "pnpm-lock.yaml"
  if (-not (Test-Path -LiteralPath $lockFile)) {
    Add-Check "dependency-lock" $false "pnpm-lock.yaml ausente" "Use um pacote de release completo e integro."
    return $false
  }
  $lockHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash.ToLowerInvariant()
  $marker = Join-Path $SourceRoot "node_modules\.modules.yaml"
  $recordedHash = ""
  if (Test-Path -LiteralPath $DependencyHashFile) {
    $recordedHash = ((Get-Content -LiteralPath $DependencyHashFile -ErrorAction SilentlyContinue | Select-Object -First 1) + "").Trim().ToLowerInvariant()
  }
  if ((Test-Path -LiteralPath $marker) -and $recordedHash -eq $lockHash) {
    Add-Check "dependencies" $true "node_modules corresponde ao lockfile"
    return $true
  }
  try {
    Invoke-Checked $PnpmShim @("install", "--frozen-lockfile") "pnpm install --frozen-lockfile"
    Set-Content -LiteralPath $DependencyHashFile -Value $lockHash -Encoding ASCII
    $autoFixes.Add("Dependencias instaladas/atualizadas pelo pnpm-lock.yaml") | Out-Null
    Add-Check "dependencies" $true "instaladas pelo lockfile"
    return $true
  } catch {
    Add-Check "dependencies" $false $_.Exception.Message "Verifique internet/DNS e espaco em disco; depois execute novamente."
    return $false
  }
}

function Find-Browser {
  $commands = @("msedge.exe", "chrome.exe", "chromium.exe")
  foreach ($name in $commands) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -ne $cmd) { return $cmd.Source }
  }
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Test-PowerShellParser {
  $script = Join-Path $SourceRoot "scripts\windows\Test-PowerShellSyntax.ps1"
  if (-not (Test-Path -LiteralPath $script)) {
    Add-Check "powershell-parser" $false "script de parser ausente" "Use um pacote de release completo e integro."
    return $false
  }
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $script -DirectoryPath (Join-Path $SourceRoot "scripts\windows") 2>&1 | Tee-Object -FilePath $ConsoleLog -Append
  $ok = $LASTEXITCODE -eq 0
  Add-Check "powershell-parser" $ok $(if ($ok) { "todos os .ps1 parsearam" } else { "falha de sintaxe detectada" }) $(if ($ok) { "" } else { "Consulte o log e corrija os scripts PowerShell antes da qualificacao." })
  return $ok
}

try {
  Set-Location -LiteralPath $SourceRoot
  Log "RC17 Environment Doctor iniciado."

  if (-not (Command-Exists "node.exe")) {
    Add-Check "node" $false "nao encontrado" "Instale Node.js 22 LTS e execute novamente."
  } else {
    $nodeVersion = ((& node.exe --version 2>$null | Select-Object -First 1) + "").Trim()
    $major = 0
    try { $major = [int]($nodeVersion.TrimStart("v").Split(".")[0]) } catch {}
    Add-Check "node" ($major -ge 20) $nodeVersion $(if ($major -ge 20) { "" } else { "Atualize para Node.js 22 LTS." })
    if ($major -ne 22 -and $major -ge 20) { $warnings.Add("Node $nodeVersion e suportado, mas Node.js 22 LTS e a referencia de qualificacao.") | Out-Null }
  }

  if (Command-Exists "node.exe") {
    $manifestVerifier = Join-Path $SourceRoot "scripts\verify-build-manifest.mjs"
    if (-not (Test-Path -LiteralPath $manifestVerifier)) {
      Add-Check "package-integrity" $false "verificador de manifest ausente" "Baixe/extraía novamente um pacote oficial completo."
    } else {
      & node.exe $manifestVerifier --root $SourceRoot --json 2>&1 | Tee-Object -FilePath $ConsoleLog -Append | Out-Null
      $manifestOk = $LASTEXITCODE -eq 0
      $packageIntegrityOk = $manifestOk
      Add-Check "package-integrity" $manifestOk $(if ($manifestOk) { "BUILD_MANIFEST verificado" } else { "hash divergente, arquivo ausente ou arquivo inesperado" }) $(if ($manifestOk) { "" } else { "Nao execute auto-reparo neste pacote; extraia novamente o ZIP oficial." })
    }
  }

  if (-not $packageIntegrityOk) {
    $status = "BLOCKED"
    $report = [ordered]@{
      schemaVersion = 2
      release = "RC17-final-closure"
      status = $status
      capturedAt = (Get-Date).ToString("o")
      sourceRoot = $SourceRoot
      checks = @($checks)
      autoFixes = @($autoFixes)
      warnings = @($warnings)
      blockers = @($blockers | Select-Object -Unique)
      failClosed = $true
      stoppedBeforeAutoRepair = $true
    }
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
    @(
      "AUTOMATION PLATFORM - ENVIRONMENT DOCTOR"
      "Status: BLOCKED"
      "Motivo: PACKAGE_INTEGRITY_FAILED"
      "Auto-repair executado: NAO"
      "JSON: $ReportPath"
    ) | Set-Content -LiteralPath $TextPath -Encoding UTF8
    Log "Environment Doctor: BLOCKED - integridade do pacote falhou; nenhum auto-reparo sera executado."
    exit 1
  }

  try {
    $rootItem = Get-Item -LiteralPath $SourceRoot
    $drive = Get-PSDrive -Name $rootItem.PSDrive.Name
    $freeGb = [math]::Round($drive.Free / 1GB, 2)
    if ($freeGb -lt 3) { Add-Check "disk-free" $false "$freeGb GB" "Libere pelo menos 3 GB no disco da ferramenta." }
    else {
      Add-Check "disk-free" $true "$freeGb GB"
      if ($freeGb -lt 8) { $warnings.Add("Espaco livre abaixo de 8 GB; builds e imagens Docker podem exigir mais espaco.") | Out-Null }
    }
  } catch { $warnings.Add("Nao foi possivel medir espaco livre: $($_.Exception.Message)") | Out-Null }

  $pnpmReady = Ensure-Pnpm
  if ($pnpmReady) { [void](Ensure-Dependencies) }
  [void](Ensure-DockerDaemon)

  $browser = Find-Browser
  Add-Check "browser" ($null -ne $browser) $(if ($null -ne $browser) { $browser } else { "nao encontrado" }) $(if ($null -ne $browser) { "" } else { "Instale Microsoft Edge ou Google Chrome para a qualificacao real de browser." })
  if (Command-Exists "powershell.exe") { [void](Test-PowerShellParser) }
  else { Add-Check "powershell" $false "powershell.exe ausente" "Use Windows com PowerShell 5.1+ para a qualificacao local." }

  $status = if ($blockers.Count -eq 0) { "READY" } else { "BLOCKED" }
  $report = [ordered]@{
    schemaVersion = 2
    release = "RC17-final-closure"
    status = $status
    capturedAt = (Get-Date).ToString("o")
    sourceRoot = $SourceRoot
    checks = @($checks)
    autoFixes = @($autoFixes)
    warnings = @($warnings)
    blockers = @($blockers | Select-Object -Unique)
  }
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  @(
    "AUTOMATION PLATFORM - ENVIRONMENT DOCTOR"
    "Status: $status"
    "Auto-fixes: $($autoFixes.Count)"
    "Warnings: $($warnings.Count)"
    "Blockers: $($blockers.Count)"
    "JSON: $ReportPath"
  ) | Set-Content -LiteralPath $TextPath -Encoding UTF8
  Log "Environment Doctor: $status"
  if ($status -ne "READY") { exit 1 }
  exit 0
} catch {
  $message = $_.Exception.Message
  Log "Environment Doctor falhou: $message"
  $report = [ordered]@{
    schemaVersion = 2
    release = "RC17-final-closure"
    status = "BLOCKED"
    capturedAt = (Get-Date).ToString("o")
    sourceRoot = $SourceRoot
    checks = @($checks)
    autoFixes = @($autoFixes)
    warnings = @($warnings)
    blockers = @($blockers) + @($message)
  }
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  exit 1
}
