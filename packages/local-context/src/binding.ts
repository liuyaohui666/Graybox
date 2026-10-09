import { readFile, realpath, stat, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, isAbsolute, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiClient, ClientError, localEndpoint, cloudEndpoint } from '../../client/src/client.ts';
import { commandSchema } from '../../contracts/src/index.ts';
import { gitRoot, gitValue, gitMetadata } from './git.ts';

export const defaultConfigPath=fileURLToPath(new URL('../../../.local/client.json',import.meta.url));
const bindingSchema=z.strictObject({version:z.literal(1),environment_id:z.uuid(),workspace_id:z.uuid(),project_id:z.uuid()});
const localSchema=z.strictObject({version:z.literal(1),active_experiment_id:z.uuid().nullable(),active_idea_id:z.uuid().nullable().optional()});
const environmentSchema=z.strictObject({environment_id:z.uuid(),endpoint:z.string(),credentials_file:z.string(),agent_id:z.uuid(),mode:z.enum(['local','cloud']).optional()});
const configSchema=z.strictObject({version:z.literal(1),environments:z.array(environmentSchema).min(1)});
const agentSchema=z.object({id:z.uuid(),human_id:z.uuid(),name:z.string(),token:z.string().min(1),project_ids:z.array(z.uuid()).nullable()});
const credentialsSchema=z.object({mode:z.literal('local-demonstration-only'),workspace_id:z.uuid(),agents:z.array(agentSchema)});
export const cloudCredentialsSchema=z.strictObject({mode:z.literal('cloud-agent'),environment_id:z.uuid(),workspace_id:z.uuid(),expires_at:z.iso.datetime(),agent:agentSchema});
export type Binding=z.infer<typeof bindingSchema>;
type Environment=z.infer<typeof environmentSchema>;
export type ContextOptions={cwd:string;configPath?:string;includeGit?:boolean};
function fail(code:string,message:string):never{throw new ClientError(code,message);}
async function exists(path:string){try{await stat(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw new ClientError('PATH_INVALID','Local context path is not readable');}}
async function json(path:string,code:string){try{const value=await readFile(path,'utf8');if(value.length>512*1024)throw new Error();return JSON.parse(value) as unknown;}catch{fail(code,'Required local JSON is missing, unreadable or invalid');}}
function parse<T>(schema:z.ZodType<T>,value:unknown,code:string):T{const result=schema.safeParse(value);if(!result.success)fail(code,'Local configuration violates its strict versioned schema');return result.data;}
export function configFile(explicit?:string){const path=explicit??process.env.GRAYBOX_CLIENT_CONFIG??defaultConfigPath;if(!isAbsolute(path))fail('CONFIG_INVALID','Trusted client config path must be absolute');return resolve(path);}
export async function readConfig(explicit?:string){
  const path=configFile(explicit),config=parse(configSchema,await json(path,'CONFIG_INVALID'),'CONFIG_INVALID');const ids=new Set<string>();
  for(const environment of config.environments){if(ids.has(environment.environment_id))fail('CONFIG_AMBIGUOUS','Multiple mappings exist for one environment UUID');ids.add(environment.environment_id);(environment.mode==='cloud'?cloudEndpoint:localEndpoint)(environment.endpoint);if(!isAbsolute(environment.credentials_file))fail('CONFIG_INVALID','Trusted credential file path must be absolute');}
  if(config.environments.some(e=>e.mode==='cloud')){if(await gitRoot(dirname(await realpath(path))))fail('CONFIG_INVALID','Cloud trusted config must be outside repositories');for(const e of config.environments.filter(e=>e.mode==='cloud'))if(await gitRoot(dirname(await realpath(e.credentials_file))))fail('CONFIG_INVALID','Cloud credentials must be outside repositories');}
  return {path,config};
}
async function cwdPath(cwd:string){if(!cwd||!isAbsolute(cwd))fail('CWD_REQUIRED','An explicit absolute cwd is required');try{const path=await realpath(cwd);if(!(await stat(path)).isDirectory())throw new Error();return resolve(path);}catch{fail('CWD_INVALID','Explicit cwd must name an existing readable directory');}}
async function contextDirectory(root:string){
  const directory=join(root,'.graybox');if(!await exists(directory))return;
  const target=resolve(await realpath(directory)),within=relative(root,target);if(within==='..'||within.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(within))fail('CONTEXT_PATH_INVALID','Repository context directory must remain within the explicit project root');
}
async function privateAgent(environment:Environment){if(environment.mode==='cloud'){const credentials=parse(cloudCredentialsSchema,await json(environment.credentials_file,'CREDENTIAL_INVALID'),'CREDENTIAL_INVALID');if(credentials.environment_id!==environment.environment_id||credentials.agent.id!==environment.agent_id||Date.parse(credentials.expires_at)<=Date.now())fail('AGENT_REQUIRED','Cloud agent credential expired or mismatched');return {agent:credentials.agent,workspace_id:credentials.workspace_id};}const credentials=parse(credentialsSchema,await json(environment.credentials_file,'CREDENTIAL_INVALID'),'CREDENTIAL_INVALID');const agents=credentials.agents.filter(agent=>agent.id===environment.agent_id);if(agents.length!==1)fail('AGENT_REQUIRED','Select exactly one seeded local agent identity');return {agent:agents[0]!,workspace_id:credentials.workspace_id};}
export async function environmentClient(environmentId:string,explicit?:string){
  const {path,config}=await readConfig(explicit),environment=config.environments.find(e=>e.environment_id===environmentId);if(!environment)fail('ENVIRONMENT_UNMAPPED','Bound environment has no trusted personal mapping');
  const {agent,workspace_id}=await privateAgent(environment),api=new ApiClient({endpoint:environment.endpoint,token:agent.token,mode:environment.mode});const health=await api.health();
  if(health.mode!==(environment.mode??'local')||health.environment_id!==environmentId)fail('ENVIRONMENT_MISMATCH','API environment UUID does not match the trusted mapping');
  const identity=await api.me();if(identity.agent_id!==environment.agent_id||identity.human_id!==agent.human_id)fail('AGENT_MISMATCH','Server agent identity does not match the selected local agent');
  if(environment.mode==='cloud'){const workspaces=await api.workspaces();if(!workspaces.some(w=>w.id===workspace_id))fail('WORKSPACE_MISMATCH','Paired workspace is not accessible');}
  return {api,identity,environment,workspace_id,config_path:path};
}
async function discover(cwd:string){
  const rawRoot=await gitRoot(cwd),root=rawRoot?resolve(await realpath(rawRoot)):null;const found:Array<{root:string;path:string;binding:Binding}>=[];
  for(let current=cwd;;current=dirname(current)){
    const path=join(current,'.graybox','project.json');if(await exists(path)){await contextDirectory(current);found.push({root:current,path,binding:parse(bindingSchema,await json(path,'BINDING_INVALID'),'BINDING_INVALID')});}
    if(current===root||dirname(current)===current)break;
  }
  if(!found.length)fail('BINDING_MISSING','No .graybox/project.json binding exists within the explicit project context');
  if(found.some(value=>JSON.stringify(value.binding)!==JSON.stringify(found[0]!.binding)))fail('BINDING_AMBIGUOUS','Conflicting ancestor bindings; resolve ambiguity before selecting a project');
  return found[0]!;
}
async function resolveContextInternal(options:ContextOptions,ignoreActive=false){
  const cwd=await cwdPath(options.cwd),discovery=await discover(cwd),trusted=await environmentClient(discovery.binding.environment_id,options.configPath),project=await trusted.api.project(discovery.binding.project_id);
  if(project.workspace_id!==discovery.binding.workspace_id||trusted.workspace_id!==discovery.binding.workspace_id)fail('WORKSPACE_MISMATCH','Binding project and selected local credentials must belong to the bound workspace');
  const localPath=join(discovery.root,'.graybox','local.json');const local=!ignoreActive&&await exists(localPath)?parse(localSchema,await json(localPath,'LOCAL_CONTEXT_INVALID'),'LOCAL_CONTEXT_INVALID'):null;
  const active=local?.active_experiment_id?await trusted.api.experiment(local.active_experiment_id):null;
  if(active&&active.project_id!==project.id)fail('EXPERIMENT_MISMATCH','Active experiment belongs to another project');
  const activeIdea=local?.active_idea_id?await trusted.api.idea(local.active_idea_id):null;
  if(activeIdea?.project_id&&activeIdea.project_id!==project.id)fail('PROJECT_MISMATCH','Active idea belongs to another project');
  if(activeIdea&&activeIdea.workspace_id!==discovery.binding.workspace_id)fail('WORKSPACE_MISMATCH','Active idea belongs to another workspace');
  const paths={cwd,project_root:discovery.root,binding_file:discovery.path,local_context_file:localPath};
  const safe={...discovery.binding,agent:trusted.identity,paths,project,active_experiment:active,active_idea:activeIdea,git:options.includeGit?await gitMetadata(cwd):undefined};
  return {...trusted,binding:discovery.binding,project,active_experiment:active,active_idea:activeIdea,paths,safe};
}
export async function resolveContext(options:ContextOptions){return resolveContextInternal(options);}
export async function undoExecutionContext(options:ContextOptions,batchId:string){
  // An exact undo replay must survive deletion of the bound project or active
  // experiment. This narrow path uses immutable, authenticated batch activity;
  // normal context reads/writes continue requiring live project/experiment state.
  const cwd=await cwdPath(options.cwd),discovery=await discover(cwd),binding=discovery.binding,trusted=await environmentClient(binding.environment_id,options.configPath);
  if(trusted.workspace_id!==binding.workspace_id)fail('WORKSPACE_MISMATCH','Binding workspace differs from selected local credentials');
  let project:null|Awaited<ReturnType<ApiClient['project']>>=null;
  try{project=await trusted.api.project(binding.project_id);}catch(error){if(!(error instanceof ClientError)||error.code!=='NOT_FOUND')throw error;}
  if(project&&project.workspace_id!==binding.workspace_id)fail('WORKSPACE_MISMATCH','Bound project differs from the selected workspace');
  const activity=await trusted.api.activity({batch_id:batchId});if(!activity.length)throw new ClientError('NOT_FOUND','Batch is missing or inaccessible',404);
  if(activity.some(item=>item.project_id!==binding.project_id))fail('PROJECT_MISMATCH','Batch contains changes outside the explicit project binding');
  if(!project){
    const projectProof=activity.some(item=>{const after=item.after as Record<string,unknown>|null;return item.entity_type==='project'&&item.entity_id===binding.project_id&&after?.id===binding.project_id&&after.workspace_id===binding.workspace_id;});
    if(!projectProof)throw new ClientError('NOT_FOUND','Live project or immutable workspace proof is required for undo execution',404);
  }
  return {...trusted,binding};
}
async function atomicJson(path:string,value:unknown,replace:boolean){
  await mkdir(dirname(path),{recursive:true});if(!replace){try{await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});return;}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')fail('CONFIG_EXISTS','Existing local configuration requires explicit replace');throw error;}}
  const temp=path+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,path);}finally{await rm(temp,{force:true});}
}
async function excludeLocal(root:string){
  const git=await gitRoot(root);let path:string,pattern:string;
  if(git){const exclude=await gitValue(root,['rev-parse','--git-path','info/exclude']);if(!exclude)fail('IGNORE_FAILED','Cannot locate Git local excludes');path=resolve(root,exclude);pattern=(relative(git,root).replaceAll('\\','/')+'/').replace(/^\//,'')+'.graybox/local.json';}
  else{path=join(root,'.gitignore');pattern='.graybox/local.json';if(await exists(path)){const actual=resolve(await realpath(path)),within=relative(root,actual);if(within==='..'||within.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(within))fail('CONTEXT_PATH_INVALID','Local ignore file must remain within the project root');}}
  const before=await exists(path)?await readFile(path,'utf8'):'';if(!before.split(/\r?\n/).includes(pattern)){await mkdir(dirname(path),{recursive:true});await writeFile(path,before+(before&&!before.endsWith('\n')?'\n':'')+pattern+'\n');}
}
export async function bindProject(options:ContextOptions&{binding:Binding;replace?:boolean}){
  const cwd=await cwdPath(options.cwd),binding=parse(bindingSchema,options.binding,'BINDING_INVALID'),path=join(cwd,'.graybox/project.json');
  await contextDirectory(cwd);
  const before=await exists(path)?parse(bindingSchema,await json(path,'BINDING_INVALID'),'BINDING_INVALID'):null;
  if(before&&JSON.stringify(before)!==JSON.stringify(binding)&&!options.replace)fail('BINDING_EXISTS','Different binding exists; explicit replace is required');
  const trusted=await environmentClient(binding.environment_id,options.configPath),project=await trusted.api.project(binding.project_id);
  if(project.workspace_id!==binding.workspace_id||trusted.workspace_id!==binding.workspace_id)fail('WORKSPACE_MISMATCH','Existing project does not belong to the selected workspace');
  await excludeLocal(cwd);await atomicJson(path,binding,!!before);return {binding,paths:{project_root:cwd,binding_file:path}};
}
export async function activateExperiment(options:ContextOptions&{experiment_id:string|null}){
  const ctx=await resolveContextInternal(options,true);if(options.experiment_id){const experiment=await ctx.api.experiment(options.experiment_id);if(experiment.project_id!==ctx.project.id)fail('EXPERIMENT_MISMATCH','Selected experiment belongs to another project');}
  await contextDirectory(ctx.paths.project_root);
  await excludeLocal(ctx.paths.project_root);await atomicJson(ctx.paths.local_context_file,{version:1,active_experiment_id:options.experiment_id},true);return {active_experiment_id:options.experiment_id};
}
export async function activateIdea(options:ContextOptions&{idea_id:string|null}){
  const ctx=await resolveContextInternal(options,true);if(options.idea_id){const idea=await ctx.api.idea(options.idea_id);if(idea.project_id&&idea.project_id!==ctx.project.id)fail('PROJECT_MISMATCH','Selected idea belongs to another project');if(idea.workspace_id!==ctx.binding.workspace_id)fail('WORKSPACE_MISMATCH','Selected idea belongs to another workspace');}
  await contextDirectory(ctx.paths.project_root);await excludeLocal(ctx.paths.project_root);
  await atomicJson(ctx.paths.local_context_file,{version:1,active_experiment_id:null,active_idea_id:options.idea_id},true);return {active_idea_id:options.idea_id};
}
export async function initializeConfig(options:{configPath?:string;credentials_file:string;endpoint:string;agent_id:string;replace?:boolean}){
  if(!isAbsolute(options.credentials_file))fail('CONFIG_INVALID','Credential file path must be absolute');const path=configFile(options.configPath),endpoint=localEndpoint(options.endpoint),credentials=parse(credentialsSchema,await json(options.credentials_file,'CREDENTIAL_INVALID'),'CREDENTIAL_INVALID');
  const selected=credentials.agents.filter(a=>a.id===options.agent_id);if(selected.length!==1)fail('AGENT_REQUIRED','Select exactly one seeded agent UUID');
  const api=new ApiClient({endpoint,token:selected[0]!.token}),health=await api.health(),identity=await api.me();
  if(health.mode!=='local'||!z.uuid().safeParse(health.environment_id).success)fail('ENVIRONMENT_MISMATCH','API does not identify a local persistent environment');
  if(identity.agent_id!==options.agent_id||identity.human_id!==selected[0]!.human_id)fail('AGENT_MISMATCH','Selected seeded agent does not match API identity');
  const environment={environment_id:health.environment_id,endpoint,credentials_file:resolve(options.credentials_file),agent_id:options.agent_id};
  let environments:Environment[]=[];if(await exists(path)){environments=(await readConfig(path)).config.environments;const existing=environments.find(e=>e.environment_id===environment.environment_id);if(existing&&!options.replace)fail('CONFIG_EXISTS','Environment is already mapped; explicit replace is required');environments=environments.filter(e=>e.environment_id!==environment.environment_id);}
  await atomicJson(path,{version:1,environments:[...environments,environment]},environments.length>0||await exists(path));return {environment_id:health.environment_id,agent:identity,config_path:path};
}
export async function authStatus(explicit?:string){const {config}=await readConfig(explicit);const result=[];for(const e of config.environments){const trusted=await environmentClient(e.environment_id,explicit);result.push({environment_id:e.environment_id,workspace_id:trusted.workspace_id,endpoint:e.endpoint,agent:trusted.identity});}return result;}
export async function createProject(options:ContextOptions&{environment_id:string},body:unknown){
  const parsed=commandSchema.safeParse(body);if(!parsed.success||parsed.data.type!=='project_create')fail('VALIDATION','Project creation requires exact shared command contract');
  const cwd=await cwdPath(options.cwd);let binding:Binding|null=null;
  try{binding=(await discover(cwd)).binding;}catch(error){if(!(error instanceof ClientError)||error.code!=='BINDING_MISSING')throw error;}
  if(binding){if(binding.environment_id!==options.environment_id)fail('ENVIRONMENT_MISMATCH','Explicit environment conflicts with the existing project binding');return executeCommand(options,parsed.data);}
  const trusted=await environmentClient(options.environment_id,options.configPath);if(parsed.data.payload.workspace_id!==trusted.workspace_id)fail('WORKSPACE_MISMATCH','Create workspace differs from trusted credentials');return trusted.api.command(parsed.data);
}
export async function executeCommand(options:ContextOptions,body:unknown){
  const parsed=commandSchema.safeParse(body);if(!parsed.success)fail('VALIDATION','Command violates shared contract; explicit stable UUID keys and revisions are required');const command=parsed.data,ctx=await resolveContext(options);
  if(command.type==='project_create'){if(command.payload.workspace_id!==ctx.binding.workspace_id)fail('WORKSPACE_MISMATCH','Command targets another workspace');}
  else if(command.type==='project_update'){if(command.payload.id!==ctx.project.id)fail('PROJECT_MISMATCH','Command targets another project');}
  else if(command.type==='experiment_create'||command.type==='retrospective_create'||command.type==='comment_create'){if(command.payload.project_id!==ctx.project.id)fail('PROJECT_MISMATCH','Command targets another project');}
  else if(command.type==='idea_create'){if(command.payload.workspace_id&&command.payload.workspace_id!==ctx.binding.workspace_id)fail('WORKSPACE_MISMATCH','Idea targets another workspace');if(command.payload.project_id&&command.payload.project_id!==ctx.project.id)fail('PROJECT_MISMATCH','Idea targets another project');}
  else if(command.type==='idea_update'){
    const idea=await ctx.api.idea(command.payload.id);if(idea.project_id&&idea.project_id!==ctx.project.id)fail('PROJECT_MISMATCH','Idea belongs to another project');if(idea.workspace_id!==ctx.binding.workspace_id)fail('WORKSPACE_MISMATCH','Idea belongs to another workspace');
    if(command.payload.project_id&&command.payload.project_id!==ctx.project.id)fail('PROJECT_MISMATCH','Idea association targets another project');
  }
  else if(command.type==='entity_join'||command.type==='entity_branch'||command.type==='entity_comment'||command.type==='entity_agree'||command.type==='merge_submit'){
    const target=command.payload.entity_type==='idea'?await ctx.api.idea(command.payload.entity_id):await ctx.api.experiment(command.payload.entity_id);
    if(target.project_id&&target.project_id!==ctx.project.id)fail('PROJECT_MISMATCH','Collaboration target belongs to another project');
    if(command.payload.entity_type==='idea'&&target.workspace_id!==ctx.binding.workspace_id)fail('WORKSPACE_MISMATCH','Idea belongs to another workspace');
  }
  else if(command.type==='merge_resolve'){
    const request=await ctx.api.mergeRequest(command.payload.id);if(request.workspace_id!==ctx.binding.workspace_id)fail('WORKSPACE_MISMATCH','Merge request targets another workspace');
    const independent=request.target_project_id===null&&ctx.active_idea?.id===request.target_id&&ctx.active_idea?.project_id===null;
    if(!independent&&request.target_project_id!==ctx.project.id)fail('PROJECT_MISMATCH','Live merge target differs from the explicit project or independent idea binding');
    if(request.source_project_id!==ctx.project.id&&!(independent&&request.source_project_id===null))fail('PROJECT_MISMATCH','Live merge source differs from the explicit collaboration context');
  }
  else{const experiment=await ctx.api.experiment(command.type==='experiment_update'?command.payload.id:command.payload.experiment_id);if(experiment.project_id!==ctx.project.id)fail('EXPERIMENT_MISMATCH','Command targets another project experiment');}
  return ctx.api.command(command);
}
