import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { ClientError } from '../../../packages/client/src/client.ts';
import { commandSchema } from '../../../packages/contracts/src/index.ts';
import { resolveContext,bindProject,initializeConfig,authStatus,activateExperiment,activateIdea,executeCommand,createProject } from '../../../packages/local-context/src/binding.ts';
import {pair,startPair,completePair} from '../../../packages/local-context/src/pairing.ts';
import { entityGet,entityList,collaborationGet,activityList,batchUndo,projectChildren,tagList } from '../../mcp/src/tools.ts';
import { syncStatus,syncPrepare,syncExecute } from '../../../packages/local-context/src/sync.ts';

export const help={
  usage:'node runtime/client.mjs <command> [options] (source: pnpm cli <command>)',
  commands:['auth list [--credentials ABS]','auth status','auth pair|pair-start --endpoint HTTPS --name NAME --config ABS','auth pair-complete --config ABS [--replace]','auth init --credentials ABS --agent-id UUID [--endpoint http://127.0.0.1:4318] [--replace]','project bind --cwd ABS --input binding.json [--replace]','project get --cwd ABS','project create --cwd ABS --input command.json [--environment-id UUID for an unbound cwd]','project update --cwd ABS --input command.json','status|context --cwd ABS [--git]','experiment get --cwd ABS [--id UUID]','experiment create|update --cwd ABS --input command.json','experiment activate --cwd ABS --id UUID','experiment clear --cwd ABS','evidence append --cwd ABS --input command.json','review submit --cwd ABS --input command.json','activity list --cwd ABS [--entity-id UUID] [--batch-id UUID]','undo preview --cwd ABS --batch-id UUID','undo execute --cwd ABS --batch-id UUID --input undo.json','doctor --cwd ABS','retrospective create|list --cwd ABS [--input command.json]','comment create|list --cwd ABS [--input command.json]','tag list --cwd ABS [--q TEXT]','mcp serve','idea get|list|activate|clear --cwd ABS [--id UUID] [--unlinked]','idea create|update --cwd ABS --input command.json','collaboration get --cwd ABS --input target.json','command execute --cwd ABS --input command.json','sync status --cwd ABS','sync prepare --cwd ABS --input prepared.json','sync execute --cwd ABS --id OPERATION_UUID'],
  input:'Mutation input files contain the exact shared API command envelope, including type, caller supplied stable UUID idempotency_key/batch_id and expected_revision for updates. No generated retry key. Undo execution input has preview_token, expected_batch_revision and idempotency_key.',
  trusted_config:'GRAYBOX_CLIENT_CONFIG must be an absolute trusted personal config path; source checkout defaults to .local/client.json; portable pairing uses --config; ordinary portable commands and MCP require GRAYBOX_CLIENT_CONFIG (setup supplies it). Project binding files never select endpoint or credentials.'
};
function parseArgs(args:string[]){const positional:string[]=[],options:Record<string,string|true>={};const flags=new Set(['replace','git','help','unlinked']);const values=new Set(['cwd','input','credentials','agent-id','endpoint','environment-id','id','entity-id','batch-id','name','config','q']);for(let index=0;index<args.length;index++){const value=args[index]!;if(!value.startsWith('--')){positional.push(value);continue;}const key=value.slice(2);if(Object.hasOwn(options,key))throw new ClientError('VALIDATION','Duplicate CLI option');if(flags.has(key))options[key]=true;else if(values.has(key)){const next=args[++index];if(!next||next.startsWith('--'))throw new ClientError('VALIDATION','CLI option requires a value');options[key]=next;}else throw new ClientError('VALIDATION','Unknown CLI option');}return {positional,options};}
function value(options:Record<string,string|true>,key:string,required=true){const result=options[key];if(typeof result!=='string'){if(required)throw new ClientError('VALIDATION','Missing required --'+key+' option');return undefined;}return result;}
async function input(path:string){try{const text=await readFile(path,'utf8');if(text.length>256*1024)throw new Error();return JSON.parse(text) as unknown;}catch{throw new ClientError('INPUT_INVALID','Input file must contain bounded valid JSON');}}
export async function runCli(args:string[]):Promise<unknown>{
  const {positional,options}=parseArgs(args),[group,action]=positional;if(!group||group==='help'||options.help===true)return help;
  if(positional.length>2)throw new ClientError('VALIDATION','Unexpected positional arguments');
  if(group==='mcp'&&action==='serve'){await (await import('../../mcp/src/server.ts')).serve();return undefined;}
  if(group==='auth'){
    if(action==='pair-start')return startPair({endpoint:value(options,'endpoint')!,name:value(options,'name')!,configPath:value(options,'config',false)});
    if(action==='pair-complete')return completePair({configPath:value(options,'config',false),replace:options.replace===true});
    if(action==='pair'){const controller=new AbortController(),interrupt=()=>controller.abort();process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);try{return await pair({endpoint:value(options,'endpoint')!,name:value(options,'name')!,configPath:value(options,'config',false),replace:options.replace===true,signal:controller.signal,onStart:result=>process.stderr.write(JSON.stringify(result)+'\n')});}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}}
    if(action==='status')return authStatus();
    if(action==='list'){const path=value(options,'credentials',false)??fileURLToPath(new URL('../../../.local/credentials.json',import.meta.url));if(!isAbsolute(path))throw new ClientError('CONFIG_INVALID','Credential file path must be absolute');const data=await input(path);const parsed=z.object({mode:z.literal('local-demonstration-only'),workspace_id:z.uuid(),agents:z.array(z.object({id:z.uuid(),human_id:z.uuid(),name:z.string()}))}).safeParse(data);if(!parsed.success)throw new ClientError('CREDENTIAL_INVALID','Local seed agent identities are invalid');return {workspace_id:parsed.data.workspace_id,agents:parsed.data.agents};}
    if(action==='init')return initializeConfig({credentials_file:value(options,'credentials')!,agent_id:value(options,'agent-id')!,endpoint:value(options,'endpoint',false)??'http://127.0.0.1:4318',replace:options.replace===true});
    throw new ClientError('VALIDATION','Unknown auth action');
  }
  const cwd=value(options,'cwd')!;
  if(group==='sync'&&action==='status')return syncStatus({cwd});
  if(group==='sync'&&action==='prepare'){const body=z.strictObject({operation_id:z.uuid(),through:z.string().min(1).max(4000),command:commandSchema}).parse(await input(value(options,'input')!));return syncPrepare({cwd},body);}
  if(group==='sync'&&action==='execute')return syncExecute({cwd},value(options,'id')!);
  if(group==='command'&&action==='execute')return executeCommand({cwd},await input(value(options,'input')!));
  if(group==='idea'&&action==='get')return entityGet(cwd,'idea',value(options,'id',false));
  if(group==='idea'&&(action==='activate'||action==='clear'))return activateIdea({cwd,idea_id:action==='clear'?null:value(options,'id')!});
  if((group==='idea'||group==='experiment')&&action==='list')return entityList(cwd,group,options.unlinked===true);
  if(group==='collaboration'&&action==='get'){const body=z.strictObject({entity_type:z.enum(['idea','experiment']),id:z.uuid()}).parse(await input(value(options,'input')!));return collaborationGet(cwd,body.entity_type,body.id);}
  if(group==='project'&&action==='bind')return bindProject({cwd,binding:await input(value(options,'input')!) as Parameters<typeof bindProject>[0]['binding'],replace:options.replace===true});
  if(['status','context','doctor'].includes(group)&&!action){const ctx=await resolveContext({cwd,includeGit:options.git===true});return group==='doctor'?{healthy:true,environment_id:ctx.binding.environment_id,agent:ctx.identity,paths:ctx.paths,checks:['trusted '+(ctx.environment.mode??'local')+' endpoint','persistent environment UUID','distinct agent identity','project workspace','active experiment ownership']}:ctx.safe;}
  if(group==='project'&&action==='get')return entityGet(cwd,'project',value(options,'id',false));
  if(group==='experiment'&&action==='get')return entityGet(cwd,'experiment',value(options,'id',false));
  if(group==='experiment'&&(action==='activate'||action==='clear'))return activateExperiment({cwd,experiment_id:action==='clear'?null:value(options,'id')!});
  if((group==='retrospective'||group==='comment')&&action==='list')return projectChildren(cwd,group==='retrospective'?'retrospectives':'comments');
  if(group==='tag'&&action==='list')return tagList(cwd,value(options,'q',false));
  if(group==='activity'&&action==='list')return activityList(cwd,{entity_id:value(options,'entity-id',false),batch_id:value(options,'batch-id',false)});
  if(group==='undo'&&(action==='preview'||action==='execute')){const body=action==='execute'?await input(value(options,'input')!):{};const parsed=z.strictObject({expected_batch_revision:z.number().int().positive(),preview_token:z.string().min(1),idempotency_key:z.uuid()}).partial().safeParse(body);if(!parsed.success)throw new ClientError('VALIDATION','Invalid undo input');return batchUndo(cwd,{...parsed.data,action,batch_id:value(options,'batch-id')!});}
  const type=({ 'idea create':'idea_create','idea update':'idea_update','entity join':'entity_join','entity branch':'entity_branch','entity comment':'entity_comment','merge submit':'merge_submit','merge resolve':'merge_resolve','project create':'project_create','project update':'project_update','experiment create':'experiment_create','experiment update':'experiment_update','evidence append':'evidence_append','review submit':'review_submit','retrospective create':'retrospective_create','comment create':'comment_create'} as Record<string,string>)[group+' '+action];
  if(!type)throw new ClientError('VALIDATION','Unknown CLI command; use help');
  const body=await input(value(options,'input')!),parsed=commandSchema.safeParse(body);if(!parsed.success||parsed.data.type!==type)throw new ClientError('VALIDATION','Input command must match the selected action and shared contract');
  if(type==='project_create'&&options['environment-id'])return createProject({cwd,environment_id:value(options,'environment-id')!},parsed.data);
  return executeCommand({cwd},parsed.data);
}
