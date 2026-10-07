import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { buildApp } from '../../apps/api/src/app.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { seedDatabase,seedDemonstration } from '../../packages/db/src/seed.ts';

config({ quiet: true });
const url = process.env.GRAYBOX_TEST_DATABASE_URL;
const adminUrl = process.env.GRAYBOX_TEST_ADMIN_URL;
if (!url || !adminUrl || new URL(url).pathname !== '/graybox_test' || new URL(adminUrl).pathname !== '/graybox_test') throw new Error('Only isolated graybox_test is permitted');
const runtime = new Pool({ connectionString: url });
const admin = new Pool({ connectionString: adminUrl });
let app: Awaited<ReturnType<typeof buildApp>>;
let fixture: Awaited<ReturnType<typeof seedDatabase>>;
let token: string;
const batch = () => randomUUID();
const envelope = (type: string, payload: unknown, batch_id = batch(), expected_revision?: number) => ({ type, payload, batch_id, idempotency_key: randomUUID(), ...(expected_revision ? {expected_revision} : {}) });
async function req(method: 'GET'|'POST', path: string, body?: unknown, auth = token) {
  const r = await app.inject({method,url:path,headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},...(body === undefined ? {} : {payload:JSON.stringify(body)})});
  return {status:r.statusCode,...r.json()};
}
async function command(type:string,payload:unknown,batch_id=batch(),revision?:number,auth=token) { return req('POST','/v1/commands',envelope(type,payload,batch_id,revision),auth); }
async function project(batch_id=batch()) { return (await command('project_create',{workspace_id:fixture.workspace_id,name:'P'},batch_id)).data; }
async function experiment(project_id:string,batch_id=batch()) { return (await command('experiment_create',{project_id,series_name:'S',name:'E',goal:'G'},batch_id)).data; }
async function preview(id:string) { return req('POST',`/v1/batches/${id}/preview`,{}); }
async function undo(id:string,p: {data: {batch_revision:number;preview_token:string}},key=randomUUID()) { return req('POST',`/v1/batches/${id}/undo`,{expected_batch_revision:p.data.batch_revision,preview_token:p.data.preview_token,idempotency_key:key}); }

beforeAll(async()=> { await migrate(admin); app=await buildApp({pool:runtime,mode:'local'}); });
beforeEach(async()=> { await admin.query('DROP SCHEMA IF EXISTS graybox CASCADE'); await migrate(admin); fixture=await seedDatabase(admin); token=fixture.tokens.owner_agent; });
afterAll(async()=> { await app?.close(); await runtime.end(); await admin.end(); });

