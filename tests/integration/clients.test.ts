import { beforeAll, beforeEach, afterEach, afterAll, describe, test, expect } from 'vitest';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,writeFile,rm,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { buildApp } from '../../apps/api/src/app.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { seedDatabase } from '../../packages/db/src/seed.ts';
import { ApiClient } from '../../packages/client/src/client.ts';

config({quiet:true});const url=process.env.GRAYBOX_TEST_DATABASE_URL,adminUrl=process.env.GRAYBOX_TEST_ADMIN_URL;
if(!url||!adminUrl||new URL(url).pathname!=='/graybox_test'||new URL(adminUrl).pathname!=='/graybox_test')throw new Error('Only isolated graybox_test is permitted');
const runtime=new Pool({connectionString:url}),admin=new Pool({connectionString:adminUrl});
const execute=promisify(execFile),root=resolve(import.meta.dirname,'../..');
let app:Awaited<ReturnType<typeof buildApp>>,fixture:Awaited<ReturnType<typeof seedDatabase>>,api:ApiClient,dir:string,cwd:string,configPath:string,projectId:string,transport:StdioClientTransport,client:Client;
let protocolDiagnostics='';
let testSignal:AbortSignal;
const pendingCli=new Set<Promise<unknown>>();
beforeEach(context=>{testSignal=context.signal;});
afterEach(async()=>{await Promise.allSettled([...pendingCli]);});
const command=(type:string,payload:unknown,batch_id=randomUUID(),expected_revision?:number)=>({type,payload,batch_id,idempotency_key:randomUUID(),...(expected_revision?{expected_revision}:{})});
async function cli(args:string[],body?:unknown,options:{cwd?:string;configPath?:string}={}){
  const signal=testSignal;signal.throwIfAborted();const path=join(dir,randomUUID()+'.json');if(body!==undefined)await writeFile(path,JSON.stringify(body));
  const all=[...args,'--cwd',options.cwd??cwd,...(body===undefined?[]:['--input',path])];
  const execution=execute(process.execPath,[...(process.env.GRAYBOX_BUNDLED_CLIENT?[join(root,'.local/client-release/runtime/client.mjs')]:['--import','tsx',join(root,'apps/cli/src/main.ts')]),...all],{cwd:root,env:{...process.env,GRAYBOX_CLIENT_CONFIG:options.configPath??configPath},timeout:10000,signal,maxBuffer:1024*1024,windowsHide:true});pendingCli.add(execution);
  try{const result=await execution;return JSON.parse(result.stdout);}catch(error){signal.throwIfAborted();const result=error as {stdout?:string};if(!result.stdout)throw new Error('CLI subprocess failed before returning a JSON result');return JSON.parse(result.stdout);}finally{pendingCli.delete(execution);}
}
function parseToolText(text:string){try{return JSON.parse(text);}catch{return {error:{code:'PROTOCOL_VALIDATION',message:'Input schema rejected'}};}}
async function tool(name:string,args:Record<string,unknown>,mcpClient=client){testSignal.throwIfAborted();const result=await mcpClient.callTool({name,arguments:{cwd,...args}},{signal:testSignal,timeout:8000});return {isError:result.isError,body:parseToolText((result.content[0] as {text:string}).text)};}
async function readTrustedConfig(){return readFile(configPath,'utf8');}
beforeAll(async()=>{
  await admin.query('DROP SCHEMA IF EXISTS graybox CASCADE');await migrate(admin);fixture=await seedDatabase(admin);
  app=await buildApp({pool:runtime,mode:'local'});const endpoint=await app.listen({port:0,host:'127.0.0.1'});api=new ApiClient({endpoint,token:fixture.tokens.owner_agent!});
  dir=await mkdtemp(join(tmpdir(),'graybox integration 中文 space '));cwd=join(dir,'project');await mkdir(cwd);const credentials_file=join(dir,'credentials.json');configPath=join(dir,'client.json');
  await writeFile(credentials_file,JSON.stringify({mode:'local-demonstration-only',workspace_id:fixture.workspace_id,humans:fixture.humans,agents:fixture.agents}));
  const health=await api.health();await writeFile(configPath,JSON.stringify({version:1,environments:[{environment_id:health.environment_id,endpoint,credentials_file,agent_id:fixture.agents[0]!.id}]}));
  const p=await api.command(command('project_create',{workspace_id:fixture.workspace_id,name:'Client fixture'}));projectId=p.id;
  await mkdir(join(cwd,'.graybox'));await writeFile(join(cwd,'.graybox/project.json'),JSON.stringify({version:1,environment_id:health.environment_id,workspace_id:fixture.workspace_id,project_id:projectId}));
  transport=new StdioClientTransport({command:process.execPath,args:process.env.GRAYBOX_BUNDLED_CLIENT?[join(root,'.local/client-release/runtime/client.mjs'),'mcp','serve']:['--import','tsx',join(root,'apps/mcp/src/server.ts')],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),GRAYBOX_CLIENT_CONFIG:configPath},stderr:'pipe'});
  transport.stderr?.on('data',data=>{protocolDiagnostics+=String(data);});client=new Client({name:'graybox-integration',version:'1.0.0'});await client.connect(transport);
},30000);
afterAll(async()=>{await client?.close();await app?.close();await runtime.end();await admin.end();if(dir)await rm(dir,{recursive:true,force:true});});
describe('real CLI and official MCP SDK → stdio → PostgreSQL API',()=>{
  test('advertises exactly implemented tools with explicit cwd and field schemas',async()=>{const result=await client.listTools();expect(result.tools.map(t=>t.name).sort()).toEqual(['context_resolve','entity_get','project_write','experiment_create','experiment_update','evidence_append','review_submit','activity_list','batch_undo','retrospective_create','retrospective_list','comment_create','comment_list','tag_list','command_execute','entity_activate','entity_list','collaboration_get','sync_status','sync_prepare','sync_execute','attachment_upload','attachment_link','attachment_list'].sort());for(const tool of result.tools)expect(tool.inputSchema.required).toContain('cwd');const evidence=result.tools.find(t=>t.name==='evidence_append')!;expect(JSON.stringify(evidence.inputSchema)).toContain('source_kind');});
  test('bound reports comments tags retries and wrong project',async()=>{
    const project=(await cli(['project','get'])).data;
    const report=command('retrospective_create',{project_id:projectId,title:'Recap',goal:'Flow',approach:'CLI',result:'Observed',verification:'Assertions',failures:'None observed',reusable:'Keys',lessons:'Bind',next_steps:'Review',outcome:'partial',custom_sections:[{title:'Limits',content:'No human acceptance'}]},randomUUID(),project.revision);
    const created=await cli(['retrospective','create'],report);expect(created.data.id).toBeTruthy();expect(await cli(['retrospective','create'],report)).toEqual(created);
    expect((await tool('retrospective_list',{})).body.data.some((r:{id:string})=>r.id===created.data.id)).toBe(true);
    const comment=command('comment_create',{project_id:projectId,body:'Correction'},randomUUID(),(await cli(['project','get'])).data.revision);
    const posted=await tool('comment_create',comment);expect(posted.isError).not.toBe(true);expect(await tool('comment_create',comment)).toEqual(posted);
    expect((await cli(['comment','list'])).data.some((r:{id:string})=>r.id===posted.body.data.id)).toBe(true);
    expect(Array.isArray((await cli(['tag','list'])).data)).toBe(true);expect((await tool('tag_list',{})).isError).not.toBe(true);
    const wrong=await cli(['retrospective','create'],{...report,idempotency_key:randomUUID(),payload:{...(report.payload as Record<string,unknown>),project_id:randomUUID()}});expect(wrong.error.code).toBe('PROJECT_MISMATCH');
  },15000);
  test('CLI auth and status show selected agent and project without credentials',async()=>{const auth=await cli(['auth','status']);expect(auth.data[0].agent.kind).toBe('agent');const result=await cli(['status']);expect(result.data.project.id).toBe(projectId);expect(result.data.active_experiment).toBeNull();for(const token of Object.values(fixture.tokens))expect(JSON.stringify([auth,result])).not.toContain(token);},10000);
  test('MCP context refuses missing cwd and resolves explicit project with Git metadata',async()=>{const missing=await client.callTool({name:'context_resolve',arguments:{}});expect(missing.isError).toBe(true);const result=await tool('context_resolve',{include_git:true});expect(result.body.data.project_id).toBe(projectId);expect(result.body.data.agent.agent_id).toBe(fixture.agents[0]!.id);});
  test('CLI creates project, retries stable key once, conflicts changed body and records agent provenance',async()=>{const body=command('project_create',{workspace_id:fixture.workspace_id,name:'Roundtrip CLI'});const a=await cli(['project','create'],body),b=await cli(['project','create'],body);expect(a.data.id).toBeTruthy();expect(b).toEqual(a);const conflict=await cli(['project','create'],{...body,payload:{workspace_id:fixture.workspace_id,name:'Changed'}});expect(conflict.error.code).toBe('IDEMPOTENCY_MISMATCH');const rows=await admin.query('SELECT agent_id,human_id FROM graybox.activities WHERE batch_id=$1',[body.batch_id]);expect(rows.rows).toHaveLength(1);expect(rows.rows[0]).toMatchObject({agent_id:fixture.agents[0]!.id,human_id:fixture.agents[0]!.human_id});},12000);
  test('MCP experiment → evidence → immutable review snapshot and closed retry',async()=>{const batch_id=randomUUID(),create=command('experiment_create',{project_id:projectId,series_name:'SDK series',name:'SDK experiment',goal:'Observe protocol roundtrip'},batch_id);const created=await tool('experiment_create',create);expect(created.isError).not.toBe(true);const e=created.body.data;const evidence=await tool('evidence_append',command('evidence_append',{experiment_id:e.id,type:'test',source_kind:'agent_reported',result:'passed',details:{command:'vitest protocol',summary:'This integration asserted API and SDK behavior',exit_code:0}},batch_id,e.revision));const reviewBody=command('review_submit',{experiment_id:e.id},batch_id,evidence.body.data.revision),review=await tool('review_submit',reviewBody);expect(review.body.data.status).toBe('waiting_for_review');expect(await tool('review_submit',reviewBody)).toEqual(review);const get=await tool('entity_get',{entity_type:'experiment',id:e.id});expect(get.body.data.submissions[0].snapshot.evidence).toHaveLength(1);expect(get.body.data.submissions[0].snapshot.goal).toBe('Observe protocol roundtrip');const conflict=await tool('experiment_update',command('experiment_update',{id:e.id,summary:'stale'},randomUUID(),1));expect(conflict.body.error.code).toBe('REVISION_CONFLICT');});
  test('MCP rejects arbitrary human judgment before write',async()=>{const result=await tool('project_write',{...command('project_update',{id:projectId,rating:5},randomUUID(),1)});expect(result.isError).toBe(true);});
  test('CLI undo preview and execution require matching token/revision and preserve activity',async()=>{
    const undoCwd=join(dir,'isolated undo');await mkdir(undoCwd);await mkdir(join(undoCwd,'.graybox'));await writeFile(join(undoCwd,'.graybox/project.json'),await readFile(join(cwd,'.graybox/project.json'),'utf8'));
    const body=command('project_create',{workspace_id:fixture.workspace_id,name:'Undo me'}),created=await cli(['project','create'],body,{cwd:undoCwd});
    await cli(['project','bind','--replace'],{version:1,environment_id:(await api.health()).environment_id,workspace_id:fixture.workspace_id,project_id:created.data.id},{cwd:undoCwd});
    const preview=await cli(['undo','preview','--batch-id',body.batch_id],undefined,{cwd:undoCwd});expect(preview.data.preview_token).toBeTruthy();
    const undone=await cli(['undo','execute','--batch-id',body.batch_id],{expected_batch_revision:preview.data.batch_revision,preview_token:preview.data.preview_token,idempotency_key:randomUUID()},{cwd:undoCwd});expect(undone.data.undone).toBe(true);await expect(api.project(created.data.id)).rejects.toMatchObject({code:'NOT_FOUND'});expect((await api.activity({batch_id:body.batch_id})).length).toBe(1);
  },15000);
  test('MCP batch undo previews then executes without external dependency',async()=>{const body=command('experiment_create',{project_id:projectId,series_name:'Undo SDK series',name:'Undo SDK',goal:'Undo isolated create'}),created=await tool('experiment_create',body);const preview=await tool('batch_undo',{action:'preview',batch_id:body.batch_id});expect(preview.isError).not.toBe(true);const execute=await tool('batch_undo',{action:'execute',batch_id:body.batch_id,expected_batch_revision:preview.body.data.batch_revision,preview_token:preview.body.data.preview_token,idempotency_key:randomUUID()});expect(execute.body.data.undone).toBe(true);await expect(api.experiment(created.body.data.id)).rejects.toMatchObject({code:'NOT_FOUND'});});
  test('stderr/stdout diagnostics never leak tokens',()=>{for(const token of [...Object.values(fixture.tokens),...fixture.humans.map(h=>h.token)])expect(protocolDiagnostics).not.toContain(token);});
  test('all three seeded agents are distinct CLI and MCP identities with authoritative provenance',async()=>{
    const original=JSON.parse(await readTrustedConfig());
    for(const agent of fixture.agents){
      testSignal.throwIfAborted();const agentConfig=join(dir,'agent-'+agent.id+'.json');await writeFile(agentConfig,JSON.stringify({...original,environments:[{...original.environments[0],agent_id:agent.id}]}));const identity=await cli(['auth','status'],undefined,{configPath:agentConfig});expect(identity.data[0].agent.agent_id).toBe(agent.id);expect(identity.data[0].agent.human_id).toBe(agent.human_id);
      const agentTransport=new StdioClientTransport({command:process.execPath,args:process.env.GRAYBOX_BUNDLED_CLIENT?[join(root,'.local/client-release/runtime/client.mjs'),'mcp','serve']:['--import','tsx',join(root,'apps/mcp/src/server.ts')],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),GRAYBOX_CLIENT_CONFIG:agentConfig},stderr:'pipe'}),agentClient=new Client({name:'graybox-agent-'+agent.id,version:'1.0.0'});
      agentTransport.stderr?.on('data',data=>{protocolDiagnostics+=String(data);});
      try{await agentClient.connect(agentTransport,{signal:testSignal,timeout:8000});const resolved=await tool('context_resolve',{},agentClient);expect(resolved.body.data.agent.agent_id).toBe(agent.id);
        const agentApi=new ApiClient({endpoint:original.environments[0].endpoint,token:agent.token});
        const ownProject=await agentApi.command(command('project_create',{workspace_id:fixture.workspace_id,name:'Agent project '+agent.id}));
        const ownCwd=join(dir,'own-'+agent.id);await mkdir(join(ownCwd,'.graybox'),{recursive:true});
        await writeFile(join(ownCwd,'.graybox/project.json'),JSON.stringify({version:1,environment_id:original.environments[0].environment_id,workspace_id:fixture.workspace_id,project_id:ownProject.id}));
        const ownContext=await tool('context_resolve',{cwd:ownCwd},agentClient);expect(ownContext.body.data.project.project_role).toBe('owner');
        const create=command('experiment_create',{project_id:ownProject.id,series_name:'Identity '+agent.id,name:'Identity provenance',goal:'Assert this distinct agent identity'}),result=await tool('experiment_create',{cwd:ownCwd,...create},agentClient);expect(result.isError).not.toBe(true);const row=(await admin.query('SELECT agent_id,human_id,credential_id FROM graybox.activities WHERE batch_id=$1',[create.batch_id])).rows[0];expect(row.agent_id).toBe(agent.id);expect(row.human_id).toBe(agent.human_id);
      }finally{await agentClient.close();}
    }
  },15000);
  test.each(['project','experiment'] as const)('exact undo execution retry survives soft-deleted %s context and rejects removed authority',async(kind)=>{
    const batch_id=randomUUID(),entity=await api.command(kind==='project'?command('project_create',{workspace_id:fixture.workspace_id,name:'Replay deleted project'},batch_id):command('experiment_create',{project_id:projectId,series_name:'Replay series',name:'Replay active experiment',goal:'Return the original undo receipt after response loss'},batch_id));
    const replayCwd=join(dir,'replay-'+kind);await mkdir(join(replayCwd,'.graybox'),{recursive:true});const binding={version:1,environment_id:(await api.health()).environment_id,workspace_id:fixture.workspace_id,project_id:kind==='project'?entity.id:projectId};await writeFile(join(replayCwd,'.graybox/project.json'),JSON.stringify(binding));
    if(kind==='experiment')await writeFile(join(replayCwd,'.graybox/local.json'),JSON.stringify({version:1,active_experiment_id:entity.id}));
    const preview=await tool('batch_undo',{cwd:replayCwd,action:'preview',batch_id});expect(preview.isError).not.toBe(true);const body={expected_batch_revision:preview.body.data.batch_revision,preview_token:preview.body.data.preview_token,idempotency_key:randomUUID()};
    // Commit succeeded but the adapter/user did not receive its response: replay the exact request.
    const original=await api.undo(batch_id,body),replayed=await tool('batch_undo',{cwd:replayCwd,action:'execute',batch_id,...body});expect(replayed.isError).not.toBe(true);expect(replayed.body.data).toEqual(original);expect((await admin.query('SELECT count(*)::int n FROM graybox.batches WHERE compensates=$1',[batch_id])).rows[0].n).toBe(1);
    await admin.query("UPDATE graybox.credentials SET project_ids='[]'::jsonb WHERE agent_id=$1",[fixture.agents[0]!.id]);
    try{const denied=await tool('batch_undo',{cwd:replayCwd,action:'execute',batch_id,...body});expect(denied.isError).toBe(true);expect(denied.body.error.code).toBe('NOT_FOUND');}finally{await admin.query('UPDATE graybox.credentials SET project_ids=NULL WHERE agent_id=$1',[fixture.agents[0]!.id]);}
    await writeFile(join(replayCwd,'.graybox/project.json'),JSON.stringify({...binding,workspace_id:randomUUID()}));const wrongWorkspace=await tool('batch_undo',{cwd:replayCwd,action:'execute',batch_id,...body});expect(wrongWorkspace.isError).toBe(true);expect(wrongWorkspace.body.error.code).toBe('WORKSPACE_MISMATCH');
  });
});
