$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$statePath=Join-Path $repoRoot '.local/api-process.json'
if(Test-Path -LiteralPath $statePath){
  $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $ownedProcess=Get-Process -Id $state.pid -ErrorAction SilentlyContinue
  if($ownedProcess){
    if($ownedProcess.Path -ne $state.executable -or $ownedProcess.StartTime.ToUniversalTime().ToString('O') -ne $state.start_time){throw 'Process identity changed; refusing to stop it.'}
    Stop-Process -Id $ownedProcess.Id
    Write-Host 'Stopped the API started by the local launcher.'
  }
}
# Leave PostgreSQL running: it may serve an active MCP/CLI or another Graybox window.
Write-Host 'Desktop windows can be closed normally. The isolated database is still running.'
