param([switch]$ServicesOnly,[string]$Executable)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskRoot = Split-Path $repoRoot -Parent
$dataRoot = Join-Path $taskRoot 'work/postgres/data'
$pgControl = 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe'
$runtimePath = Join-Path $repoRoot '.local/runtime.json'
if (-not (Test-Path -LiteralPath (Join-Path $dataRoot 'PG_VERSION'))) { throw 'The isolated local database has not been initialized. See README.md.' }
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.env'))) { throw 'Missing local .env. See README.md.' }
if (-not (Test-Path -LiteralPath $pgControl)) { throw 'PostgreSQL 18 binaries were not found.' }
& (Join-Path $PSScriptRoot 'start-postgres.ps1') -DataDirectory $dataRoot -LogPath (Join-Path $taskRoot 'work/postgres/postgres.log')
Push-Location $repoRoot
try {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  & $node --import tsx scripts/prepare-local-runtime.ts
  if ($LASTEXITCODE -ne 0) { throw 'Local database identity check failed.' }
  $expected = (Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json).environment_id
  function Read-Health {
    try { return (Invoke-RestMethod 'http://127.0.0.1:4318/v1/health' -TimeoutSec 2 -MaximumRedirection 0).data } catch { return $null }
  }
  $health = Read-Health
  if (-not $health) {
    # Fixed entrypoint and working directory; no shell or user-controlled command text.
    $apiProcess = Start-Process -FilePath $node -ArgumentList @('--import','tsx','apps/api/src/main.ts') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $repoRoot '.local/api.stdout.log') -RedirectStandardError (Join-Path $repoRoot '.local/api.stderr.log') -PassThru
    @{pid=$apiProcess.Id;start_time=$apiProcess.StartTime.ToUniversalTime().ToString('O');executable=$node} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $repoRoot '.local/api-process.json') -Encoding UTF8
    for ($attempt=0; $attempt -lt 20; $attempt++) { Start-Sleep -Milliseconds 250; $health=Read-Health; if($health){break}; if($apiProcess.HasExited){break} }
  }
  if (-not $health -or $health.mode -ne 'local' -or $health.environment_id -ne $expected) { throw 'Local API is unavailable or its environment does not match this database.' }
  Write-Host 'Graybox local API ready at http://127.0.0.1:4318'
  if (-not $ServicesOnly) {
    if (-not $Executable) { $Executable=Join-Path $repoRoot 'apps/desktop/src-tauri/target/debug/graybox-desktop.exe' }
    $Executable=[IO.Path]::GetFullPath($Executable)
    if (-not (Test-Path -LiteralPath $Executable)) { throw 'Build the native desktop first; see README.md.' }
    $env:GRAYBOX_CREDENTIALS_PATH=Join-Path $repoRoot '.local/credentials.json'
    $env:GRAYBOX_ENVIRONMENT_ID=$expected
    $appProcess=Start-Process -FilePath $Executable -WorkingDirectory $repoRoot -PassThru
    Write-Host "Graybox desktop started (PID $($appProcess.Id))."
  }
} finally { Pop-Location }
