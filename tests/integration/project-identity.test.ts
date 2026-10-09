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
const envelope=(type:string,payload:unknown,expected_revision?:number,batch_id:string=randomUUID())=>({type,payload,batch_id,idempotency_key:randomUUID(),...(expected_revision?{expected_revision}:{})});
async function req(token:string,method:'GET'|'POST',url:string,payload?:unknown){const r=await app.inject({method,url,headers:{authorization:`Bearer ${token}`},...(payload?{payload}:{})});return {status:r.statusCode,...r.json()};}
const cmd=(token:string,type:string,payload:unknown,revision?:number,batch?:string)=>req(token,'POST','/v1/commands',envelope(type,payload,revision,batch));
const project=(token:string)=>cmd(token,'project_create',{workspace_id:f.workspace_id,name:'Own project'}).then(r=>r.data);
const report=(id:string)=>({project_id:id,title:'Recap',goal:'',approach:'',result:'',verification:'not run',failures:'',reusable:'',lessons:'',next_steps:'',outcome:'inconclusive',custom_sections:[]});
beforeAll(async()=>{app=await buildApp({pool:runtime,mode:'local'});});
beforeEach(async()=>{await admin.query('DROP SCHEMA IF EXISTS graybox CASCADE');await migrate(admin);f=await seedDatabase(admin);});
afterAll(async()=>{await app.close();await runtime.end();await admin.end();});

test('fixed human accounts have project-dependent owner/member regardless of team management',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,pa=await project(a.token),pb=await project(b.token);
 for(const [human,own,other] of [[a,pa,pb],[b,pb,pa]] as const){
  expect((await req(human.token,'GET',`/v1/projects/${own.id}`)).data).toMatchObject({project_role:'owner',can_edit:true,owner_id:human.id,owner_name:human.name});
  expect((await req(human.token,'GET',`/v1/projects/${other.id}`)).data).toMatchObject({project_role:'member',can_edit:false});
  expect((await cmd(human.token,'project_update',{id:other.id,name:'No'},1)).status).toBe(403);
  expect((await cmd(human.token,'comment_create',{project_id:other.id,body:'Discussion'},1)).status).toBe(200);
 }
 expect((await cmd(b.token,'project_update',{id:pb.id,name:'Own edit'},2)).status).toBe(200);
 expect((await cmd(a.token,'project_create',{workspace_id:f.workspace_id,name:'Forged',creator_id:b.id})).status).toBe(400);
 expect((await cmd(a.token,'project_update',{id:pa.id,creator_id:b.id},2)).status).toBe(400);
});

test.each(['project_update','retrospective_create','experiment_update','evidence_append','review_submit'])('team manager and their Agent cannot bypass %s on another human project',async(type)=>{
 const owner=f.tokens.member_agent!,p=await project(owner),e=(await cmd(owner,'experiment_create',{project_id:p.id,series_name:'S',name:'E',goal:'G'})).data;
 const payload=type==='project_update'?{id:p.id,name:'No'}:type==='retrospective_create'?report(p.id):type==='experiment_create'?{project_id:p.id,series_name:'No',name:'No',goal:'No'}:type==='experiment_update'?{id:e.id,summary:'No'}:type==='evidence_append'?{experiment_id:e.id,type:'test',source_kind:'agent_reported',result:'not_run',details:{command:'not executed',summary:'No'}}:{experiment_id:e.id};
 const counts=(await admin.query('SELECT (SELECT count(*) FROM graybox.activities)::int activities,(SELECT count(*) FROM graybox.idempotency)::int keys,(SELECT count(*) FROM graybox.batches)::int batches')).rows[0];
 for(const token of [f.humans[0]!.token,f.tokens.owner_agent!])expect((await cmd(token,type,payload,type==='experiment_create'?undefined:1)).status).toBe(403);
 expect((await admin.query('SELECT (SELECT count(*) FROM graybox.activities)::int activities,(SELECT count(*) FROM graybox.idempotency)::int keys,(SELECT count(*) FROM graybox.batches)::int batches')).rows[0]).toEqual(counts);
 expect((await cmd(owner,type,payload,type==='experiment_create'?undefined:1)).status).toBe(200);
 const activity=(await req(owner,'GET','/v1/activity')).data;expect(activity.at(-1)).toMatchObject({human_id:f.humans[1]!.id,agent_id:f.agents[1]!.id});
});

