#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args=process.argv.slice(2);
const root=resolve(args.find((v,i)=>v==='--root'?args[i+1]:undefined)||process.env.GRAYBOX_DATA_ROOT||'D:/Graybox');
mkdirSync(root,{recursive:true});
const db=new DatabaseSync(resolve(root,'graybox.sqlite'));
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ideas(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),name TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,relative_path TEXT NOT NULL,sha256 TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS avatars(id TEXT PRIMARY KEY,relative_path TEXT NOT NULL,sha256 TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learning_directions(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learning_branches(id TEXT PRIMARY KEY,direction_id TEXT NOT NULL REFERENCES learning_directions(id) ON DELETE CASCADE,name TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learning_knowledge(id TEXT PRIMARY KEY,branch_id TEXT NOT NULL REFERENCES learning_branches(id) ON DELETE CASCADE,name TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',review TEXT,tags TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
const now=()=>new Date().toISOString();
const withoutPriority=(data)=>{const {priority:_priority,...rest}=data;return rest;};
for(const table of ['projects','ideas','experiments']){for(const row of db.prepare(`SELECT id,data FROM ${table}`).all()){const cleaned=withoutPriority(JSON.parse(row.data));if(JSON.stringify(cleaned)!==row.data)db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(cleaned),row.id);}}
const value=(name,fallback='')=>{const i=args.indexOf(name);return i>=0?args[i+1]??fallback:fallback;};
const jsonInput=()=>{const path=value('--input');if(!path) return {};return JSON.parse(readFileSync(resolve(path),'utf8'));};
function createProject(p){const id=randomUUID(),time=now(),data={name:p.name,description:p.description||'',status:p.status||'active',lifecycle:p.lifecycle||'in_progress',tags:p.tags||[]};db.prepare('INSERT INTO projects(id,name,data,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,data.name,JSON.stringify(data),time,time);for(const tag of data.tags)db.prepare('INSERT OR IGNORE INTO tags(name) VALUES(?)').run(String(tag));return {id,...data,created_at:time,updated_at:time};}
function createIdea(p){const id=randomUUID(),time=now(),data={name:p.name,body:p.body||'',status:p.status||'idea',tags:p.tags||[]};db.prepare('INSERT INTO ideas(id,project_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,p.project_id||null,data.name,JSON.stringify(data),time,time);for(const tag of data.tags)db.prepare('INSERT OR IGNORE INTO tags(name) VALUES(?)').run(String(tag));return {id,project_id:p.project_id||null,...data,created_at:time,updated_at:time};}
function createExperiment(p){if(!p.project_id||!db.prepare('SELECT id FROM projects WHERE id=?').get(p.project_id))throw new Error('实验必须关联已有项目。');const id=randomUUID(),time=now(),data={name:p.name,goal:p.goal||'',summary:p.summary||'',change_summary:p.change_summary||'',status:p.status||'experimenting',progress:p.progress||'in_progress',tags:p.tags||[],series_id:randomUUID()};db.prepare('INSERT INTO experiments(id,project_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,p.project_id,data.name,JSON.stringify(data),time,time);for(const tag of data.tags)db.prepare('INSERT OR IGNORE INTO tags(name) VALUES(?)').run(String(tag));return {id,project_id:p.project_id,...data,created_at:time,updated_at:time};}
function update(type,p){const table=type==='project'?'projects':type==='idea'?'ideas':type==='experiment'?'experiments':null;if(!table)throw new Error('type 必须是 project、idea 或 experiment。');const row=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(p.id);if(!row)throw new Error('找不到记录。');const old=JSON.parse(row.data);const data=withoutPriority({...old,...p});delete data.id;delete data.type;const name=String(data.name||row.name);const time=now();db.prepare(`UPDATE ${table} SET name=?,data=?,updated_at=? WHERE id=?`).run(name,JSON.stringify({...data,name}),time,p.id);return {id:p.id,...data,name,updated_at:time};}
function list(){return {projects:db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map(r=>({id:r.id,...withoutPriority(JSON.parse(r.data)),created_at:r.created_at,updated_at:r.updated_at})),ideas:db.prepare('SELECT * FROM ideas ORDER BY updated_at DESC').all().map(r=>({id:r.id,project_id:r.project_id,...withoutPriority(JSON.parse(r.data)),created_at:r.created_at,updated_at:r.updated_at})),experiments:db.prepare('SELECT * FROM experiments ORDER BY updated_at DESC').all().map(r=>({id:r.id,project_id:r.project_id,...withoutPriority(JSON.parse(r.data)),created_at:r.created_at,updated_at:r.updated_at}))};}
const command=args[0];let output;
if(command==='list')output=list();
else if(command==='create-project')output=createProject({...jsonInput(),name:value('--name',jsonInput().name)});
else if(command==='create-idea')output=createIdea({...jsonInput(),name:value('--name',jsonInput().name)});
else if(command==='create-experiment')output=createExperiment({...jsonInput(),name:value('--name',jsonInput().name)});
else if(command==='update')output=update(value('--type'),jsonInput());
else if(command==='record'){const data=jsonInput();const type=data.type;output=data.id?update(type,data):type==='project'?createProject(data):type==='idea'?createIdea(data):type==='experiment'?createExperiment(data):update(type,data);}
else{console.error('用法：list、record --input <绝对 JSON 路径>、create-project/create-idea/create-experiment --input <JSON>、update --type <类型> --input <JSON>');process.exitCode=2;}
if(output)console.log(JSON.stringify(output,null,2));
db.close();
