import {createRequire} from 'node:module';
import {mkdir,copyFile,cp,writeFile,rm,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const out=resolve(root,'.local/cloud-release');
// Always produce cloud assets, never package a stale local-demo dist directory.
process.env.VITE_GRAYBOX_MODE='cloud';
delete process.env.VITE_GRAYBOX_ALLOW_LOOPBACK_TEST;
const {build:buildWeb}=await import('vite');
await buildWeb({configFile:resolve(root,'apps/desktop/vite.config.ts')});
await mkdir(out,{recursive:true});
for(const [entry,name] of [['apps/api/src/main.ts','server.mjs'],['scripts/cloud-bootstrap.ts','bootstrap.mjs']]){
  await build({entryPoints:[resolve(root,entry)],outfile:resolve(out,name),bundle:true,platform:'node',target:'node24',format:'esm',external:['pg-native'],banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"},logLevel:'warning'});
}
await mkdir(resolve(out,'db'),{recursive:true});
for(const sql of ['001_m1.sql','002_cloud_auth.sql','003_project_library.sql','004_personal_avatars.sql','005_team_social.sql','006_profile_name.sql','007_collaboration.sql'])await copyFile(resolve(root,'db/migrations',sql),resolve(out,'db',sql));
// Only replace this script's generated web subtree; keep source and local credentials out.
const web=resolve(out,'web');
await rm(web,{recursive:true,force:true});
await cp(resolve(root,'apps/desktop/dist'),web,{recursive:true});
const ops=resolve(out,'ops');
if(ops!==resolve(root,'.local/cloud-release/ops'))throw new Error('Unexpected generated operations path');
await rm(ops,{recursive:true,force:true});
await cp(resolve(root,'ops/cloud'),ops,{recursive:true,filter:source=>!source.includes('__pycache__')&&!source.endsWith('.pyc')});
const backupScript=resolve(ops,'backup.sh');
await writeFile(backupScript,(await readFile(backupScript,'utf8')).replace(/\r\n/g,'\n'));
const version=JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version;
await writeFile(resolve(out,'release.json'),JSON.stringify({product:'Graybox',version,mode:'cloud',built_at:new Date().toISOString(),node:'24.18.0'},null,2)+'\n');
console.log(out);
