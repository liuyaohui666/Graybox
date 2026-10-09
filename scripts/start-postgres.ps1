param([Parameter(Mandatory=$true)][string]$DataDirectory,[Parameter(Mandatory=$true)][string]$LogPath,[int]$Port=55439)
$ErrorActionPreference='Stop'
$pgControl='C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe'
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Invalid PostgreSQL port' }
$DataDirectory=[IO.Path]::GetFullPath($DataDirectory)
$LogPath=[IO.Path]::GetFullPath($LogPath)
if (-not (Test-Path -LiteralPath (Join-Path $DataDirectory 'PG_VERSION'))) { throw 'Local PostgreSQL is not initialized' }
& $pgControl status -D $DataDirectory *> $null
if ($LASTEXITCODE -ne 0) {
  # A separate hidden console keeps PostgreSQL out of the shortcut's console.
  # Wait for pg_ctl itself, not Start-Process -Wait (which waits for its children).
  $arguments=@('start','-D',('"'+$DataDirectory+'"'),'-o',('"-p '+$Port+' -h 127.0.0.1"'),'-l',('"'+$LogPath+'"'),'-w','-t','15')
  $control=Start-Process -FilePath $pgControl -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $control.WaitForExit(20000) -or $control.ExitCode -ne 0) { throw 'Could not start isolated PostgreSQL. See its log.' }
}
& $pgControl status -D $DataDirectory *> $null
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not remain running' }
