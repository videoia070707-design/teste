param(
  [Parameter(Mandatory = $false)]
  [string]$DirectoryPath = ".\scripts\windows"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DirectoryPath)) {
  Write-Error "Diretorio de scripts nao encontrado: $DirectoryPath"
  exit 2
}

$files = Get-ChildItem -LiteralPath $DirectoryPath -Filter *.ps1 -File -Recurse
if (-not $files) {
  Write-Host "Nenhum script PowerShell encontrado em $DirectoryPath"
  exit 0
}

$failed = $false
foreach ($file in $files) {
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile(
    $file.FullName,
    [ref]$tokens,
    [ref]$errors
  )

  if ($errors.Count -gt 0) {
    $failed = $true
    Write-Host "[PARSER FAIL] $($file.FullName)" -ForegroundColor Red
    foreach ($parseError in $errors) {
      Write-Host "  Linha $($parseError.Extent.StartLineNumber): $($parseError.Message)" -ForegroundColor Red
    }
  } else {
    Write-Host "[PARSER OK] $($file.Name)" -ForegroundColor Green
  }
}

if ($failed) { exit 2 }
exit 0
