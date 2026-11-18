import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {config} from 'dotenv';
import {buildApp} from '../../apps/api/src/app.ts';
import {migrate} from '../../packages/db/src/migrate.ts';
import {seedDatabase} from '../../packages/db/src/seed.ts';
config({quiet:true});
for(const key of ['GRAYBOX_TEST_DATABASE_URL','GRAYBOX_TEST_ADMIN_URL'])if(new URL(process.env[key]!).pathname!=='/graybox_test')throw Error('Isolated test DB required');
const admin=new Pool({connectionString:process.env.GRAYBOX_TEST_ADMIN_URL}),runtime=new Pool({connectionString:process.env.GRAYBOX_TEST_DATABASE_URL});
let app:Awaited<ReturnType<typeof buildApp>>,f:Awaited<ReturnType<typeof seedDatabase>>;
const body=(type:string,payload:unknown,revision?:number,batch_id:string=randomUUID())=>({type,payload,batch_id,idempotency_key:randomUUID(),...(revision?{expected_revision:revision}:{})});
async function req(method:'GET'|'POST',url:string,payload?:unknown,token=f.tokens.member_agent){const r=await app.inject({method,url,headers:{authorization:`Bearer ${token}`},...(payload?{payload}: {})});return {status:r.statusCode,...r.json()};}
async function cmd(type:string,payload:unknown,revision?:number,token=f.tokens.member_agent,batch?:string){return req('POST','/v1/commands',body(type,payload,revision,batch),token);}
async function project(extra={}){return (await cmd('project_create',{workspace_id:f.workspace_id,name:'P',...extra})).data;}
beforeAll(async()=>{app=await buildApp({pool:runtime,mode:'local'});});
beforeEach(async()=>{await admin.query('DROP SCHEMA IF EXISTS graybox CASCADE');await migrate(admin);f=await seedDatabase(admin);});
afterAll(async()=>{await app?.close();await runtime.end();await admin.end();});

