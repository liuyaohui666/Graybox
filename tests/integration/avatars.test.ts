import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import {config} from 'dotenv';
import {buildApp} from '../../apps/api/src/app.ts';
import {migrate} from '../../packages/db/src/migrate.ts';
import {seedDatabase} from '../../packages/db/src/seed.ts';
import {Service} from '../../packages/core/src/service.ts';
import {bootstrapCloud} from '../../scripts/cloud-bootstrap.ts';
import {png} from '../fixtures/avatar.ts';
config({quiet:true});
for(const key of ['GRAYBOX_TEST_DATABASE_URL','GRAYBOX_TEST_ADMIN_URL'])if(new URL(process.env[key]!).pathname!=='/graybox_test')throw Error('Isolated test DB required');
const admin=new Pool({connectionString:process.env.GRAYBOX_TEST_ADMIN_URL}),runtime=new Pool({connectionString:process.env.GRAYBOX_TEST_DATABASE_URL});
let app:Awaited<ReturnType<typeof buildApp>>,f:Awaited<ReturnType<typeof seedDatabase>>;
const avatar=png(128);
async function req(method:'GET'|'POST',url:string,body?:unknown,token=f.humans[1]!.token){const r=await app.inject({method,url,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body!==undefined?{payload:JSON.stringify(body)}:{})});return {status:r.statusCode,...r.json()};}
beforeAll(async()=>{app=await buildApp({pool:runtime,mode:'local'});});
beforeEach(async()=>{await admin.query('DROP SCHEMA IF EXISTS graybox CASCADE');await migrate(admin);f=await seedDatabase(admin);});
afterAll(async()=>{await app.close();await runtime.end();await admin.end();});

test('nickname changes only the current human, persists and leaves credentials, roles and ownership intact',async()=>{
 const before=(await admin.query('SELECT id,role,username,password_hash FROM graybox.users ORDER BY id')).rows;
 const projects=(await admin.query('SELECT id,creator_id FROM graybox.projects ORDER BY id')).rows;
 const saved=await req('POST','/v1/profile/name',{name:'  江微雪的新昵称  '});
 expect(saved.status).toBe(200);expect(saved.data).toMatchObject({id:f.humans[1]!.id,name:'江微雪的新昵称'});
 expect(await req('POST','/v1/profile/name',{name:'江微雪的新昵称'})).toEqual(saved);
 await migrate(admin);
 expect((await req('GET','/v1/people')).data.find((p:any)=>p.id===f.humans[1]!.id).name).toBe('江微雪的新昵称');
 expect((await admin.query('SELECT id,role,username,password_hash FROM graybox.users ORDER BY id')).rows).toEqual(before);
 expect((await admin.query('SELECT id,creator_id FROM graybox.projects ORDER BY id')).rows).toEqual(projects);
 await expect(runtime.query('UPDATE graybox.users SET name=name')).rejects.toHaveProperty('code','42501');
});

