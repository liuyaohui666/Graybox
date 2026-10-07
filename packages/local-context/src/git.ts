import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
const execute=promisify(execFile);
export async function gitValue(cwd:string,args:string[]):Promise<string|null>{
  try{const {stdout}=await execute('git',['-c','core.fsmonitor=false',...args],{cwd,encoding:'utf8',timeout:2500,maxBuffer:64*1024,windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'}});return stdout.trim();}catch{return null;}
}
export async function gitRoot(cwd:string){const value=await gitValue(cwd,['rev-parse','--show-toplevel']);return value?isAbsolute(value)?resolve(value):resolve(cwd,value):null;}
export async function gitMetadata(cwd:string){
  const root=await gitRoot(cwd);if(!root)return null;
  // Worktree-content status/diff can execute repository clean filters. Collect only
  // reference metadata; no content scan, index refresh, filters, or submodule traversal.
  const [branch,head]=await Promise.all([gitValue(cwd,['branch','--show-current']),gitValue(cwd,['rev-parse','HEAD'])]);
  return {root,branch:branch||null,head:head||null};
}
