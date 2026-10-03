param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,

  [Parameter(Mandatory = $true)]
  [string]$ConfirmToken
)

$ErrorActionPreference = "Stop"
if ($ConfirmToken -ne "APAGAR") {
  Write-Host "Reset cancelado: confirmacao invalida."
  exit 2
}

$DbContainer = "automation-platform-local-db"
$DbVolume = "automation-platform-local-db-data"
$StateDir = Join-Path $SourceRoot ".local-runtime"
$LegacyStateDir = Join-Path $SourceRoot ".local-test"

& (Join-Path $SourceRoot "scripts\windows\Stop-Local-Runtime.ps1") -SourceRoot $SourceRoot | Out-Host

$existing = (& docker.exe ps -a --filter "name=^/$DbContainer$" --format "{{.Names}}" 2>$null) -join ""
if ($existing -eq $DbContainer) {
  & docker.exe rm -f $DbContainer *> $null
}

$volume = (& docker.exe volume ls --filter "name=^$DbVolume$" --format "{{.Name}}" 2>$null) -join ""
if ($volume -eq $DbVolume) {
  & docker.exe volume rm -f $DbVolume *> $null
}

Remove-Item -LiteralPath $StateDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $LegacyStateDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Reset concluido. Banco/container/volume local foram removidos. Arquivos .env do usuario nao foram alterados."
Write-Host "Os ZIPs e historicos do Test Center nao foram apagados."
exit 0