test('nickname rejects agents, other identities, invalid names and revoked credentials',async()=>{
 expect((await req('POST','/v1/profile/name',{name:'No agent edits'},f.tokens.member_agent)).status).toBe(403);
 for(const body of [{name:''},{name:'  '},{name:'a'.repeat(101)},{name:'a\nb'},{name:'a\u0000b'},{name:'x',id:f.humans[0]!.id},{name:'x',role:'owner'}])expect((await req('POST','/v1/profile/name',body)).status).toBe(400);
 const service=new Service(runtime),p=await service.authenticate(f.humans[1]!.token);
 await admin.query('UPDATE graybox.credentials SET revoked_at=now() WHERE id=$1',[p.id]);
 await expect(service.setName(p,{name:'No revoked edits'})).rejects.toMatchObject({code:'UNAUTHORIZED'});
});
test('safe human directory and own avatar persist, retry, replay migration and reset',async()=>{
 const people=(await req('GET','/v1/people')).data;expect(people).toHaveLength(3);expect(Object.keys(people[0]).sort()).toEqual(['avatar_data','id','name']);
 const saved=await req('POST','/v1/profile/avatar',{avatar_data:avatar});expect(saved.status).toBe(200);expect(saved.data.id).toBe(f.humans[1]!.id);expect(saved.data.avatar_data).toBe(avatar);
 expect(await req('POST','/v1/profile/avatar',{avatar_data:avatar})).toEqual(saved);await migrate(admin);await migrate(admin);
 expect((await req('GET','/v1/people')).data.find((p:any)=>p.id===f.humans[1]!.id).avatar_data).toBe(avatar);
 expect((await req('GET','/v1/people')).data.find((p:any)=>p.id===f.humans[0]!.id).avatar_data).toBeNull();
 expect((await req('POST','/v1/profile/avatar',{avatar_data:null})).data.avatar_data).toBeNull();
});
test('agents and target identity fields cannot update or read personal directory',async()=>{
 expect((await req('GET','/v1/people',undefined,f.tokens.member_agent)).status).toBe(403);
 expect((await req('POST','/v1/profile/avatar',{avatar_data:avatar},f.tokens.member_agent)).status).toBe(403);
 for(const extra of [{human_id:f.humans[0]!.id},{id:f.humans[0]!.id},{role:'owner'}])expect((await req('POST','/v1/profile/avatar',{avatar_data:avatar,...extra})).status).toBe(400);
 await expect(runtime.query('UPDATE graybox.users SET name=name')).rejects.toHaveProperty('code','42501');
 await expect(runtime.query('SELECT password_hash FROM graybox.users')).rejects.toHaveProperty('code','42501');
});
test('avatar boundary rejects external/SVG/malformed/oversized and unsafe raster dimensions',async()=>{
 for(const bad of ['https://example.com/a.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,AAAA',png(127),png(257),avatar.slice(0,-8),'data:image/jpeg;base64,'+avatar.split(',')[1], 'data:image/png;base64,'+'A'.repeat(200000)])expect((await req('POST','/v1/profile/avatar',{avatar_data:bad})).status).toBe(400);
 expect((await req('GET','/v1/people')).data.every((p:any)=>p.avatar_data===null)).toBe(true);
 await expect(runtime.query('UPDATE graybox.users SET avatar_data=$1 WHERE id=$2',['https://bad',f.humans[1]!.id])).rejects.toHaveProperty('code','23514');
});
test('bounded JPEG signature/frame dimensions are accepted and spoofed/truncated frames rejected',async()=>{
 const jpeg=await readFile(new URL('../fixtures/avatar-128.jpg',import.meta.url)),data='data:image/jpeg;base64,'+jpeg.toString('base64');
 expect((await req('POST','/v1/profile/avatar',{avatar_data:data})).status).toBe(200);
 expect((await req('POST','/v1/profile/avatar',{avatar_data:'data:image/png;base64,'+jpeg.toString('base64')})).status).toBe(400);
 expect((await req('POST','/v1/profile/avatar',{avatar_data:'data:image/jpeg;base64,'+jpeg.subarray(0,-2).toString('base64')})).status).toBe(400);
});
test('revoked current principal cannot save or fetch directory',async()=>{
 const service=new Service(runtime),p=await service.authenticate(f.humans[1]!.token);await admin.query('UPDATE graybox.credentials SET revoked_at=now() WHERE id=$1',[p.id]);
 await expect(service.setAvatar(p,{avatar_data:avatar})).rejects.toMatchObject({code:'UNAUTHORIZED'});
 await expect(service.people(p)).rejects.toMatchObject({code:'UNAUTHORIZED'});
});
test('same runtime API saves cloud owner avatar and retains it after login',async()=>{
 await admin.query('DROP SCHEMA graybox CASCADE');await migrate(admin);const invite=await bootstrapCloud(admin);const cloud=await buildApp({pool:runtime,authPool:admin,mode:'cloud'});
 try {const login={username:'owner',password:'secure password here!'};const result=await cloud.inject({method:'POST',url:'/v1/auth/redeem',payload:{code:invite.code,name:'Real name',...login}});const user=result.json().data;
 const saved=await cloud.inject({method:'POST',url:'/v1/profile/avatar',headers:{authorization:'Bearer '+user.token},payload:{avatar_data:avatar}});expect(saved.statusCode).toBe(200);
 const renamed=await cloud.inject({method:'POST',url:'/v1/profile/name',headers:{authorization:'Bearer '+user.token},payload:{name:'Updated nickname'}});expect(renamed.statusCode).toBe(200);
 const again=(await cloud.inject({method:'POST',url:'/v1/auth/login',payload:login})).json().data;
 const directory=await cloud.inject({method:'GET',url:'/v1/people',headers:{authorization:'Bearer '+again.token}});expect(directory.json().data[0]).toMatchObject({id:user.profile.id,name:'Updated nickname',avatar_data:avatar});
 }finally{await cloud.close();}
});
