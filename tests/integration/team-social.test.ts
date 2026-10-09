import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {config} from 'dotenv';
import {buildApp} from '../../apps/api/src/app.ts';
import {migrate} from '../../packages/db/src/migrate.ts';
import {seedDatabase} from '../../packages/db/src/seed.ts';
import {bootstrapCloud} from '../../scripts/cloud-bootstrap.ts';
import {Service} from '../../packages/core/src/service.ts';
config({quiet:true});
for(const key of ['GRAYBOX_TEST_DATABASE_URL','GRAYBOX_TEST_ADMIN_URL'])if(new URL(process.env[key]!).pathname!=='/graybox_test')throw Error('Isolated test DB required');
const admin=new Pool({connectionString:process.env.GRAYBOX_TEST_ADMIN_URL}),runtime=new Pool({connectionString:process.env.GRAYBOX_TEST_DATABASE_URL});
let app:Awaited<ReturnType<typeof buildApp>>,f:Awaited<ReturnType<typeof seedDatabase>>;
async function req(token:string,method:'GET'|'POST',url:string,payload?:unknown){const r=await app.inject({method,url,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(payload!==undefined?{payload:JSON.stringify(payload)}:{})});return {status:r.statusCode,...r.json()};}
const envelope=(type:string,payload:unknown,expected_revision?:number)=>({type,payload,batch_id:randomUUID(),idempotency_key:randomUUID(),...(expected_revision?{expected_revision}:{})});
const project=async(token:string)=>{const input=envelope('project_create',{workspace_id:f.workspace_id,name:'Idea',lifecycle:'todo'});return {input,p:(await req(token,'POST','/v1/commands',input)).data};};
const inbox=(token:string)=>req(token,'GET','/v1/notifications');
const agree=(token:string,id:string,agreed=true)=>req(token,'POST',`/v1/projects/${id}/agreement`,{agreed});
beforeAll(async()=>{app=await buildApp({pool:runtime,mode:'local'});});
beforeEach(async()=>{await admin.query('DROP SCHEMA IF EXISTS graybox CASCADE');await migrate(admin);f=await seedDatabase(admin);});
afterAll(async()=>{await app.close();await runtime.end();await admin.end();});

