param(
  [Parameter(Mandatory = $true)][string]$SourceRoot,
  [Parameter(Mandatory = $false)][string]$BackupFile = ""
)
$ErrorActionPreference="Stop"; $DbContainer="automation-platform-local-db"; $DbUser="postgres"
function Fail([string]$Message){Write-Host "RESTORE DRILL FAIL: $Message" -ForegroundColor Red;exit 1}
if([string]::IsNullOrWhiteSpace($BackupFile)){$candidate=Get-ChildItem -LiteralPath (Join-Path $SourceRoot "backups") -Filter "automation-platform-*.dump" -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1;if($null-eq$candidate){Fail "Nenhum backup encontrado."};$BackupFile=$candidate.FullName}
$BackupFile=[IO.Path]::GetFullPath($BackupFile);$Manifest="$BackupFile.json";if(-not(Test-Path -LiteralPath $BackupFile)){Fail "Backup nao existe."};if(-not(Test-Path -LiteralPath $Manifest)){Fail "Manifest v3 nao existe."}
$m=Get-Content -LiteralPath $Manifest -Raw|ConvertFrom-Json;if([int]$m.schemaVersion-lt4){Fail "Backup legado bloqueado para drill RC13."};if($null-eq$m.integrityProfile){Fail "BACKUP_INTEGRITY_PROFILE_REQUIRED"};$sha=(Get-FileHash -LiteralPath $BackupFile -Algorithm SHA256).Hash.ToLowerInvariant();if($sha-ne([string]$m.sha256).ToLowerInvariant()){Fail "BACKUP_SHA256_MISMATCH"}
$manifestLines=@($m.migrationLedger.entries|ForEach-Object{"$($_.version)|$($_.checksumSha256)"});if($manifestLines.Count-ne[int]$m.migrationLedger.count){Fail "MIGRATION_LEDGER_COUNT_MISMATCH"}
$target="automation_restore_drill_$(Get-Date -Format 'yyyyMMddHHmmssfff')";$inside="/tmp/$([IO.Path]::GetFileName($BackupFile))";$receipt=Join-Path ([IO.Path]::GetDirectoryName($BackupFile)) "restore-drill-$target.json"
try{
  & docker.exe inspect $DbContainer *> $null;if($LASTEXITCODE-ne0){Fail "Banco local nao existe."}; & docker.exe start $DbContainer *> $null
  & docker.exe cp $BackupFile "$DbContainer`:$inside" *> $null;if($LASTEXITCODE-ne0){Fail "docker cp falhou."}
  & docker.exe exec $DbContainer createdb -U $DbUser $target;if($LASTEXITCODE-ne0){Fail "Nao foi possivel criar banco descartavel."}
  $bootstrap="do `$`$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end `$`$; create schema if not exists auth; create table if not exists auth.users(id uuid primary key,email text,created_at timestamptz not null default now());"
  & docker.exe exec $DbContainer psql -U $DbUser -d $target -v ON_ERROR_STOP=1 -c $bootstrap *> $null;if($LASTEXITCODE-ne0){Fail "Bootstrap do banco descartavel falhou."}
  & docker.exe exec $DbContainer pg_restore -U $DbUser -d $target --no-owner --no-privileges --exit-on-error --single-transaction --schema app_private $inside;if($LASTEXITCODE-ne0){Fail "pg_restore falhou."}
  & docker.exe exec $DbContainer psql -U $DbUser -d $target -v ON_ERROR_STOP=1 -c "ANALYZE;" *> $null
  $restored=@(& docker.exe exec $DbContainer psql -U $DbUser -d $target -Atqc "select version||'|'||checksum_sha256 from app_private.schema_migrations order by version asc;")
  $clean=@($restored|ForEach-Object{$_.Trim()}|Where-Object{$_});if($clean.Count-ne$manifestLines.Count){Fail "RESTORED_MIGRATION_LEDGER_MISMATCH"};for($i=0;$i-lt$clean.Count;$i++){if($clean[$i]-ne$manifestLines[$i]){Fail "RESTORED_MIGRATION_LEDGER_MISMATCH"}}
  $oldContainer=$env:INTEGRITY_DOCKER_CONTAINER; $oldDb=$env:INTEGRITY_DB_NAME; $oldUser=$env:INTEGRITY_DB_USER
  try {
    $env:INTEGRITY_DOCKER_CONTAINER=$DbContainer; $env:INTEGRITY_DB_NAME=$target; $env:INTEGRITY_DB_USER=$DbUser
    $integrityJson=& node.exe (Join-Path $SourceRoot "scripts\database-integrity-cli.mjs")
    if($LASTEXITCODE-ne0){Fail "RESTORED_DATABASE_INTEGRITY_READ_FAILED"}
    $restoredIntegrity=$integrityJson|ConvertFrom-Json
  } finally { $env:INTEGRITY_DOCKER_CONTAINER=$oldContainer; $env:INTEGRITY_DB_NAME=$oldDb; $env:INTEGRITY_DB_USER=$oldUser }
  if(([string]$restoredIntegrity.profileDigestSha256)-ne([string]$m.integrityProfile.profileDigestSha256)){Fail "RESTORED_DATABASE_INTEGRITY_MISMATCH"}
  [ordered]@{schemaVersion=1;status="PASS";testedAt=(Get-Date).ToString("o");backupFile=[IO.Path]::GetFileName($BackupFile);backupSha256=$sha;migrationCount=$clean.Count;integrityProfileDigest=$restoredIntegrity.profileDigestSha256;postRestoreIntegrityVerified=$true;disposableDatabase=$target;primaryDatabaseTouched=$false} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding UTF8
  Write-Host "RESTORE DRILL PASS" -ForegroundColor Green;Write-Host "Banco principal nao foi alterado.";Write-Host "Receipt: $receipt"
} finally { & docker.exe exec $DbContainer dropdb -U $DbUser --if-exists $target *> $null; & docker.exe exec $DbContainer rm -f $inside *> $null }
