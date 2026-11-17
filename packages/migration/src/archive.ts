import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { backupDatabase, openLocalDatabase, assertDatabaseFile, localDataStats } from '../../local-db/src/index.ts';

const execFileAsync=promisify(execFile);
const FORMAT_VERSION=1;
type ManifestFile={path:string;sha256:string;size:number};
export type ArchiveManifest={format_version:1;created_at:string;database:ManifestFile;files:ManifestFile[];stats:Record<string,number>};

async function digest(path:string):Promise<ManifestFile>{const data=await readFile(path);return {path:'',sha256:createHash('sha256').update(data).digest('hex'),size:data.byteLength};}
async function filesUnder(root:string,dir:string):Promise<ManifestFile[]> {const out:ManifestFile[]=[];for(const entry of await readdir(dir,{withFileTypes:true})){const abs=join(dir,entry.name);const rel=relative(root,abs).replaceAll('\\','/');if(entry.isDirectory())out.push(...await filesUnder(root,abs));else {const d=await digest(abs);out.push({...d,path:rel});}}return out;}

export async function exportArchive(dataRoot:string,target:string):Promise<ArchiveManifest>{
  const root=resolve(dataRoot),destination=resolve(target),stage=resolve(dirname(destination),`.graybox-export-${Date.now()}`);await mkdir(stage,{recursive:true});
  const db=join(root,'graybox.sqlite');await assertDatabaseFile(db);const localDb=await openLocalDatabase(root);try{await backupDatabase(localDb,join(stage,'graybox.sqlite'));}finally{localDb.close();}
  for(const dir of ['attachments','avatars']){const source=join(root,dir);try{await stat(source);await cp(source,join(stage,dir),{recursive:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  const manifest={format_version:FORMAT_VERSION,created_at:new Date().toISOString(),database:{...(await digest(join(stage,'graybox.sqlite'))),path:'graybox.sqlite'},files:[] as ManifestFile[],stats:await localDataStats(root)} as ArchiveManifest;
  for(const file of await filesUnder(stage,stage))if(file.path!=='graybox.sqlite')manifest.files.push(file);
  await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await mkdir(dirname(destination),{recursive:true});
  await execFileAsync(process.platform==='win32'?'tar.exe':'tar',['-a','-c','-f',destination,'-C',stage,'.']);await rm(stage,{recursive:true,force:true});return manifest;
}

export async function validateArchive(archive:string):Promise<ArchiveManifest>{
  const stage=resolve(dirname(archive),`.graybox-validate-${Date.now()}`);await mkdir(stage,{recursive:true});try{await execFileAsync(process.platform==='win32'?'tar.exe':'tar',['-x','-f',resolve(archive),'-C',stage]);const raw=JSON.parse(await readFile(join(stage,'manifest.json'),'utf8')) as ArchiveManifest;if(raw.format_version!==1||raw.database.path!=='graybox.sqlite')throw new Error('迁移包格式不受支持。');await assertDatabaseFile(join(stage,'graybox.sqlite'));for(const file of [raw.database,...raw.files]){if(file.path.includes('..')||file.path.startsWith('/')||file.path.includes('\\'))throw new Error('迁移包包含非法路径。');const actual=await digest(join(stage,file.path));if(actual.sha256!==file.sha256||actual.size!==file.size)throw new Error(`迁移包校验失败：${file.path}`);}return raw;}finally{await rm(stage,{recursive:true,force:true});}
}