test('starting an independent idea creates a named project; linked idea creates an experiment, preserving source and retries',async()=>{
 const pr=await project();
 for(const project_id of [null,pr.id]){
  const i=(await cmd('idea_create',{project_id,name:'Start together',body:'Original',tags:['合作']})).data;
  const input=body('entity_start',{entity_type:'idea',entity_id:i.id,name:'My attempt'},i.revision);
  const first=await req('POST','/v1/commands',input,f.tokens.third_agent);expect(first.status).toBe(200);expect(first.data).toMatchObject({name:'My attempt',started_kind:project_id?'experiment':'project',source:{entity_type:'idea',entity_id:i.id,revision:i.revision,snapshot:{body:'Original'}}});
  expect(first.data[project_id?'owner_id':'creator_id']).toBe(f.humans[2]!.id);
  if(project_id)expect(first.data.project_id).toBe(project_id);
  expect(await req('POST','/v1/commands',input,f.tokens.third_agent)).toEqual(first);
  const original=(await req('GET',`/v1/ideas/${i.id}`)).data;expect(original).toMatchObject({owner_id:i.owner_id,body:'Original',progress:'in_progress',tags:['合作']});
  expect((await cmd('entity_start',{entity_type:'idea',entity_id:i.id,name:'Stale'},i.revision)).status).toBe(409);
  const second=await cmd('entity_start',{entity_type:'idea',entity_id:i.id,name:'Another attempt'},original.revision);expect(second.status).toBe(200);expect(second.data.id).not.toBe(first.data.id);
  const social=(await req('GET',`/v1/collaboration?entity_type=idea&entity_id=${i.id}`)).data;expect(social.participants).toHaveLength(2);
  const edited=(await cmd('idea_update',{id:i.id,body:'Owner edits'},original.revision)).data;expect(edited.progress).toBe('in_progress');
  if(!project_id){const updated=await cmd('project_update',{id:first.data.id,description:'Normal project'},first.data.revision,f.tokens.third_agent);expect(updated.status).toBe(200);expect(updated.data.source.entity_id).toBe(i.id);expect((await cmd('idea_create',{project_id:first.data.id,name:'Next idea',body:'B'},undefined,f.tokens.third_agent)).status).toBe(200);expect((await cmd('experiment_create',{project_id:first.data.id,name:'Next experiment',series_name:'S',goal:'G'},undefined,f.tokens.third_agent)).status).toBe(200);}
 }
});
test('four-section experiment report survives normal edits, evidence and shared contribution',async()=>{
 const pr=await project(),report={done:['Built prototype'],failed:['High latency'],reusable:['Networking'],pending:['Human test'],other:['Additional notes','Optional observations']};
 const e=(await cmd('experiment_create',{project_id:pr.id,series_name:'Report',name:'E',goal:'G',report})).data;expect(e.report).toEqual(report);
 const updated=(await cmd('experiment_update',{id:e.id,summary:'Legacy preserved'},e.revision)).data;expect(updated.report).toEqual(report);
 await cmd('entity_join',{entity_type:'experiment',entity_id:e.id},updated.revision,f.tokens.third_agent);
 const contributed=(await cmd('experiment_update',{id:e.id,report:{...report,pending:['Human test','Friend trial']}},updated.revision,f.tokens.third_agent)).data;expect(contributed.report.pending).toHaveLength(2);
 const branch=(await cmd('entity_branch',{entity_type:'experiment',entity_id:e.id},contributed.revision,f.tokens.third_agent)).data;expect(branch.report).toBeNull();expect(branch.source.snapshot.report).toEqual(contributed.report);
 const proposal={done:['Compared prediction'],failed:[],reusable:['Authority'],pending:['Friend trial'],other:['Context retained during merge']};
 const revised=(await cmd('experiment_update',{id:branch.id,report:proposal},branch.revision,f.tokens.third_agent)).data;
 const merge=(await cmd('merge_submit',{entity_type:'experiment',entity_id:branch.id,selected_fields:['report']},revised.revision,f.tokens.third_agent)).data;
 expect((await cmd('merge_resolve',{id:merge.id,decision:'accept',expected_target_revision:contributed.revision},merge.revision)).status).toBe(200);
 const target=(await req('GET',`/v1/experiments/${e.id}`)).data;expect(target.report).toEqual(proposal);expect(target.summary).toBe('Legacy preserved');
});

test('teammates extend and comment on ideas without overwriting the original; author receives notifications',async()=>{
 const i=(await cmd('idea_create',{name:'Original',body:'Initial content'})).data;
 const input=body('entity_comment',{entity_type:'idea',entity_id:i.id,body:'Add an alternative control scheme',kind:'extension'},i.revision);
 const first=await req('POST','/v1/commands',input,f.tokens.third_agent);expect(first.status).toBe(200);expect(first.data.kind).toBe('extension');
 expect(await req('POST','/v1/commands',input,f.tokens.third_agent)).toEqual(first);
 expect((await cmd('entity_comment',{entity_type:'idea',entity_id:i.id,body:'Useful for testing'},i.revision,f.tokens.third_agent)).status).toBe(200);
 const social=(await req('GET',`/v1/collaboration?entity_type=idea&entity_id=${i.id}`)).data;expect(social.comments).toHaveLength(2);expect(social.comments[0]).toMatchObject({kind:'extension',author_id:f.humans[2]!.id,body:'Add an alternative control scheme'});
 expect((await req('GET',`/v1/ideas/${i.id}`)).data).toMatchObject({body:'Initial content',owner_id:i.owner_id,revision:i.revision});
 expect((await req('GET','/v1/collaboration/notifications',undefined,f.humans[1]!.token)).data.items).toHaveLength(2);
});