test.each(['metadata','creation','experiment','evidence','submission'])('historical %s undo rechecks live project creator and exact successful receipt stays stable',async(kind)=>{
 const token=f.tokens.member_agent!,p=await project(token),e=(await cmd(token,'experiment_create',{project_id:p.id,series_name:'S',name:'E',goal:'G'})).data,batch=randomUUID();
 if(kind==='metadata')await cmd(token,'project_update',{id:p.id,name:'Changed'},1,batch);
 else if(kind==='creation')await cmd(token,'experiment_create',{project_id:p.id,series_name:'New series',name:'New experiment',goal:'G'},undefined,batch);
 else if(kind==='experiment')await cmd(token,'experiment_update',{id:e.id,summary:'Changed'},1,batch);
 else if(kind==='evidence')await cmd(token,'evidence_append',{experiment_id:e.id,type:'test',source_kind:'agent_reported',result:'not_run',details:{command:'demo',summary:'not run'}},1,batch);
 else await cmd(token,'review_submit',{experiment_id:e.id},1,batch);
 const preview=await req(token,'POST',`/v1/batches/${batch}/preview`,{});expect(preview.status).toBe(200);
 const input={expected_batch_revision:preview.data.batch_revision,preview_token:preview.data.preview_token,idempotency_key:randomUUID()};
 // Simulate historical authority drift in the isolated fixture; no product transfer API exists.
 await admin.query('UPDATE graybox.projects SET creator_id=$2 WHERE id=$1',[p.id,f.humans[0]!.id]);
 expect((await req(token,'POST',`/v1/batches/${batch}/preview`,{})).status).toBe(403);
 expect((await req(token,'POST',`/v1/batches/${batch}/undo`,input)).status).toBe(403);
 expect((await admin.query('SELECT count(*)::int n FROM graybox.batches WHERE compensates=$1',[batch])).rows[0].n).toBe(0);
 await admin.query('UPDATE graybox.projects SET creator_id=$2 WHERE id=$1',[p.id,f.humans[1]!.id]);
 const receipt=await req(token,'POST',`/v1/batches/${batch}/undo`,input);expect(receipt.status).toBe(200);
 await admin.query('UPDATE graybox.projects SET creator_id=$2 WHERE id=$1',[p.id,f.humans[0]!.id]);
 expect(await req(token,'POST',`/v1/batches/${batch}/undo`,input)).toEqual(receipt);
 expect((await req(token,'GET',`/v1/projects/${p.id}`)).data.project_role).toBe('member');
});

test('successful command replay is a stable receipt while reads decorate current project authority',async()=>{
 const token=f.tokens.member_agent!,p=await project(token),input=envelope('project_update',{id:p.id,name:'Saved'},1);
 const receipt=await req(token,'POST','/v1/commands',input);expect(receipt.status).toBe(200);
 await admin.query('UPDATE graybox.projects SET creator_id=NULL WHERE id=$1',[p.id]);
 expect(await req(token,'POST','/v1/commands',input)).toEqual(receipt);
 for(const reader of [token,f.tokens.owner_agent!])expect((await req(reader,'GET',`/v1/projects/${p.id}`)).data).toMatchObject({owner_id:null,owner_name:null,project_role:'member',can_edit:false,revision:2});
});

test('changing team-management capability neither grants nor revokes project ownership',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,p=await project(a.token);
 await admin.query("UPDATE graybox.users SET role=CASE WHEN id=$1 THEN 'member' ELSE 'owner' END WHERE id=ANY($2::uuid[])",[a.id,[a.id,b.id]]);
 expect((await cmd(a.token,'project_update',{id:p.id,name:'Still owner'},1)).status).toBe(200);
 expect((await cmd(b.token,'project_update',{id:p.id,name:'No team bypass'},2)).status).toBe(403);
 expect((await req(a.token,'GET',`/v1/projects/${p.id}`)).data.project_role).toBe('owner');
 expect((await req(b.token,'GET',`/v1/projects/${p.id}`)).data.project_role).toBe('member');
});

test('unassigned project keeps metadata read-only while experiments retain their actual leader',async()=>{
 const owner=f.tokens.member_agent!,p=await project(owner),e=(await cmd(owner,'experiment_create',{project_id:p.id,series_name:'S',name:'E',goal:'G'})).data;
 await admin.query('UPDATE graybox.projects SET creator_id=NULL WHERE id=$1',[p.id]);
 const attempts:[string,object,number?][]=[['project_update',{id:p.id,name:'No'},1],['retrospective_create',report(p.id),1]];
 for(const token of [owner,f.tokens.owner_agent!])for(const [type,payload,revision] of attempts)expect((await cmd(token,type,payload,revision)).status).toBe(403);
 expect((await cmd(f.tokens.owner_agent!,'experiment_update',{id:e.id,summary:'Cannot impersonate'},1)).status).toBe(403);
 expect((await cmd(owner,'experiment_update',{id:e.id,summary:'Leader continues'},1)).status).toBe(200);
 expect((await req(owner,'GET',`/v1/experiments/${e.id}`)).data).toMatchObject({revision:2,owner_id:f.humans[1]!.id,summary:'Leader continues'});
});