describe('real PostgreSQL M1 invariants',()=> {
  test('create retries produce one immutable entity/activity',async()=> {
    const body=envelope('project_create',{workspace_id:fixture.workspace_id,name:'A'});
    const first=await req('POST','/v1/commands',body);
    expect(first.status).toBe(200);
    expect(await req('POST','/v1/commands',body)).toEqual(first);
    expect((await admin.query('SELECT count(*)::int n FROM graybox.activities')).rows[0].n).toBe(1);
  });
  test('same key with changed payload conflicts',async()=> {
    const body=envelope('project_create',{workspace_id:fixture.workspace_id,name:'A'});
    await req('POST','/v1/commands',body);
    const r=await req('POST','/v1/commands',{...body,payload:{...body.payload as object,name:'B'}});
    expect(r.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });
  test('concurrent revision writers have exactly one winner',async()=> {
    const p=await project();
    const results=await Promise.all([command('project_update',{id:p.id,name:'A'},batch(),p.revision),command('project_update',{id:p.id,name:'B'},batch(),p.revision)]);
    expect(results.map(x=>x.status).sort()).toEqual([200,409]);
  });
  test('activity failure rolls back entity batch and idempotency',async()=> {
    await admin.query("CREATE FUNCTION graybox.fail_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected activity failure'; END $$; CREATE TRIGGER fail_activity BEFORE INSERT ON graybox.activities FOR EACH ROW EXECUTE FUNCTION graybox.fail_activity()");
    expect((await command('project_create',{workspace_id:fixture.workspace_id,name:'A'})).status).toBe(500);
    for(const t of ['projects','batches','idempotency']) expect((await admin.query(`SELECT count(*)::int n FROM graybox.${t}`)).rows[0].n).toBe(0);
  });
  test('forged actor rejected and final judgment fields cannot be written',async()=> {
    const body=envelope('project_create',{workspace_id:fixture.workspace_id,name:'A'});
    expect((await req('POST','/v1/commands',{...body,actor_id:randomUUID()})).status).toBe(400);
    const p=await project(); const e=await experiment(p.id);
    expect((await command('experiment_update',{id:e.id,status:'validated'},batch(),e.revision)).status).toBe(400);
    expect((await command('experiment_update',{id:e.id,rating:5},batch(),e.revision)).status).toBe(400);
  });
  test('restricted credential cannot list get or modify outside scope',async()=> {
    const p=await project(); const e=await experiment(p.id);
    const limited=fixture.tokens.restricted_agent;
    expect((await req('GET','/v1/projects',undefined,limited)).data).toEqual([]);
    expect((await req('GET',`/v1/experiments/${e.id}`,undefined,limited)).status).toBe(403);
    expect((await command('project_update',{id:p.id,name:'No'},batch(),p.revision,limited)).status).toBe(403);
  });
  test('revoked credentials are rejected',async()=> {
    await admin.query("UPDATE graybox.credentials SET revoked_at=now() WHERE label='owner_agent'");
    expect((await req('GET','/v1/me')).status).toBe(401);
  });
  test('concurrent series creates allocate distinct ordered versions',async()=> {
    const p=await project(); const e=await experiment(p.id);
    const results=await Promise.all([command('experiment_create',{project_id:p.id,series_id:e.series_id,name:'A',goal:'G'}),command('experiment_create',{project_id:p.id,series_id:e.series_id,name:'B',goal:'G'})]);
    expect(results.map(x=>x.data.version).sort()).toEqual([2,3]);
  });
  test('multi entity repeated entity undo restores first value with increasing revision',async()=> {
    const p=await project(); const b=batch();
    const u=await command('project_update',{id:p.id,name:'A'},b,p.revision);
    const v=await command('project_update',{id:p.id,name:'B'},b,u.data.revision);
    const e=await experiment(p.id,b);
    const pr=await preview(b); expect(pr.status).toBe(200);
    expect((await undo(b,pr)).status).toBe(200);
    const restored=await req('GET',`/v1/projects/${p.id}`);
    expect(restored.data.name).toBe('P'); expect(restored.data.revision).toBe(v.data.revision+1);
    expect((await req('GET',`/v1/experiments/${e.id}`)).status).toBe(404);
  });
  test('later update even same value blocks whole undo',async()=> {
    const b=batch(); const p=await project(b); const e=await experiment(p.id,b);
    await command('experiment_update',{id:e.id,name:e.name},batch(),e.revision);
    const pr=await preview(b); expect(pr.status).toBe(409);
    expect((await req('GET',`/v1/projects/${p.id}`)).status).toBe(200);
  });
  test('preview execute race blocks all compensation',async()=> {
    const b=batch(); const p=await project(b); const pr=await preview(b);
    await command('project_update',{id:p.id,name:'later'},batch(),p.revision);
    expect((await undo(b,pr)).status).toBe(409);
    expect((await req('GET',`/v1/projects/${p.id}`)).data.name).toBe('later');
  });
  test('external child blocks project undo',async()=> {
    const b=batch(); const p=await project(b); const pr=await preview(b); await experiment(p.id);
    expect((await undo(b,pr)).status).toBe(409);
  });
  test('submission snapshot stays fixed and submitted closed batch retry succeeds',async()=> {
    const p=await project(); const b=batch(); let e=await experiment(p.id,b);
    e=(await command('evidence_append',{experiment_id:e.id,type:'git',source_kind:'agent_reported',result:'not_run',details:{commits:[{sha:'abcdef0'}]}},b,e.revision)).data;
    const body=envelope('review_submit',{experiment_id:e.id},b,e.revision);
    const submitted=await req('POST','/v1/commands',body); expect(submitted.status).toBe(200);
    expect(await req('POST','/v1/commands',body)).toEqual(submitted);
    const snapshot=(await req('GET',`/v1/experiments/${e.id}`)).data.submissions[0].snapshot;
    await command('experiment_update',{id:e.id,summary:'later',status:'experimenting'},batch(),submitted.data.revision);
    expect((await req('GET',`/v1/experiments/${e.id}`)).data.submissions[0].snapshot).toEqual(snapshot);
    expect(snapshot.commits).toEqual([{sha:'abcdef0'}]);
  });
  test('schema grants deny audit mutation evidence mutation and DDL',async()=> {
    for(const sql of ['DELETE FROM graybox.activities','UPDATE graybox.activities SET type=type','DELETE FROM graybox.evidence','CREATE TABLE graybox.bad(id int)','CREATE TABLE public.bad(id int)']) {
      await expect(runtime.query(sql)).rejects.toHaveProperty('code','42501');
    }
  });
  test('agent batch ownership and principal scoped keys',async()=> {
    const body=envelope('project_create',{workspace_id:fixture.workspace_id,name:'A'}); await req('POST','/v1/commands',body);
    expect((await req('POST','/v1/commands',{...body,idempotency_key:randomUUID()},fixture.tokens.member_agent)).status).toBe(403);
    expect((await req('POST','/v1/commands',{...body,batch_id:batch()},fixture.tokens.member_agent)).status).toBe(200);
    expect((await req('POST',`/v1/batches/${body.batch_id}/preview`,{},fixture.tokens.member_agent)).status).toBe(403);
  });
  test('strict evidence payload rejects unknown facts',async()=> {
    const p=await project(); const e=await experiment(p.id);
    expect((await command('evidence_append',{experiment_id:e.id,type:'test',source_kind:'agent_reported',result:'passed',details:{command:'test',summary:'reported',rating:5}},batch(),e.revision)).status).toBe(400);
  });
  test('undo retry returns exact compensation and audit stays appended',async()=> {
    const b=batch(); await project(b); const pr=await preview(b); const key=randomUUID(); const first=await undo(b,pr,key);
    expect(await undo(b,pr,key)).toEqual(first);
    expect((await admin.query('SELECT count(*)::int n FROM graybox.activities')).rows[0].n).toBe(2);
  });
  test('undo evidence and submission uses append-only tombstones and restores experiment',async()=> {
    const p=await project();const e=await experiment(p.id);const b=batch();
    const changed=(await command('evidence_append',{experiment_id:e.id,type:'test',source_kind:'agent_reported',result:'not_run',details:{command:'demo',summary:'demonstration only'}},b,e.revision)).data;
    await command('review_submit',{experiment_id:e.id},b,changed.revision);
    const pr=await preview(b);expect(pr.status).toBe(200);expect((await undo(b,pr)).status).toBe(200);
    const restored=(await req('GET',`/v1/experiments/${e.id}`)).data;
    expect(restored.status).toBe('idea');expect(restored.evidence).toEqual([]);expect(restored.submissions).toEqual([]);expect(restored.revision).toBe(4);
    expect((await admin.query('SELECT count(*)::int n FROM graybox.evidence')).rows[0].n).toBe(1);
    expect((await admin.query('SELECT count(*)::int n FROM graybox.submissions')).rows[0].n).toBe(1);
  });
  test('concurrent same key creates once across separate connections',async()=> {
    const body=envelope('project_create',{workspace_id:fixture.workspace_id,name:'Race'});
    const results=await Promise.all([req('POST','/v1/commands',body),req('POST','/v1/commands',body)]);
    expect(results[0]).toEqual(results[1]);expect(results[0].status).toBe(200);
    expect((await admin.query('SELECT count(*)::int n FROM graybox.projects')).rows[0].n).toBe(1);
  });
  test('canonical reordered keys return original response',async()=> {
    const body=envelope('project_create',{workspace_id:fixture.workspace_id,name:'Canonical'});
    const first=await req('POST','/v1/commands',body);
    expect(await req('POST','/v1/commands',{payload:{name:'Canonical',workspace_id:fixture.workspace_id},type:body.type,batch_id:body.batch_id,idempotency_key:body.idempotency_key})).toEqual(first);
  });
  test('expired and 50 operation batches reject without side effects',async()=> {
    const b=batch();const p=await project(b);
    await admin.query('UPDATE graybox.batches SET operation_count=50 WHERE id=$1',[b]);
    expect((await command('project_update',{id:p.id,name:'blocked'},b,p.revision)).error.code).toBe('BATCH_CLOSED');
    await admin.query("UPDATE graybox.batches SET operation_count=1,created_at=now()-interval '31 minutes' WHERE id=$1",[b]);
    expect((await command('project_update',{id:p.id,name:'expired'},b,p.revision)).error.code).toBe('BATCH_CLOSED');
    expect((await req('GET',`/v1/projects/${p.id}`)).data.name).toBe('P');
  });
  test('preview tampering and undo age are rejected',async()=> {
    const b=batch();await project(b);const pr=await preview(b);
    expect((await undo(b,{data:{...pr.data,preview_token:pr.data.preview_token+'x'}})).error.code).toBe('PREVIEW_INVALID');
    await admin.query("UPDATE graybox.batches SET created_at=now()-interval '31 days' WHERE id=$1",[b]);
    expect((await undo(b,pr)).error.code).toBe('UNDO_UNAVAILABLE');
  });
  test('existing series stays and numbering stays monotonic after creation undo',async()=> {
    const p=await project();const first=await experiment(p.id);const b=batch();
    const second=(await command('experiment_create',{project_id:p.id,series_id:first.series_id,name:'Second',goal:'G'},b)).data;
    const pr=await preview(b);expect((await undo(b,pr)).status).toBe(200);
    const third=(await command('experiment_create',{project_id:p.id,series_id:first.series_id,name:'Third',goal:'G'})).data;
    expect(third.version).toBe(second.version+1);
  });
  test('restricted credential authorized project positive path and scoped undo',async()=> {
    const p=await project();await admin.query("UPDATE graybox.credentials SET project_ids=$1 WHERE label='restricted_agent'",[JSON.stringify([p.id])]);
    const limited=fixture.tokens.restricted_agent;const b=batch();
    const e=(await command('experiment_create',{project_id:p.id,series_name:'Scoped',name:'Scoped',goal:'G'},b,undefined,limited)).data;
    expect((await req('GET',`/v1/experiments/${e.id}`,undefined,limited)).status).toBe(200);
    const pr=await req('POST',`/v1/batches/${b}/preview`,{},limited);expect(pr.status).toBe(200);
    await admin.query("UPDATE graybox.credentials SET project_ids='[]' WHERE label='restricted_agent'");
    expect((await req('POST',`/v1/batches/${b}/undo`,{expected_batch_revision:pr.data.batch_revision,preview_token:pr.data.preview_token,idempotency_key:randomUUID()},limited)).status).toBe(403);
  });
  test('production authentication fails closed',async()=> {
    await expect(buildApp({pool:runtime,mode:'production'})).rejects.toThrow('Production start disabled');
  });
  test('demonstration seed uses domain commands and records only unrun placeholders',async()=> {
    await seedDemonstration(runtime,fixture.workspace_id,token);
    const projects=(await req('GET','/v1/projects')).data;
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toContain('demonstration');
    const experiments=(await req('GET',`/v1/experiments?project_id=${projects[0].id}`)).data;
    expect(experiments[0].status).toBe('waiting_for_review');
    const e=(await req('GET',`/v1/experiments/${experiments[0].id}`)).data;
    expect(e.evidence[0].result).toBe('not_run');expect(e.submissions[0].snapshot.evidence[0].result).toBe('not_run');
  });
  test('malformed signature encodings reject safely without internal errors',async()=> {
    const b=batch();await project(b);const pr=await preview(b);const [payload,signature]=pr.data.preview_token.split('.');
    const malformed={data:{...pr.data,preview_token:`${payload}.é${signature.slice(1)}`}};
    expect((await undo(b,malformed)).error.code).toBe('PREVIEW_INVALID');
    expect((await undo(b,{data:{...pr.data,preview_token:pr.data.preview_token+'.extra'}})).error.code).toBe('PREVIEW_INVALID');
  });
});