test('public active people expose only names and avatars; each actual human leads their own visible work',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,pa=await project(a.token),pb=await project(b.token);
 await admin.query('UPDATE graybox.users SET disabled_at=now() WHERE id=$1',[f.humans[2]!.id]);
 const directory=await req(a.token,'GET','/v1/people');expect(directory.data).toHaveLength(2);
 expect(Object.keys(directory.data[0]).sort()).toEqual(['avatar_data','id','name']);
 const rows=(await req(b.token,'GET','/v1/projects')).data;expect(rows.map((p:any)=>p.id)).toEqual(expect.arrayContaining([pa.p.id,pb.p.id]));
 expect(rows.find((p:any)=>p.id===pb.p.id).can_edit).toBe(true);expect(rows.find((p:any)=>p.id===pa.p.id).can_edit).toBe(false);
 expect((await req(f.tokens.member_agent!,'GET','/v1/people')).status).toBe(403);
});
test('opposite account owners receive one lifetime agreement each; same state, cancel and re-agree preserve history and revision',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!;
 for(const [owner,actor] of [[a,b],[b,a]]){
  const {p}=await project(owner.token);expect((await inbox(owner.token)).data).toEqual({items:[],unread_count:0});
  const results=await Promise.all([agree(actor.token,p.id),agree(actor.token,p.id)]);expect(results.map(r=>r.status)).toEqual([200,200]);
  expect(results[0].data).toEqual({count:1,agreed:true,can_agree:true});
  expect((await req(owner.token,'GET',`/v1/projects/${p.id}/agreement`)).data).toEqual({count:1,agreed:false,can_agree:false});
  const event=(await inbox(owner.token)).data;expect(event.unread_count).toBeGreaterThan(0);expect(event.items.filter((v:any)=>v.project_id===p.id)).toHaveLength(1);
  expect(event.items.find((v:any)=>v.project_id===p.id)).toMatchObject({actor_id:actor.id,kind:'agreement',project_name:'Idea',agent_id:null});
  expect((await agree(actor.token,p.id,false)).data.count).toBe(0);expect((await agree(actor.token,p.id)).data.count).toBe(1);
  expect((await inbox(owner.token)).data.items.filter((v:any)=>v.project_id===p.id)).toHaveLength(1);
  expect((await req(owner.token,'GET',`/v1/projects/${p.id}`)).data.revision).toBe(1);
 }
});
test('cancel before first agreement does not suppress the first true event; each human counts once',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,c=f.humans[2]!,{p}=await project(a.token);
 expect((await agree(b.token,p.id,false)).data.count).toBe(0);expect((await inbox(a.token)).data.unread_count).toBe(0);
 await agree(b.token,p.id);await agree(c.token,p.id);expect((await agree(b.token,p.id)).data.count).toBe(2);expect((await inbox(a.token)).data.unread_count).toBe(2);
});
test('self and agents cannot express human agreement or use an inbox; request shape cannot forge actor or recipient',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,{p}=await project(a.token);
 expect((await agree(a.token,p.id)).status).toBe(403);expect((await agree(f.tokens.member_agent!,p.id)).status).toBe(403);
 expect((await inbox(f.tokens.member_agent!)).status).toBe(403);
 expect((await req(f.tokens.member_agent!,'POST','/v1/notifications/read',{ids:[]})).status).toBe(403);
 for(const body of [{agreed:1},{agreed:true,actor_id:a.id},{agreed:true,recipient_id:b.id}])expect((await req(b.token,'POST',`/v1/projects/${p.id}/agreement`,body)).status).toBe(400);
 for(const body of [{ids:[],recipient_id:b.id},{all:true},{ids:Array.from({length:101},()=>randomUUID())},{ids:['bad']}])expect((await req(a.token,'POST','/v1/notifications/read',body)).status).toBe(400);
});
test('inboxes and read states are recipient private, persist across migration, and only submitted visible ids are read',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,{p}=await project(a.token);await agree(b.token,p.id);
 const first=(await inbox(a.token)).data.items[0];expect((await inbox(b.token)).data.unread_count).toBe(0);
 await req(b.token,'POST','/v1/notifications/read',{ids:[first.id]});expect((await inbox(a.token)).data.unread_count).toBe(1);
 const input=envelope('comment_create',{project_id:p.id,body:'new message'},1);await req(b.token,'POST','/v1/commands',input);
 const read=await req(a.token,'POST','/v1/notifications/read',{ids:[first.id]});expect(read.data.unread_count).toBe(1);
 await migrate(admin);await migrate(admin);const saved=(await inbox(a.token)).data;expect(saved.items.find((x:any)=>x.id===first.id).read_at).toBeTruthy();
 expect((await req(a.token,'POST','/v1/notifications/read',{ids:saved.items.map((x:any)=>x.id)})).data.unread_count).toBe(0);
});
test('human and agent comments notify the owner atomically once on receipt replay, with no self alerts or synthesized history',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,{p}=await project(a.token);
 await req(a.token,'POST','/v1/commands',envelope('comment_create',{project_id:p.id,body:'own note'},1));
 expect((await inbox(a.token)).data.unread_count).toBe(0);
 await req(f.tokens.owner_agent!,'POST','/v1/commands',envelope('comment_create',{project_id:p.id,body:'own agent note'},2));expect((await inbox(a.token)).data.unread_count).toBe(0);
 const input=envelope('comment_create',{project_id:p.id,body:'agent observation'},3);
 const r=await req(f.tokens.member_agent!,'POST','/v1/commands',input);expect(r.status).toBe(200);expect(await req(f.tokens.member_agent!,'POST','/v1/commands',input)).toEqual(r);
 const messages=(await inbox(a.token)).data;expect(messages.items).toHaveLength(1);expect(messages.items[0]).toMatchObject({actor_id:b.id,actor_name:b.name,agent_id:f.agents[1]!.id,kind:'comment',comment_preview:'agent observation'});
 await migrate(admin);expect((await inbox(a.token)).data.items).toHaveLength(1);
});
test('notification insert failure rolls back comment, revision, activities and receipt',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,{p}=await project(a.token);
 await admin.query(`CREATE FUNCTION graybox.fail_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER fail_notice BEFORE INSERT ON graybox.notifications FOR EACH ROW EXECUTE FUNCTION graybox.fail_notice()`);
 const input=envelope('comment_create',{project_id:p.id,body:'will rollback'},1);expect((await req(b.token,'POST','/v1/commands',input)).status).toBe(500);
 expect((await admin.query('SELECT count(*)::int n FROM graybox.comments')).rows[0].n).toBe(0);
 expect((await req(a.token,'GET',`/v1/projects/${p.id}`)).data.revision).toBe(1);
 expect((await admin.query('SELECT count(*)::int n FROM graybox.idempotency WHERE key=$1',[input.idempotency_key])).rows[0].n).toBe(0);
 await admin.query('DROP TRIGGER fail_notice ON graybox.notifications');expect((await req(b.token,'POST','/v1/commands',input)).status).toBe(200);
});
test('scoped reads, live revocation and deleted projects are enforced before social operations',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,{p}=await project(a.token);
 expect((await req(f.tokens.restricted_agent!,'GET',`/v1/projects/${p.id}/agreement`)).status).toBe(404);
 const service=new Service(runtime),principal=await service.authenticate(b.token);await admin.query('UPDATE graybox.credentials SET revoked_at=now() WHERE id=$1',[principal.id]);
 await expect(service.agreement(principal,p.id,{agreed:true})).rejects.toMatchObject({status:401});
 await admin.query('UPDATE graybox.projects SET deleted_at=now() WHERE id=$1',[p.id]);expect((await agree(f.humans[2]!.token,p.id)).status).toBe(404);
});
test('creation undo detects external agreement dependency even after cancellation',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,{input,p}=await project(a.token);await agree(b.token,p.id);await agree(b.token,p.id,false);
 const preview=await req(a.token,'POST',`/v1/batches/${input.batch_id}/preview`,{});expect(preview.status).toBe(409);expect(preview.error.code).toBe('UNDO_DEPENDENCY');
});
test('runtime privileges and agreement notification failures keep changes atomic',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,{p}=await project(a.token);
 const perms=(await admin.query("SELECT has_table_privilege('graybox_runtime','graybox.notifications','DELETE') d,has_table_privilege('graybox_runtime','graybox.project_agreements','DELETE') a")).rows[0];expect(perms).toEqual({d:false,a:false});
 await admin.query('REVOKE INSERT ON graybox.notifications FROM graybox_runtime');expect((await agree(b.token,p.id)).status).toBe(500);
 expect((await admin.query('SELECT count(*)::int n FROM graybox.project_agreements')).rows[0].n).toBe(0);
 await admin.query('GRANT INSERT ON graybox.notifications TO graybox_runtime');expect((await agree(b.token,p.id)).data.count).toBe(1);
});

