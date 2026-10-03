param(
  [Parameter(Mandatory = $true)][string]$SourceRoot,
  [Parameter(Mandatory = $false)][string]$BackupDir = ""
)
$ErrorActionPreference = "Stop"
$DbContainer = "automation-platform-local-db"
$DbName = "automation_local"
$DbUser = "postgres"
if ([string]::IsNullOrWhiteSpace($BackupDir)) { $BackupDir = Join-Path $SourceRoot "backups" }
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

function Fail([string]$Message) { Write-Host "BACKUP FAIL: $Message" -ForegroundColor Red; exit 1 }
function Text-Sha256([string]$Text) {
  $bytes=[Text.Encoding]::UTF8.GetBytes($Text); $sha=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-","").ToLowerInvariant() } finally { $sha.Dispose() }
}
function Local-Ledger {
  $rows=@()
  Get-ChildItem -LiteralPath (Join-Path $SourceRoot "database") -Filter "*.sql" | Where-Object { $_.Name -match '^\d{3}_[A-Za-z0-9_]+\.sql$' } | Sort-Object Name | ForEach-Object {
    $rows += [ordered]@{ version=$_.Name; checksumSha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  return ,$rows
}
function Ledger-Summary($Rows) {
  $parts=@($Rows | ForEach-Object { "$($_.version):$($_.checksumSha256)" })
  $text=[string]::Join("`n",$parts)
  $rowCount=@($Rows).Count;$latestVersion=if($rowCount){$Rows[-1].version}else{$null};return [ordered]@{ count=$rowCount; latestVersion=$latestVersion; digestSha256=(Text-Sha256 $text); entries=@($Rows) }
}

if ($null -eq (Get-Command docker.exe -ErrorAction SilentlyContinue)) { Fail "Docker Desktop/docker.exe nao encontrado." }
& docker.exe inspect $DbContainer *> $null; if ($LASTEXITCODE -ne 0) { Fail "Banco local nao existe. Inicie a ferramenta primeiro." }
& docker.exe start $DbContainer *> $null; if ($LASTEXITCODE -ne 0) { Fail "Nao foi possivel iniciar o PostgreSQL local." }

$stamp=Get-Date -Format "yyyy-MM-ddTHH-mm-ss-fff"
$name="automation-platform-$stamp.dump"
$inside="/tmp/$name"
$out=Join-Path $BackupDir $name
$manifest="$out.json"
$journal="$out.recovery.json"
$history=@([ordered]@{from="planned";to="validating";at=(Get-Date).ToString("o");phase="validating-source"})
try {
  $ledgerLines=@(& docker.exe exec $DbContainer psql -U $DbUser -d $DbName -Atqc "select version||'|'||checksum_sha256 from app_private.schema_migrations order by version asc;")
  if ($LASTEXITCODE -ne 0 -or $ledgerLines.Count -eq 0) { Fail "Ledger de migrations nao pode ser lido." }
  $sourceRows=@(); foreach($line in $ledgerLines){ if([string]::IsNullOrWhiteSpace($line)){continue}; $parts=$line.Trim().Split('|',2); if($parts.Count-ne 2){Fail "Ledger invalido."}; $sourceRows += [ordered]@{version=$parts[0];checksumSha256=$parts[1]} }
  $localRows=Local-Ledger
  if($sourceRows.Count -gt $localRows.Count){Fail "DATABASE_SCHEMA_AHEAD_OF_BINARY"}
  for($i=0;$i-lt $sourceRows.Count;$i++){ if($sourceRows[$i].version-ne$localRows[$i].version){Fail "MIGRATION_HISTORY_GAP_OR_OUT_OF_ORDER"}; if($sourceRows[$i].checksumSha256-ne$localRows[$i].checksumSha256){Fail "MIGRATION_CHECKSUM_MISMATCH"} }
  $sourceLedger=Ledger-Summary $sourceRows; $localLedger=Ledger-Summary $localRows
  $oldContainer=$env:INTEGRITY_DOCKER_CONTAINER; $oldDb=$env:INTEGRITY_DB_NAME; $oldUser=$env:INTEGRITY_DB_USER
  try {
    $env:INTEGRITY_DOCKER_CONTAINER=$DbContainer; $env:INTEGRITY_DB_NAME=$DbName; $env:INTEGRITY_DB_USER=$DbUser
    $integrityJson=& node.exe (Join-Path $SourceRoot "scripts\database-integrity-cli.mjs")
    if($LASTEXITCODE-ne0){Fail "DATABASE_INTEGRITY_CAPTURE_FAILED"}
    $integrityProfile=$integrityJson | ConvertFrom-Json
  } finally { $env:INTEGRITY_DOCKER_CONTAINER=$oldContainer; $env:INTEGRITY_DB_NAME=$oldDb; $env:INTEGRITY_DB_USER=$oldUser }
  $history += [ordered]@{from="validating";to="running";at=(Get-Date).ToString("o");phase="creating-dump"}
  & docker.exe exec $DbContainer pg_dump -U $DbUser -d $DbName --format=custom --no-owner --no-privileges --no-subscriptions --schema app_private --file $inside
  if ($LASTEXITCODE -ne 0) { Fail "pg_dump falhou." }
  & docker.exe exec $DbContainer pg_restore --list $inside *> $null; if ($LASTEXITCODE -ne 0) { Fail "Archive gerado e invalido." }
  $history += [ordered]@{from="running";to="verifying";at=(Get-Date).ToString("o");phase="verifying-archive"}
  & docker.exe cp "$DbContainer`:$inside" $out *> $null; if ($LASTEXITCODE -ne 0) { Fail "docker cp do backup falhou." }
  $sha=(Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash.ToLowerInvariant(); $bytes=(Get-Item -LiteralPath $out).Length
  $payload=[ordered]@{schemaVersion=4;createdAt=(Get-Date).ToString("o");file=$name;bytes=$bytes;sha256=$sha;format="pg_dump-custom";schemas=@("app_private");sourceFingerprint=(Text-Sha256 "local-docker:$DbContainer/$DbName");retentionDays=14;migrationLedger=$sourceLedger;applicationLedgerAtBackup=[ordered]@{count=$localLedger.count;latestVersion=$localLedger.latestVersion;digestSha256=$localLedger.digestSha256};migrationUpgradeRequiredAtBackup=($sourceRows.Count-lt$localRows.Count);pendingMigrationsAtBackup=@($localRows.entries | Select-Object -Skip $sourceRows.Count | ForEach-Object {$_.version});integrityProfile=$integrityProfile}
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifest -Encoding UTF8
  $history += [ordered]@{from="verifying";to="completed";at=(Get-Date).ToString("o");phase="completed"}
  [ordered]@{schemaVersion=1;operationType="backup";state="completed";phase="completed";createdAt=$history[0].at;updatedAt=(Get-Date).ToString("o");completedAt=(Get-Date).ToString("o");backupSha256=$sha;migrationLedgerDigest=$sourceLedger.digestSha256;history=$history} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $journal -Encoding UTF8
  Write-Host "BACKUP PASS" -ForegroundColor Green; Write-Host $out; Write-Host "SHA-256: $sha"; Write-Host "Ledger: $($sourceLedger.count) / $($sourceLedger.digestSha256)"; Write-Host "Integrity: $($integrityProfile.profileDigestSha256)"
} finally { & docker.exe exec $DbContainer rm -f $inside *> $null }
