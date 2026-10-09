import {createRequire} from 'node:module';
import {mkdir,cp,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),out=resolve(root,'.local/client-release');
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
// Only this generated, fixed client subtree is replaced; whitelist source artifacts.
if(out!==resolve(root,'.local/client-release'))throw new Error('Unexpected client output');
await rm(out,{recursive:true,force:true});await mkdir(resolve(out,'runtime'),{recursive:true});
await build({entryPoints:[resolve(root,'apps/cli/src/main.ts')],outfile:resolve(out,'runtime/client.mjs'),bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"},logLevel:'warning'});
await cp(resolve(root,'skills/graybox'),resolve(out,'skills/graybox'),{recursive:true});
await build({entryPoints:[resolve(root,'scripts/list-projects.ts')],outfile:resolve(out,'runtime/list-projects.mjs'),bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"},logLevel:'warning'});
await cp(resolve(root,'skills/graybox/config.toml.example'),resolve(out,'config.toml.example'));
await cp(resolve(root,'skills/graybox/references/setup.md'),resolve(out,'安装说明.md'));
const hash=createHash('sha256').update(await readFile(resolve(out,'runtime/client.mjs'))).digest('hex');
const version=JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version;
await writeFile(resolve(out,'release.json'),JSON.stringify({product:'Graybox',version,node:'24',client_sha256:hash},null,2)+'\n');
console.log(out);
