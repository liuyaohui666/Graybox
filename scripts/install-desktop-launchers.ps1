param([switch]$SkipShortcuts,[switch]$IncludeLocal)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=[IO.Path]::GetFullPath((Join-Path $repo '../outputs'))
$source=Join-Path $repo 'apps/desktop/src-tauri/target/debug/graybox-desktop.exe'
if (-not (Test-Path -LiteralPath $source)) { throw 'Build the native application first.' }
# A GUI subsystem executable never allocates a console, including debug builds.
$bytes=[IO.File]::ReadAllBytes($source)
$pe=[BitConverter]::ToInt32($bytes,0x3c)
if ([BitConverter]::ToUInt16($bytes,$pe+24+68) -ne 2) { throw 'Expected a Windows GUI executable.' }
$shell=New-Object -ComObject WScript.Shell
$modes=if ($IncludeLocal) { @('cloud','local') } else { @('cloud') }
foreach ($mode in $modes) {
  $folder=Join-Path $output ('Graybox-'+$mode)
  if (-not (Test-Path -LiteralPath $folder)) { throw "Missing delivery folder: $folder" }
  # Do not replace the old binary while the user may have an unsaved draft open.
  $binary=Join-Path $folder 'Graybox-0.4.2-gui.exe'
  if (-not (Test-Path -LiteralPath $binary) -or (Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $binary).Hash) {
    Copy-Item -LiteralPath $source -Destination $binary -Force
  }
  $launcher=Join-Path $folder 'Start-Graybox.vbs'
  if ($mode -eq 'cloud') {
    $script=@'
Option Explicit
Dim shell, files, folder, environment
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
Set environment = shell.Environment("Process")
environment.Remove "GRAYBOX_CREDENTIALS_PATH"
environment.Remove "GRAYBOX_ENVIRONMENT_ID"
environment("GRAYBOX_SERVER_URL") = "https://api.qingsuworks.top:8443"
shell.CurrentDirectory = folder
shell.Run Chr(34) & folder & "\Graybox-0.4.2-gui.exe" & Chr(34), 1, False
'@
  } else {
    $script=@'
Option Explicit
Dim shell, files, folder, repo, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
repo = files.GetAbsolutePathName(folder & "\..\..\graybox")
command = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & repo & "\scripts\start-local.ps1" & Chr(34) & " -Executable " & Chr(34) & folder & "\Graybox-0.4.2-gui.exe" & Chr(34)
result = shell.Run(command, 0, True)
If result <> 0 Then MsgBox "Graybox could not start. Run Start-Graybox.cmd in this folder for diagnostics.", 16, "Graybox"
'@
  }
  [IO.File]::WriteAllText($launcher,$script,[Text.Encoding]::Unicode)
  if ($mode -eq 'cloud') {
    $instructions=@'
Graybox 0.4.2 云端桌面客户端

日常启动：双击 Start-Graybox.vbs（没有命令窗口）。
本机桌面的 Graybox 快捷方式也指向这个入口。
用原云端账号登录；服务器是 https://api.qingsuworks.top:8443。
无需在自己的电脑运行数据库或 API。服务器独立运行，电脑关闭不会影响其他成员。
Start-Graybox.cmd 仅供排查启动故障，会显示命令窗口。
需要 Microsoft Edge WebView2 Runtime。朋友的真实设备仍待验证。
'@
    [IO.File]::WriteAllText((Join-Path $folder '使用说明.txt'),$instructions,[Text.Encoding]::UTF8)
  }
  # Keep the explicitly chosen command-line entrypoint for troubleshooting.
  $diagnostic=Join-Path $folder 'Start-Graybox.cmd'
  $cmd=[regex]::Replace([IO.File]::ReadAllText($diagnostic),'Graybox(?:-[0-9.]+-gui)?\.exe','Graybox-0.4.2-gui.exe')
  [IO.File]::WriteAllText($diagnostic,$cmd,[Text.Encoding]::ASCII)
  if (-not $SkipShortcuts) {
    $name=if ($mode -eq 'cloud') {'Graybox.lnk'} else {'Graybox 本地版.lnk'}
    $link=$shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) $name))
    $link.TargetPath=Join-Path $env:WINDIR 'System32/wscript.exe'
    $link.Arguments='//nologo "'+$launcher+'"'
    $link.WorkingDirectory=$folder
    $link.IconLocation=$binary+',0'
    $link.Description=if ($mode -eq 'cloud') {'Graybox 云端团队空间'} else {'Graybox 本地开发测试'}
    $link.WindowStyle=1
    $link.Save()
  }
}

