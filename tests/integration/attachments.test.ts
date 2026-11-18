import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {Pool} from 'pg';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {config} from 'dotenv';
import {buildApp} from '../../apps/api/src/app.ts';
import {migrate} from '../../packages/db/src/migrate.ts';
import {seedDatabase} from '../../packages/db/src/seed.ts';
import {png} from '../fixtures/avatar.ts';
import {Service} from '../../packages/core/src/service.ts';
import {Attachments,parseAttachmentMetadata} from '../../packages/core/src/attachments.ts';
vi.mock('node:fs/promises',async original=>{const actual=await original<typeof import('node:fs/promises')>();return {...actual,open:vi.fn(actual.open)};});
config({quiet:true});
for(const key of ['GRAYBOX_TEST_DATABASE_URL','GRAYBOX_TEST_ADMIN_URL'])if(new URL(process.env[key]!).pathname!=='/graybox_test')throw Error('Isolated test DB required');
const admin=new Pool({connectionString:process.env.GRAYBOX_TEST_ADMIN_URL}),runtime=new Pool({connectionString:process.env.GRAYBOX_TEST_DATABASE_URL});
let app:Awaited<ReturnType<typeof buildApp>>,f:Awaited<ReturnType<typeof seedDatabase>>,dir:string,projectId:string;
const arrivals=new Map<string,()=>void>(),aborts=new Map<string,()=>void>();
const bytes=Buffer.from(png(128).split(',')[1]!,'base64');
function meta(overrides={}) {return {idempotency_key:crypto.randomUUID(),entity_type:'project',entity_id:projectId,kind:'image',name:'示例.png',caption:'test',sha256:createHash('sha256').update(bytes).digest('hex'),...overrides};}
function upload(metadata=meta(),token=f.humans[0]!.token,payload=bytes){return app.inject({method:'POST',url:'/v1/attachments/upload',headers:{authorization:`Bearer ${token}`,'content-type':'application/octet-stream','x-graybox-metadata':Buffer.from(JSON.stringify(metadata)).toString('base64url')},payload});}
function get(url:string,token=f.humans[0]!.token){return app.inject({method:'GET',url,headers:{authorization:`Bearer ${token}`}});}
beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),'graybox-attachments-'));process.env.GRAYBOX_ATTACHMENT_DIR=dir;app=await buildApp({pool:runtime,mode:'local'});app.addHook('onRequest',async r=>{arrivals.get(String(r.headers['x-upload-test-ready']))?.();});app.addHook('onRequestAbort',async r=>{aborts.get(String(r.headers['x-upload-test-ready']))?.();});});
beforeEach(async()=>{await admin.query('DROP SCHEMA IF EXISTS graybox CASCADE');await migrate(admin);f=await seedDatabase(admin);const service=new Service(runtime);const p=await service.authenticate(f.humans[0]!.token);projectId=(await service.command(p,{type:'project_create',payload:{workspace_id:f.workspace_id,name:'Attachments'},batch_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID()})).id;});
afterAll(async()=>{await app.close();await runtime.end();await admin.end();await rm(dir,{recursive:true,force:true});delete process.env.GRAYBOX_ATTACHMENT_DIR;});
test('authenticated upload, stable retry, immutable content and additive migration',async()=>{
 const metadata=meta(),saved=await upload(metadata);expect(saved.statusCode).toBe(200);const a=saved.json().data;
 expect(a).toMatchObject({entity_id:projectId,kind:'image',mime_type:'image/png',byte_size:bytes.length,sha256:metadata.sha256,url:null,target_revision:1});
 expect((await upload(metadata)).json()).toEqual(saved.json());
 expect((await upload({...metadata,caption:'different'})).statusCode).toBe(409);
 const content=await get(`/v1/attachments/${a.id}/content`);expect(content.statusCode).toBe(200);expect(content.rawPayload).toEqual(bytes);expect(content.headers['x-content-type-options']).toBe('nosniff');
 await migrate(admin);expect((await get(`/v1/attachments?entity_type=project&entity_id=${projectId}`)).json().data).toHaveLength(1);
 await expect(runtime.query('UPDATE graybox.attachments SET caption=caption')).rejects.toHaveProperty('code','42501');
});
test('missing credential, permission, digest and invalid bytes leave metadata untouched',async()=>{
 expect((await upload(meta(),'missing')).statusCode).toBe(401);
 expect((await upload(meta({sha256:'a'.repeat(64)}))).statusCode).toBe(400);
 expect((await upload(meta({name:'../evil.png'}))).statusCode).toBe(400);
 expect((await upload(meta(),f.humans[2]!.token)).statusCode).toBe(403);
 expect(Number((await admin.query('SELECT count(*) n FROM graybox.attachments')).rows[0].n)).toBe(0);
});
test('scope shrink prevents list, content and retry',async()=>{
 const metadata=meta(),saved=await upload(metadata,f.tokens.owner_agent);expect(saved.statusCode).toBe(200);const a=saved.json().data;
 await admin.query('UPDATE graybox.credentials SET project_ids=$1 WHERE token_hash=$2',[[],createHash('sha256').update(f.tokens.owner_agent).digest('hex')]);
 expect((await get(`/v1/attachments/${a.id}/content`,f.tokens.owner_agent)).statusCode).toBe(404);
 expect((await upload(metadata,f.tokens.owner_agent)).statusCode).toBe(404);
 expect((await get(`/v1/attachments?entity_type=project&entity_id=${projectId}`,f.tokens.owner_agent)).statusCode).toBe(404);
});
test('HTML direct content cannot execute same origin and links contain no file',async()=>{
 const html=Buffer.from('<!doctype html><html><button onclick="this.innerText=123">click</button></html>');
 const saved=await upload(meta({kind:'demo',name:'demo.html',sha256:createHash('sha256').update(html).digest('hex')}),f.humans[0]!.token,html);expect(saved.statusCode).toBe(200);
 const content=await get(`/v1/attachments/${saved.json().data.id}/content`);expect(content.headers['content-disposition']).toContain('attachment');expect(content.headers['content-security-policy']).toContain('sandbox');
 const body={idempotency_key:crypto.randomUUID(),entity_type:'project',entity_id:projectId,name:'Repository',caption:'',kind:'repository',url:'https://github.com/example/repo'};
 const link=await app.inject({method:'POST',url:'/v1/attachments/link',headers:{authorization:`Bearer ${f.humans[0]!.token}`},payload:body});expect(link.statusCode).toBe(200);expect(link.json().data.byte_size).toBe(0);
 expect((await get(`/v1/attachments/${link.json().data.id}/content`)).statusCode).toBe(404);
});
test('video supports authenticated bounded byte ranges',async()=>{
 const video=Buffer.concat([Buffer.from('000000186674797069736f6d0000000069736f6d6d703432','hex'),Buffer.from('000000086d646174','hex')]);
 const saved=await upload(meta({kind:'video',name:'test.mp4',sha256:createHash('sha256').update(video).digest('hex')}),f.humans[0]!.token,video);expect(saved.statusCode).toBe(200);
 const url=`/v1/attachments/${saved.json().data.id}/content`;
 const range=await app.inject({url,headers:{authorization:`Bearer ${f.humans[0]!.token}`,range:'bytes=8-15'}});expect(range.statusCode).toBe(206);expect(range.rawPayload).toEqual(video.subarray(8,16));
 expect((await app.inject({url,headers:{authorization:`Bearer ${f.humans[0]!.token}`,range:'bytes=999-'}})).statusCode).toBe(416);
});
test('quota is serialized and failed metadata write removes installed bytes',async()=>{
 const service=new Service(runtime),p=await service.authenticate(f.humans[0]!.token),attachments=new Attachments(runtime,service,dir,bytes.length);
 const metadata=parseAttachmentMetadata(meta());await attachments.upload(p,metadata,bytes);
 await expect(attachments.upload(p,parseAttachmentMetadata(meta()),bytes)).rejects.toMatchObject({code:'QUOTA_EXCEEDED'});
 const before=await readdir(dir);
 await admin.query("CREATE FUNCTION graybox.reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$; CREATE TRIGGER reject_receipt BEFORE INSERT ON graybox.attachment_receipts FOR EACH ROW EXECUTE FUNCTION graybox.reject_receipt()");
 await expect(new Attachments(runtime,service,dir).upload(p,parseAttachmentMetadata(meta()),bytes)).rejects.toThrow();
 expect(await readdir(dir)).toEqual(before);expect(Number((await admin.query('SELECT count(*) n FROM graybox.attachments')).rows[0].n)).toBe(1);
});
test('a failed file durability flush refuses the receipt and cleans staged bytes',async()=>{
 const before=await readdir(dir),original=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).open;
 const spy=vi.mocked(fs.open).mockImplementation(async(...args:Parameters<typeof fs.open>)=>{const handle=await original(...args);vi.spyOn(handle,'sync').mockRejectedValue(new Error('injected durability failure'));return handle;});
 try{expect((await upload()).statusCode).toBe(500);expect(Number((await admin.query('SELECT count(*) n FROM graybox.attachments')).rows[0].n)).toBe(0);expect(await readdir(dir)).toEqual(before);}finally{spy.mockRestore();}
});
test('Linux directory durability failure rolls back immutable bytes and metadata',async()=>{
 const before=await readdir(dir),original=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).open,platform=process.platform;
 const spy=vi.mocked(fs.open).mockImplementation(async(...args:Parameters<typeof fs.open>)=>args[0]===dir?{sync:async()=>{throw new Error('injected directory durability failure');},close:async()=>{}} as unknown as Awaited<ReturnType<typeof fs.open>>:original(...args));
 Object.defineProperty(process,'platform',{value:'linux'});
 try{expect((await upload()).statusCode).toBe(500);expect(Number((await admin.query('SELECT count(*) n FROM graybox.attachments')).rows[0].n)).toBe(0);expect(await readdir(dir)).toEqual(before);}finally{Object.defineProperty(process,'platform',{value:platform});spy.mockRestore();}
});
test('waiting for shared lock rechecks a revoked credential before storing bytes',async()=>{
 const service=new Service(runtime),p=await service.authenticate(f.humans[0]!.token),attachments=new Attachments(runtime,service,dir),before=await readdir(dir),blocker=await admin.connect();
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(77321)');
  const pending=attachments.upload(p,parseAttachmentMetadata(meta()),bytes),observed=expect(pending).rejects.toMatchObject({code:'UNAUTHORIZED'});
  await blocker.query('UPDATE graybox.credentials SET revoked_at=now() WHERE id=$1',[p.id]);await blocker.query('COMMIT');await observed;
  expect(await readdir(dir)).toEqual(before);
 }finally{await blocker.query('ROLLBACK');blocker.release();}
});
test('independent ideas remain inaccessible to scoped agents and ownership governs upload',async()=>{
 const service=new Service(runtime),owner=await service.authenticate(f.humans[0]!.token);
 const idea=await service.command(owner,{type:'idea_create',payload:{workspace_id:f.workspace_id,name:'Private idea',body:'Example'},batch_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID()});
 const metadata=meta({entity_type:'idea',entity_id:idea.id});
 const saved=await upload(metadata);expect(saved.statusCode).toBe(200);
 expect((await upload(meta({entity_type:'idea',entity_id:idea.id}),f.humans[1]!.token)).statusCode).toBe(403);
 expect((await get(`/v1/attachments/${saved.json().data.id}/content`,f.tokens.restricted_agent)).statusCode).toBe(404);
 expect((await get(`/v1/attachments?entity_type=idea&entity_id=${idea.id}`,f.tokens.restricted_agent)).statusCode).toBe(404);
});
test('only two authenticated upload bodies may be buffered and abort frees capacity',async()=>{
 const address=await app.listen({host:'127.0.0.1',port:0});
 const ready:Promise<void>[]=[],closed:Promise<void>[]=[],keys:string[]=[];
 const pending=Array.from({length:2},()=>{const key=crypto.randomUUID();keys.push(key);ready.push(new Promise(r=>arrivals.set(key,r)));closed.push(new Promise(r=>aborts.set(key,r)));const request=httpRequest(`${address}/v1/attachments/upload`,{method:'POST',headers:{authorization:`Bearer ${f.humans[0]!.token}`,'content-type':'application/octet-stream','content-length':bytes.length,'x-upload-test-ready':key,'x-graybox-metadata':Buffer.from(JSON.stringify(meta())).toString('base64url')}});request.on('error',()=>{});request.write(bytes.subarray(0,1));return request;});
 try{await Promise.all(ready);expect((await upload()).statusCode).toBe(429);}finally{for(const request of pending)request.destroy();}
 await Promise.all(closed);for(const key of keys){arrivals.delete(key);aborts.delete(key);}expect((await upload()).statusCode).toBe(200);
});
test('short demo preview capability isolates scripts and rechecks scope, revocation and expiration',async()=>{
 const html=Buffer.from('<!doctype html><html><button onclick="this.innerText=123">click</button></html>');
 const saved=await upload(meta({kind:'demo',name:'preview.html',sha256:createHash('sha256').update(html).digest('hex')}),f.tokens.owner_agent,html);expect(saved.statusCode).toBe(200);
 const create=()=>app.inject({method:'POST',url:`/v1/attachments/${saved.json().data.id}/preview`,headers:{authorization:`Bearer ${f.tokens.owner_agent}`},payload:{}});
 const created=await create();expect(created.statusCode).toBe(200);const url=created.json().data.url;
 const viewed=await app.inject({url});expect(viewed.statusCode).toBe(200);expect(viewed.rawPayload).toEqual(html);
 expect(viewed.headers['content-security-policy']).toContain("sandbox allow-scripts;");expect(viewed.headers['content-security-policy']).toContain("connect-src 'none'");expect(viewed.headers['content-security-policy']).not.toContain('allow-same-origin');expect(viewed.headers['referrer-policy']).toBe('no-referrer');expect(viewed.headers['content-disposition']).toBeUndefined();
 expect((await app.inject({url:'/v1/attachment-previews/'+ 'a'.repeat(64)})).statusCode).toBe(401);
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+61000);try{expect((await app.inject({url})).statusCode).toBe(401);}finally{clock.mockRestore();}
 const revokedUrl=(await create()).json().data.url;
 await admin.query('UPDATE graybox.credentials SET project_ids=$1 WHERE token_hash=$2',[[],createHash('sha256').update(f.tokens.owner_agent).digest('hex')]);expect((await app.inject({url:revokedUrl})).statusCode).toBe(404);
 await admin.query('UPDATE graybox.credentials SET project_ids=NULL,revoked_at=now() WHERE token_hash=$1',[createHash('sha256').update(f.tokens.owner_agent).digest('hex')]);expect((await app.inject({url:revokedUrl})).statusCode).toBe(401);
});
