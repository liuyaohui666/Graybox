import {createRequire} from 'node:module';
import {mkdir,copyFile,cp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const out=resolve(root,'.local/cloud-release');
await mkdir(out,{recursive:true});
for(const [entry,name] of [['apps/api/src/main.ts','server.mjs'],['scripts/cloud-bootstrap.ts','bootstrap.mjs']]){
  await build({entryPoints:[resolve(root,entry)],outfile:resolve(out,name),bundle:true,platform:'node',target:'node24',format:'esm',external:['pg-native'],banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"},logLevel:'warning'});
}
await mkdir(resolve(out,'db'),{recursive:true});
for(const sql of ['001_m1.sql','002_cloud_auth.sql'])await copyFile(resolve(root,'db/migrations',sql),resolve(out,'db',sql));
// Only replace this script's generated web subtree; keep source and local credentials out.
const web=resolve(out,'web');
await rm(web,{recursive:true,force:true});
await cp(resolve(root,'apps/desktop/dist'),web,{recursive:true});
await cp(resolve(root,'ops/cloud'),resolve(out,'ops'),{recursive:true});
await writeFile(resolve(out,'release.json'),JSON.stringify({product:'Graybox',mode:'cloud',built_at:new Date().toISOString(),node:'24.18.0'},null,2)+'\n');
console.log(out);
