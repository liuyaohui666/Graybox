import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { openLocalDatabase } from '../../../packages/local-db/src/index.ts';
const app=Fastify({logger:false});
const db=await openLocalDatabase(process.env.GRAYBOX_DATA_ROOT||'D:/Graybox');
const now=()=>new Date().toISOString();
const wrap=(data:unknown)=>({data});
function project(row:any){return {...JSON.parse(row.data),id:row.id,revision:1,created_at:row.created_at,updated_at:row.updated_at,workspace_id:'local-workspace',creator_id:'local-user',can_edit:true,owner_id:'local-user',priority:'medium',status:'active',lifecycle:'in_progress',tags:[]};}
function experiment(row:any){return {...JSON.parse(row.data),id:row.id,revision:1,project_id:row.project_id,created_at:row.created_at,updated_at:row.updated_at,owner_id:'local-user',owner_name:'本地用户',can_edit:true,progress:'in_progress',priority:'medium',outcome:'inconclusive',status:'experimenting',series_id:row.id};}
app.get('/v1/health',async()=>wrap({environment_id:'local-sqlite',mode:'local'}));
app.get('/v1/me',async()=>wrap({id:'local-user',name:'本地用户',role:'owner',kind:'human'}));
app.get('/v1/people',async()=>wrap([{id:'local-user',name:'本地用户',role:'owner',avatar_data:null}]));
app.get('/v1/workspaces',async()=>wrap([{id:'local-workspace',name:'我的 Graybox'}]));
app.get('/v1/projects',async()=>wrap(db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map(project)));
app.get('/v1/experiments',async()=>wrap(db.prepare('SELECT * FROM experiments ORDER BY updated_at DESC').all().map(experiment)));
app.get('/v1/ideas',async()=>wrap(db.prepare('SELECT * FROM ideas ORDER BY updated_at DESC').all().map((r:any)=>({...JSON.parse(r.data),id:r.id,revision:1,project_id:r.project_id,created_at:r.created_at,updated_at:r.updated_at,owner_id:'local-user',owner_name:'本地用户',can_edit:true,status:'idea',priority:'medium',tags:[]}))));
app.get('/v1/activity',async()=>wrap(db.prepare('SELECT * FROM activities ORDER BY created_at DESC LIMIT 100').all().map((r:any)=>({...JSON.parse(r.data),id:r.id,created_at:r.created_at,entity_type:r.entity_type,entity_id:r.entity_id,project_id:null,human_id:'local-user'}))));
app.get('/v1/notifications',async()=>wrap([]));
app.get('/v1/collaboration/notifications',async()=>wrap({items:[],unread_count:0}));
app.post('/v1/profile/name',async(req:any)=>wrap({id:'local-user',name:String(req.body?.name||'本地用户'),role:'owner'}));
app.post('/v1/profile/avatar',async()=>wrap({id:'local-user',name:'本地用户',avatar_data:null}));
app.get('/v1/attachments',async()=>wrap([]));
app.post('/v1/commands',async(req:any)=>{const cmd=req.body as any,p=cmd.payload||{},id=randomUUID(),time=now();db.exec('BEGIN');try{if(cmd.type==='project_create'){db.prepare('INSERT INTO projects(id,name,data,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,p.name,JSON.stringify({name:p.name,description:p.description||'',status:'active'}),time,time);db.prepare('INSERT INTO activities(id,entity_type,entity_id,data,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),'project',id,JSON.stringify({type:'project_create',name:p.name}),time);db.exec('COMMIT');return wrap(project({id,name:p.name,data:JSON.stringify({name:p.name,description:p.description||''}),created_at:time,updated_at:time}));}
if(cmd.type==='experiment_create'){const series=randomUUID();db.prepare('INSERT INTO experiments(id,project_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,p.project_id,p.name,JSON.stringify({name:p.name,goal:p.goal||'',summary:'',change_summary:'',series_id:series,status:'experimenting'}),time,time);db.exec('COMMIT');return wrap(experiment({id,project_id:p.project_id,name:p.name,data:JSON.stringify({name:p.name,goal:p.goal||'',summary:'',change_summary:'',series_id:series,status:'experimenting'}),created_at:time,updated_at:time}));}
if(cmd.type==='idea_create'){db.prepare('INSERT INTO ideas(id,project_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,p.project_id??null,p.name,JSON.stringify({name:p.name,body:p.body||''}),time,time);db.exec('COMMIT');return wrap({id,name:p.name,body:p.body||'',project_id:p.project_id??null,revision:1,owner_id:'local-user',can_edit:true,status:'idea',created_at:time,updated_at:time});}
if(cmd.type==='project_update'){const row=db.prepare('SELECT * FROM projects WHERE id=?').get(p.id) as any;if(!row){db.exec('ROLLBACK');return {error:{code:'NOT_FOUND',message:'项目不存在。'}};}const data={...JSON.parse(row.data),...(p.description!==undefined?{description:p.description}:{}),...(p.name!==undefined?{name:p.name}:{}),...(p.priority!==undefined?{priority:p.priority}:{}),...(p.status!==undefined?{status:p.status}:{})};db.prepare('UPDATE projects SET name=?,data=?,updated_at=? WHERE id=?').run(data.name,JSON.stringify(data),time,p.id);db.exec('COMMIT');return wrap(project({id:p.id,name:data.name,data:JSON.stringify(data),created_at:row.created_at,updated_at:time}));}
if(cmd.type==='experiment_update'){const row=db.prepare('SELECT * FROM experiments WHERE id=?').get(p.id) as any;if(!row){db.exec('ROLLBACK');return {error:{code:'NOT_FOUND',message:'实验不存在。'}};}const data={...JSON.parse(row.data),...p};db.prepare('UPDATE experiments SET name=?,data=?,updated_at=? WHERE id=?').run(data.name,JSON.stringify(data),time,p.id);db.exec('COMMIT');return wrap(experiment({id:p.id,project_id:row.project_id,name:data.name,data:JSON.stringify(data),created_at:row.created_at,updated_at:time}));}
db.exec('ROLLBACK');return {error:{code:'NOT_SUPPORTED',message:'本地版暂未支持此命令。'}};}catch(e){db.exec('ROLLBACK');return {error:{code:'LOCAL_WRITE_FAILED',message:String(e)}};}});
app.get('/__graybox/profiles',async()=>[{id:'local-user',name:'本地用户',role:'owner'}]);
await app.listen({host:'127.0.0.1',port:4318});
console.log('Graybox standalone SQLite API listening on http://127.0.0.1:4318');