test('cursor pages reach older unread messages without exposing another inbox, deleted project history stays readable',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,{p}=await project(a.token);
 // Fixture expansion tests pagination; production migration never synthesizes history.
 for(let i=0;i<105;i++) {
  const command=envelope('comment_create',{project_id:p.id,body:'message '+i},i+1);
  expect((await req(b.token,'POST','/v1/commands',command)).status).toBe(200);
 }
 const first=(await inbox(a.token)).data;expect(first.items).toHaveLength(100);expect(first.unread_count).toBe(105);expect(first.next_cursor).toBeTruthy();
 const older=await req(a.token,'GET','/v1/notifications?before='+first.next_cursor);expect(older.data.items).toHaveLength(5);expect(new Set([...first.items,...older.data.items].map((x:any)=>x.id)).size).toBe(105);
 expect((await req(b.token,'GET','/v1/notifications?before='+first.next_cursor)).status).toBe(404);
 await admin.query('UPDATE graybox.projects SET deleted_at=now() WHERE id=$1',[p.id]);expect((await inbox(a.token)).data.items[0].project_available).toBe(false);
 expect((await req(a.token,'POST','/v1/notifications/read',{ids:older.data.items.map((x:any)=>x.id)})).data.unread_count).toBe(100);
});

test('real isolated cloud identities receive opposite-owned agreement and comment notifications privately',async()=>{
 await admin.query('DROP SCHEMA IF EXISTS graybox CASCADE');await migrate(admin);
 const boot=await bootstrapCloud(admin),cloud=await buildApp({pool:runtime,authPool:admin,mode:'cloud'});
 const call=async(token:string|undefined,method:'GET'|'POST',url:string,payload?:unknown)=>{const response=await cloud.inject({method,url,headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(payload!==undefined?{payload:JSON.stringify(payload)}:{})});expect(response.statusCode).toBe(200);return response.json().data;};
 try {
  const a=await call(undefined,'POST','/v1/auth/redeem',{code:boot.code,username:'alpha',password:'isolated test password',name:'Alpha'});
  const invite=await call(a.token,'POST','/v1/members/invite',{});
  const b=await call(undefined,'POST','/v1/auth/redeem',{code:invite.code,username:'beta',password:'isolated test password',name:'Beta'});
  const pa=await call(a.token,'POST','/v1/commands',envelope('project_create',{workspace_id:a.workspace_id,name:'Alpha idea'}));
  const pb=await call(b.token,'POST','/v1/commands',envelope('project_create',{workspace_id:b.workspace_id,name:'Beta idea'}));
  await call(b.token,'POST',`/v1/projects/${pa.id}/agreement`,{agreed:true});await call(a.token,'POST',`/v1/projects/${pb.id}/agreement`,{agreed:true});
  await call(b.token,'POST','/v1/commands',envelope('comment_create',{project_id:pa.id,body:'Cloud discussion'},1));
  const aInbox=await call(a.token,'GET','/v1/notifications'),bInbox=await call(b.token,'GET','/v1/notifications');expect(aInbox.unread_count).toBe(2);expect(bInbox.unread_count).toBe(1);
  expect(aInbox.items.every((n:any)=>n.project_id===pa.id&&n.actor_id===b.profile.id)).toBe(true);expect(bInbox.items[0].project_id).toBe(pb.id);
  const read=await call(a.token,'POST','/v1/notifications/read',{ids:aInbox.items.map((n:any)=>n.id)});expect(read.unread_count).toBe(0);
  expect((await call(b.token,'GET','/v1/notifications')).unread_count).toBe(1);
 } finally {await cloud.close();}
},30000);
test('an additive upgrade preserves legacy comments without generating retrospective notifications',async()=>{
 const a=f.humans[0]!,b=f.humans[1]!,{input,p}=await project(a.token);
 await admin.query('INSERT INTO graybox.comments(id,project_id,batch_id,author_id,body) VALUES($1,$2,$3,$4,$5)',[randomUUID(),p.id,input.batch_id,b.id,'Pre-upgrade legacy discussion']);
 await migrate(admin);expect((await inbox(a.token)).data.items).toEqual([]);expect((await req(a.token,'GET',`/v1/projects/${p.id}/comments`)).data).toHaveLength(1);
});
