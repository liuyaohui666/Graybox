import {mkdir,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const executable=process.argv[2];
if(!executable||!isAbsolute(executable))throw new Error('Provide the absolute path to the current Windows GUI executable');
const exe=await readFile(executable),pe=exe.readUInt32LE(0x3c);
if(exe.toString('ascii',0,2)!=='MZ'||exe.toString('ascii',pe,pe+4)!=='PE\0\0'||exe.readUInt16LE(pe+24+68)!==2)throw new Error('Expected a Windows GUI executable');
const output=resolve(root,'.local',`friend-release-${version}-${Date.now()}`,'Graybox');
await mkdir(output,{recursive:true});
for(const name of ['runtime','skills','config.toml.example','安装说明.md'])await cp(join(root,'.local/client-release',name),join(output,name),{recursive:true});
await cp(join(root,'README.md'),join(output,'README.md'));
for(const name of ['manual-refresh.md','skill-agent-live-check.md']){await mkdir(join(output,'docs'),{recursive:true});await cp(join(root,'docs',name),join(output,'docs',name));}
await mkdir(join(output,'ops/cloud'),{recursive:true});await cp(join(root,'ops/cloud/README.md'),join(output,'ops/cloud/README.md'));
const binary=`Graybox-${version}-gui.exe`;
await writeFile(join(output,binary),exe);
await writeFile(join(output,'Start-Graybox.vbs'),`Option Explicit\r\nDim shell, files, folder, environment\r\nSet shell = CreateObject("WScript.Shell")\r\nSet files = CreateObject("Scripting.FileSystemObject")\r\nfolder = files.GetParentFolderName(WScript.ScriptFullName)\r\nSet environment = shell.Environment("Process")\r\nenvironment.Remove "GRAYBOX_CREDENTIALS_PATH"\r\nenvironment.Remove "GRAYBOX_ENVIRONMENT_ID"\r\nenvironment("GRAYBOX_SERVER_URL") = "https://api.qingsuworks.top:8443"\r\nshell.CurrentDirectory = folder\r\nshell.Run Chr(34) & folder & "\\${binary}" & Chr(34), 1, False\r\n`,'ascii');
await writeFile(join(output,'Start-Graybox.cmd'),`@echo off\r\nset GRAYBOX_CREDENTIALS_PATH=\r\nset GRAYBOX_ENVIRONMENT_ID=\r\nset GRAYBOX_SERVER_URL=https://api.qingsuworks.top:8443\r\n"%~dp0${binary}"\r\n`,'ascii');
await writeFile(join(output,'Create-Desktop-Shortcut.vbs'),`Option Explicit\r\nDim shell, files, folder, link\r\nSet shell = CreateObject("WScript.Shell")\r\nSet files = CreateObject("Scripting.FileSystemObject")\r\nfolder = files.GetParentFolderName(WScript.ScriptFullName)\r\nSet link = shell.CreateShortcut(shell.SpecialFolders("Desktop") & "\\Graybox.lnk")\r\nlink.TargetPath = shell.ExpandEnvironmentStrings("%WINDIR%") & "\\System32\\wscript.exe"\r\nlink.Arguments = "//nologo " & Chr(34) & folder & "\\Start-Graybox.vbs" & Chr(34)\r\nlink.WorkingDirectory = folder\r\nlink.IconLocation = folder & "\\${binary},0"\r\nlink.Save\r\n`,'ascii');
const hashes={};
async function walk(directory){for(const item of await readdir(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory())await walk(path);else hashes[relative(output,path).replaceAll('\\','/')]=createHash('sha256').update(await readFile(path)).digest('hex');}}
await walk(output);
await writeFile(join(output,'release.json'),JSON.stringify({product:'Graybox',version,node:'24',platform:'windows-x64',files_sha256:hashes},null,2)+'\n');
console.log(output);