test('native tags belong independently to linked ideas, unlinked ideas and experiments and survive edits and branches',async()=>{
 const p=await project({tags:['项目标签']});
 for(const project_id of [null,p.id]){
  const i=(await cmd('idea_create',{workspace_id:f.workspace_id,project_id,name:'Tagged',body:'Body',tags:['  研究   方向  ','研究 方向']})).data;
  expect(i.tags).toEqual(['研究 方向']);
  const edited=(await cmd('idea_update',{id:i.id,body:'Next'},i.revision)).data;expect(edited.tags).toEqual(i.tags);
  const branch=(await cmd('entity_branch',{entity_type:'idea',entity_id:i.id},edited.revision,f.tokens.third_agent)).data;expect(branch.tags).toEqual(i.tags);
  expect((await cmd('idea_update',{id:i.id,tags:['非法修改']},edited.revision,f.tokens.third_agent)).status).toBe(403);
  const cleared=(await cmd('idea_update',{id:i.id,tags:[]},edited.revision)).data;expect(cleared.tags).toEqual([]);
 }
 const e=(await cmd('experiment_create',{project_id:p.id,series_name:'Tags',name:'Experiment',goal:'G',tags:['实验标签']})).data;expect(e.tags).toEqual(['实验标签']);
 const changed=(await cmd('experiment_update',{id:e.id,summary:'Next'},e.revision)).data;expect(changed.tags).toEqual(e.tags);
 const branch=(await cmd('entity_branch',{entity_type:'experiment',entity_id:e.id},changed.revision,f.tokens.third_agent)).data;expect(branch.tags).toEqual(e.tags);
 expect((await req('GET',`/v1/projects/${p.id}`)).data.tags).toEqual(['项目标签']);
 const catalog=(await req('GET',`/v1/tags?workspace_id=${f.workspace_id}`)).data.map((t:{name:string})=>t.name);expect(catalog).toEqual(expect.arrayContaining(['项目标签','实验标签','研究 方向']));
});

test('idea branching keeps snapshots and enforces source owner merge authority',async()=>{
 const idea=(await cmd('idea_create',{name:'Idea',body:'Original',project_id:null})).data;
 expect(idea.owner_id).toBe(f.humans[1]!.id);
 const branch=(await cmd('entity_branch',{entity_type:'idea',entity_id:idea.id},1,f.tokens.third_agent)).data;
 expect(branch.source.snapshot.body).toBe('Original');
 expect((await cmd('idea_update',{id:idea.id,body:'Unauthorized'},1,f.tokens.third_agent)).status).toBe(403);
 const changed=(await cmd('idea_update',{id:branch.id,body:'Branch content'},1,f.tokens.third_agent)).data;
 const merge=(await cmd('merge_submit',{entity_type:'idea',entity_id:branch.id,selected_fields:['body']},changed.revision,f.tokens.third_agent)).data;
 expect((await cmd('merge_resolve',{id:merge.id,decision:'accept',expected_target_revision:1},1,f.tokens.third_agent)).status).toBe(403);
 expect((await cmd('merge_resolve',{id:merge.id,decision:'accept',expected_target_revision:1},1)).status).toBe(200);
 expect((await req('GET',`/v1/ideas/${idea.id}`)).data.body).toBe('Branch content');
 expect((await req('GET',`/v1/ideas/${branch.id}`)).data.body).toBe('Branch content');
});
test('collaboration receipts retry exactly and human agreements notify owner',async()=>{
 const idea=(await cmd('idea_create',{name:'Idea',body:'B'})).data;
 const input=body('entity_comment',{entity_type:'idea',entity_id:idea.id,body:'Comment'},1);
 const first=await req('POST','/v1/commands',input, f.tokens.third_agent);
 expect(first.status).toBe(200);expect(await req('POST','/v1/commands',input,f.tokens.third_agent)).toEqual(first);
 expect((await cmd('entity_agree',{entity_type:'idea',entity_id:idea.id,agreed:true},1,f.tokens.third_agent)).status).toBe(403);
 expect((await req('GET','/v1/collaboration/notifications',undefined,f.humans[1]!.token)).data.items).toHaveLength(1);
});

