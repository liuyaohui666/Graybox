import { beforeAll,afterAll,expect,test } from 'vitest';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../apps/api/src/app.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { seedDatabase } from '../../packages/db/src/seed.ts';
import { ApiClient } from '../../packages/client/src/client.ts';
import { activateIdea,resolveContext,executeCommand } from '../../packages/local-context/src/binding.ts';
import { syncStatus,syncPrepare,syncExecute } from '../../packages/local-context/src/sync.ts';
config({quiet:true});
for(const key of ['GRAYBOX_TEST_DATABASE_URL','GRAYBOX_TEST_ADMIN_URL'])if(new URL(process.env[key]!).pathname!=='/graybox_test')throw Error('Isolated test database required');
const admin=new Pool({connectionString:process.env.GRAYBOX_TEST_ADMIN_URL}),runtime=new Pool({connectionString:process.env.GRAYBOX_TEST_DATABASE_URL});
let app:Awaited<ReturnType<typeof buildApp>>,api:ApiClient,dir:string,cwd:string,configPath:string,project_id:string,workspace_id:string;
const command=(type:string,payload:unknown,expected_revision?:number)=>({type,payload,idempotency_key:randomUUID(),batch_id:randomUUID(),...(expected_revision?{expected_revision}:{})});
beforeAll(async()=>{
  await admin.query('DROP SCHEMA IF EXISTS graybox CASCADE');await migrate(admin);const f=await seedDatabase(admin);workspace_id=f.workspace_id;
  app=await buildApp({pool:runtime,mode:'local'});const endpoint=await app.listen({host:'127.0.0.1',port:0});api=new ApiClient({endpoint,token:f.tokens.owner_agent!});
  dir=await mkdtemp(join(tmpdir(),'graybox-sync-integration-'));cwd=join(dir,'project');await mkdir(cwd);await mkdir(join(cwd,'.graybox'));
  configPath=join(dir,'client.json');const credentials_file=join(dir,'credentials.json');await writeFile(credentials_file,JSON.stringify({mode:'local-demonstration-only',workspace_id,agents:f.agents}));const health=await api.health();
  await writeFile(configPath,JSON.stringify({version:1,environments:[{environment_id:health.environment_id,endpoint,credentials_file,agent_id:f.agents[0].id}]}));
  project_id=(await api.command(command('project_create',{workspace_id,name:'Sync context'}))).id;
  await writeFile(join(cwd,'.graybox/project.json'),JSON.stringify({version:1,environment_id:health.environment_id,workspace_id,project_id}));
},30000);
afterAll(async()=>{await app?.close();await runtime.end();await admin.end();if(dir)await rm(dir,{recursive:true,force:true});});
test('uncertain accepted write uses saved same key, reads immutable activity and never duplicates',async()=>{
  const options={cwd,configPath},operation_id=randomUUID(),body=command('project_update',{id:project_id,description:'Accessible turns 1–8'},1);
  await syncPrepare(options,{operation_id,through:'chat:turn-8',command:body});
  await api.command(body); // Server accepted, but caller lost the response before local acknowledgement.
  expect((await syncStatus(options)).checkpoint).toBeNull();
  const receipt=await syncExecute(options,operation_id);expect(receipt.state).toBe('verified');expect((await syncStatus(options)).checkpoint).toBe('chat:turn-8');
  await syncExecute(options,operation_id);expect(await api.activity({batch_id:body.batch_id})).toHaveLength(1);
});
test('standalone idea is explicitly independent, persists target choice and verifies its own checkpoint',async()=>{
  const options={cwd,configPath},operation_id=randomUUID(),body=command('idea_create',{workspace_id,project_id:null,name:'Independent thought',body:'Observed plan'});
  await syncPrepare(options,{operation_id,through:'chat:turn-9',command:body});const created=await syncExecute(options,operation_id);const idea_id=created.response!.id as string;
  expect((await api.idea(idea_id)).project_id).toBeNull();expect((await api.ideas({unlinked:true})).map(e=>e.id)).toContain(idea_id);
  await activateIdea({...options,idea_id});expect((await resolveContext(options)).active_idea?.id).toBe(idea_id);expect((await syncStatus(options)).checkpoint).toBeNull();
  const update=command('idea_update',{id:idea_id,body:'Accessible further detail'},1),next=randomUUID();await syncPrepare(options,{operation_id:next,through:'chat:turn-10',command:update});await syncExecute(options,next);
  expect((await syncStatus(options)).checkpoint).toBe('chat:turn-10');expect((await api.idea(idea_id)).project_id).toBeNull();await activateIdea({...options,idea_id:null});
});
test('context rejects cross-project collaboration writes before sending',async()=>{
  const other=(await api.command(command('project_create',{workspace_id,name:'Other'}))).id,idea=(await api.command(command('idea_create',{workspace_id,project_id:other,name:'Other thought',body:'Private context'}))).id;
  await expect(executeCommand({cwd,configPath},command('idea_update',{id:idea,body:'Wrong context'},1))).rejects.toMatchObject({code:'PROJECT_MISMATCH'});
  expect((await api.idea(idea)).body).toBe('Private context');
});
test('stale prepared write is durably rejected; corrected new intent verifies without losing rejected history',async()=>{
  const options={cwd,configPath},revision=(await api.project(project_id)).revision,operation_id=randomUUID(),stale=command('project_update',{id:project_id,description:'Captured earlier'},revision);
  await syncPrepare(options,{operation_id,through:'chat:turn-11',command:stale});const previous=(await syncStatus(options)).checkpoint;
  await api.command(command('project_update',{id:project_id,name:'Concurrent edit'},revision));
  const rejected=await syncExecute(options,operation_id);expect(rejected).toMatchObject({state:'rejected',rejection_code:'REVISION_CONFLICT'});expect((await syncStatus(options)).checkpoint).toBe(previous);expect(await api.activity({batch_id:stale.batch_id})).toHaveLength(0);
  const next=randomUUID(),corrected=command('project_update',{id:project_id,description:'Captured earlier'},(await api.project(project_id)).revision);
  await syncPrepare(options,{operation_id:next,through:'chat:turn-11',command:corrected});expect((await syncExecute(options,next)).state).toBe('verified');const state=await syncStatus(options);expect(state.checkpoint).toBe('chat:turn-11');expect(state.receipts.find(r=>r.operation_id===operation_id)?.state).toBe('rejected');expect(await api.activity({batch_id:corrected.batch_id})).toHaveLength(1);
});
test('merge adapter checks live target project after reassociation rather than submission snapshot',async()=>{
  const options={cwd,configPath},other=(await api.command(command('project_create',{workspace_id,name:'Moved target project'}))).id;
  const target=await api.command(command('idea_create',{workspace_id,project_id,name:'Original route',body:'Preserve'}));
  const branch=await api.command(command('entity_branch',{entity_type:'idea',entity_id:target.id},target.revision));
  const request=await api.command(command('merge_submit',{entity_type:'idea',entity_id:branch.id,selected_fields:['body']},branch.revision));
  const moved=await api.command(command('idea_update',{id:target.id,project_id:other},target.revision));
  expect((await api.mergeRequest(request.id)).target_project_id).toBe(other);
  await expect(executeCommand(options,command('merge_resolve',{id:request.id,decision:'accept',expected_target_revision:moved.revision},request.revision))).rejects.toMatchObject({code:'PROJECT_MISMATCH'});
  expect((await api.idea(target.id)).revision).toBe(moved.revision);
});
