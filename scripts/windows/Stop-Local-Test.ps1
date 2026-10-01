param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot
)

$ErrorActionPreference = "SilentlyContinue"
$StateDir = Join-Path $SourceRoot ".local-test"
$WebPidFile = Join-Path $StateDir "web.pid"
$DbContainer = "automation-platform-local-db"
$EnvFile = Join-Path $SourceRoot "apps\web\.env.local"

Write-Host "Encerrando Automation Platform local..."

if (Test-Path -LiteralPath $WebPidFile) {
  $pidValue = Get-Content -LiteralPath $WebPidFile | Select-Object -First 1
  if ($pidValue -match '^\d+$') {
    & taskkill.exe /PID $pidValue /T /F *> $null
    Write-Host "Servidor web encerrado (PID $pidValue)."
  }
}

$existing = (& docker.exe ps -a --filter "name=^/$DbContainer$" --format "{{.Names}}" 2>$null) -join ""
if ($existing -eq $DbContainer) {
  & docker.exe rm -f $DbContainer *> $null
  Write-Host "PostgreSQL local removido."
}

Remove-Item -LiteralPath $WebPidFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue

Write-Host "Ambiente local encerrado."
exit 0