test('members own experiments in another project and preserve source idea snapshot',async()=>{
 const pr=await project();const i=(await cmd('idea_create',{name:'Idea',body:'Original',priority:'high'})).data;
 const e=(await cmd('experiment_create',{project_id:pr.id,series_name:'Test',name:'Trial',goal:'Goal',source_idea_id:i.id},undefined,f.tokens.third_agent)).data;
 expect(e.owner_id).toBe(f.humans[2]!.id);expect(e.source.snapshot.body).toBe('Original');
 expect((await cmd('experiment_update',{id:e.id,priority:'high'},1)).status).toBe(403);
 expect((await cmd('entity_join',{entity_type:'experiment',entity_id:e.id},1)).status).toBe(200);
 expect((await cmd('experiment_update',{id:e.id,summary:'Shared work',progress:'in_progress'},1)).status).toBe(200);
 expect((await cmd('experiment_update',{id:e.id,priority:'high'},2)).status).toBe(403);
});

test('same batch collaboration accepts multiple commands and blocks undo without data loss',async()=>{
 const batch=randomUUID();const i=(await cmd('idea_create',{name:'I',body:'B'},undefined,f.tokens.member_agent,batch)).data;
 expect((await cmd('idea_update',{id:i.id,body:'Next'},1,f.tokens.member_agent,batch)).status).toBe(200);
 expect((await req('POST',`/v1/batches/${batch}/preview`,{})).error.code).toBe('UNDO_UNAVAILABLE');
});
test('new experiment branch starts without inheriting the source conclusion',async()=>{
 const p=await project();
 const source=(await cmd('experiment_create',{project_id:p.id,series_name:'S',name:'Finished',goal:'G',progress:'completed',outcome:'partial'})).data;
 const finished=(await cmd('experiment_update',{id:source.id,summary:'Prior result',change_summary:'Prior changes'},1)).data;
 const branch=(await cmd('entity_branch',{entity_type:'experiment',entity_id:source.id},finished.revision,f.tokens.third_agent)).data;
 expect(branch).toMatchObject({progress:'todo',outcome:'inconclusive',summary:'',change_summary:''});
 expect(branch.source.snapshot).toMatchObject({progress:'completed',outcome:'partial',summary:'Prior result'});
});
test('migration007 preserves all previous business and audit bytes',async()=>{
 const p=await project();await cmd('experiment_create',{project_id:p.id,series_name:'S',name:'E',goal:'G'});
 const tables=['projects','experiments','experiment_series','activities','batches','credentials','users','idempotency'];
 const snapshot=async()=>Promise.all(tables.map(async t=>(await admin.query(`SELECT row_to_json(x)::text AS bytes FROM graybox.${t} x ORDER BY row_to_json(x)::text`)).rows));
 const before=await snapshot();const {readFile}=await import('node:fs/promises');await admin.query(await readFile(new URL('../../db/migrations/007_collaboration.sql',import.meta.url),'utf8'));
 expect(await snapshot()).toEqual(before);
});
test('revoked scopes do not disclose cached unlinked idea receipts and stale updates fail atomically',async()=>{
 const input=body('idea_create',{name:'I',body:'B'});const created=(await req('POST','/v1/commands',input)).data;
 const results=await Promise.all([cmd('idea_update',{id:created.id,body:'One'},1),cmd('idea_update',{id:created.id,body:'Two'},1)]);
 expect(results.map(x=>x.status).sort()).toEqual([200,409]);
 await admin.query('UPDATE graybox.credentials SET project_ids=$1 WHERE label=$2',[JSON.stringify([]),'member_agent']);
 expect((await req('POST','/v1/commands',input)).status).toBe(404);
});

