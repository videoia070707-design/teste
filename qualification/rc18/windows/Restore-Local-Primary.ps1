param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$BackupFile,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][string]$ExpectedLedgerDigest,
  [Parameter(Mandatory=$true)][string]$ExpectedIntegrityDigest,
  [Parameter(Mandatory=$false)][string]$ReceiptPath=""
)
$ErrorActionPreference="Stop"
$DbContainer="automation-platform-local-db";$DbName="automation_local";$DbUser="postgres"
function Fail([string]$Message){throw [System.Exception]::new($Message)}
$SourceRoot=[IO.Path]::GetFullPath($SourceRoot);$BackupFile=[IO.Path]::GetFullPath($BackupFile)
if([string]::IsNullOrWhiteSpace($ReceiptPath)){$ReceiptPath=Join-Path ([IO.Path]::GetDirectoryName($BackupFile)) ("primary-rollback-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmssfff"))}
if(-not(Test-Path -LiteralPath $BackupFile)){Fail "ROLLBACK_BACKUP_NOT_FOUND"};$manifestPath="$BackupFile.json";if(-not(Test-Path -LiteralPath $manifestPath)){Fail "ROLLBACK_BACKUP_MANIFEST_NOT_FOUND"}
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json;if([int]$manifest.schemaVersion-lt4){Fail "ROLLBACK_BACKUP_MANIFEST_INCOMPATIBLE"};if($null-eq$manifest.integrityProfile){Fail "ROLLBACK_BACKUP_INTEGRITY_PROFILE_REQUIRED"}
$sha=(Get-FileHash -LiteralPath $BackupFile -Algorithm SHA256).Hash.ToLowerInvariant();if($sha-ne$ExpectedSha256.ToLowerInvariant()){Fail "ROLLBACK_BACKUP_SHA256_CHANGED"};if($sha-ne([string]$manifest.sha256).ToLowerInvariant()){Fail "ROLLBACK_BACKUP_MANIFEST_SHA256_MISMATCH"}
if(([string]$manifest.migrationLedger.digestSha256).ToLowerInvariant()-ne$ExpectedLedgerDigest.ToLowerInvariant()){Fail "ROLLBACK_BACKUP_LEDGER_DIGEST_MISMATCH"};if(([string]$manifest.integrityProfile.profileDigestSha256).ToLowerInvariant()-ne$ExpectedIntegrityDigest.ToLowerInvariant()){Fail "ROLLBACK_BACKUP_INTEGRITY_DIGEST_MISMATCH"}
& docker.exe inspect $DbContainer *> $null;if($LASTEXITCODE-ne0){Fail "LOCAL_DATABASE_NOT_FOUND"};& docker.exe start $DbContainer *> $null
$inside="/tmp/$([IO.Path]::GetFileName($BackupFile))";$started=Get-Date
try{
  & docker.exe cp $BackupFile "$DbContainer`:$inside" *> $null;if($LASTEXITCODE-ne0){Fail "ROLLBACK_DOCKER_COPY_FAILED"}
  & docker.exe exec $DbContainer psql -U $DbUser -d postgres -v ON_ERROR_STOP=1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DbName' and pid<>pg_backend_pid();" *> $null;if($LASTEXITCODE-ne0){Fail "ROLLBACK_CONNECTION_DRAIN_FAILED"}
  & docker.exe exec $DbContainer pg_restore -U $DbUser -d $DbName --no-owner --no-privileges --exit-on-error --single-transaction --clean --if-exists --schema app_private $inside
  if($LASTEXITCODE-ne0){Fail "ROLLBACK_PG_RESTORE_FAILED"}
  & docker.exe exec $DbContainer psql -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -c "ANALYZE;" *> $null;if($LASTEXITCODE-ne0){Fail "ROLLBACK_ANALYZE_FAILED"}
  $lines=@(& docker.exe exec $DbContainer psql -U $DbUser -d $DbName -Atqc "select version||'|'||checksum_sha256 from app_private.schema_migrations order by version asc;")
  if($LASTEXITCODE-ne0){Fail "ROLLBACK_LEDGER_READ_FAILED"};$clean=@($lines|ForEach-Object{$_.Trim()}|Where-Object{$_});$ledgerText=[string]::Join("`n",@($clean|ForEach-Object{ $parts=$_.Split('|',2); "$($parts[0]):$($parts[1])" }))
  $bytes=[Text.Encoding]::UTF8.GetBytes($ledgerText);$hasher=[Security.Cryptography.SHA256]::Create();try{$actualLedger=([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace("-","").ToLowerInvariant()}finally{$hasher.Dispose()}
  if($actualLedger-ne$ExpectedLedgerDigest.ToLowerInvariant()){Fail "ROLLBACK_RESTORED_LEDGER_MISMATCH"}
  $oldContainer=$env:INTEGRITY_DOCKER_CONTAINER;$oldDb=$env:INTEGRITY_DB_NAME;$oldUser=$env:INTEGRITY_DB_USER
  try{$env:INTEGRITY_DOCKER_CONTAINER=$DbContainer;$env:INTEGRITY_DB_NAME=$DbName;$env:INTEGRITY_DB_USER=$DbUser;$integrityRaw=& node.exe (Join-Path $SourceRoot "scripts\database-integrity-cli.mjs");if($LASTEXITCODE-ne0){Fail "ROLLBACK_INTEGRITY_READ_FAILED"};$integrity=$integrityRaw|ConvertFrom-Json}finally{$env:INTEGRITY_DOCKER_CONTAINER=$oldContainer;$env:INTEGRITY_DB_NAME=$oldDb;$env:INTEGRITY_DB_USER=$oldUser}
  if(([string]$integrity.profileDigestSha256).ToLowerInvariant()-ne$ExpectedIntegrityDigest.ToLowerInvariant()){Fail "ROLLBACK_RESTORED_INTEGRITY_MISMATCH"}
  $receipt=[ordered]@{schemaVersion=1;status="PASS";restoredAt=(Get-Date).ToString("o");backupFile=$BackupFile;backupSha256=$sha;migrationLedgerDigest=$actualLedger;integrityProfileDigest=[string]$integrity.profileDigestSha256;primaryDatabase=$DbName;primaryDatabaseTouched=$true;singleTransaction=$true;durationMs=[int]((Get-Date)-$started).TotalMilliseconds}
  $receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
  Write-Host "PRIMARY ROLLBACK RESTORE PASS" -ForegroundColor Green;Write-Host "Receipt: $ReceiptPath"
} finally { & docker.exe exec $DbContainer rm -f $inside *> $null }
