import { runCli } from './commands.ts';
import { safeError } from '../../../packages/client/src/client.ts';
runCli(process.argv.slice(2)).then(result=>{if(result!==undefined)process.stdout.write(JSON.stringify({data:result})+'\n');}).catch(error=>{process.stdout.write(JSON.stringify(safeError(error))+'\n');process.exitCode=1;});