test('partial adoption uses immutable submitted fields despite branch edits; rejected branch persists',async()=>{
 const i=(await cmd('idea_create',{name:'Original',body:'B'})).data;
 const b=(await cmd('entity_branch',{entity_type:'idea',entity_id:i.id},1,f.tokens.third_agent)).data;
 const revised=(await cmd('idea_update',{id:b.id,name:'Proposed',body:'Submitted'},1,f.tokens.third_agent)).data;
 const r=(await cmd('merge_submit',{entity_type:'idea',entity_id:b.id,selected_fields:['name','body']},2,f.tokens.third_agent)).data;
 await cmd('idea_update',{id:b.id,body:'Later'},2,f.tokens.third_agent);
 const resolved=await cmd('merge_resolve',{id:r.id,decision:'partial',selected_fields:['body'],expected_target_revision:1},1);expect(resolved.status).toBe(200);
 const target=(await req('GET',`/v1/ideas/${i.id}`)).data;expect(target.name).toBe('Original');expect(target.body).toBe('Submitted');
 expect((await req('GET',`/v1/ideas/${b.id}`)).data.body).toBe('Later');
 expect((await cmd('merge_resolve',{id:r.id,decision:'accept',expected_target_revision:2},1)).error.code).toBe('MERGE_RESOLVED');
 for(const sql of ['UPDATE graybox.collaboration_events SET data=data','DELETE FROM graybox.merge_requests','UPDATE graybox.merge_requests SET snapshot=snapshot','DELETE FROM graybox.merge_decisions'])await expect(runtime.query(sql)).rejects.toHaveProperty('code','42501');
});
test('human agreement can be retracted without rewriting event history',async()=>{
 const i=(await cmd('idea_create',{name:'I',body:'B'})).data;
 expect((await cmd('entity_agree',{entity_type:'idea',entity_id:i.id,agreed:true},1,f.humans[2]!.token)).status).toBe(200);
 let view=(await req('GET',`/v1/collaboration?entity_type=idea&entity_id=${i.id}`,undefined,f.humans[2]!.token)).data;expect(view.agreements).toEqual({count:1,agreed:true});
 await cmd('entity_agree',{entity_type:'idea',entity_id:i.id,agreed:false},1,f.humans[2]!.token);
 view=(await req('GET',`/v1/collaboration?entity_type=idea&entity_id=${i.id}`,undefined,f.humans[2]!.token)).data;expect(view.agreements).toEqual({count:0,agreed:false});
 expect((await admin.query("SELECT count(*)::int AS n FROM graybox.collaboration_events WHERE kind='agreement'")).rows[0].n).toBe(2);
});

test('merge reads expose live target project and hide snapshots when branch leaves credential scope',async()=>{
 const a=await project(),b=await project({name:'Other'});
 const target=(await cmd('idea_create',{name:'Target',body:'B',project_id:a.id})).data;
 const branch=(await cmd('entity_branch',{entity_type:'idea',entity_id:target.id},1,f.tokens.third_agent)).data;
 const merge=(await cmd('merge_submit',{entity_type:'idea',entity_id:branch.id,selected_fields:['body']},1,f.tokens.third_agent)).data;
 await cmd('idea_update',{id:target.id,project_id:b.id},1);
 let read=(await req('GET',`/v1/merge-requests/${merge.id}`)).data;expect(read.project_id).toBe(b.id);expect(read.target_project_id).toBe(b.id);
 await cmd('idea_update',{id:target.id,project_id:a.id},2);
 await cmd('idea_update',{id:branch.id,project_id:b.id},1,f.tokens.third_agent);
 await admin.query("UPDATE graybox.credentials SET project_ids=$1 WHERE label='member_agent'",[JSON.stringify([a.id])]);
 const list=await req('GET',`/v1/collaboration?entity_type=idea&entity_id=${target.id}`);
 expect(list.status).toBe(200);expect(list.data.merge_requests).toEqual([]);
 expect((await req('GET',`/v1/merge-requests/${merge.id}`)).status).toBe(404);
});

test('cached merge snapshots reauthorize both live endpoints after project relocation',async()=>{
 const a=await project(),b=await project({name:'Other'});
 const target=(await cmd('idea_create',{name:'T',body:'B',project_id:a.id})).data;
 const branch=(await cmd('entity_branch',{entity_type:'idea',entity_id:target.id},1,f.tokens.third_agent)).data;
 const input=body('merge_submit',{entity_type:'idea',entity_id:branch.id,selected_fields:['body']},1);
 expect((await req('POST','/v1/commands',input,f.tokens.third_agent)).status).toBe(200);
 await cmd('idea_update',{id:target.id,project_id:b.id},1);
 await admin.query("UPDATE graybox.credentials SET project_ids=$1 WHERE label='third_agent'",[JSON.stringify([a.id])]);
 expect((await req('POST','/v1/commands',input,f.tokens.third_agent)).status).toBe(404);
});
