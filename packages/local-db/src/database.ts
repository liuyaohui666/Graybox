import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

export const LOCAL_DATA_DIR = 'Graybox';
export const DATABASE_FILE = 'graybox.sqlite';

export type LocalDatabase = DatabaseSync;

export function defaultDataRoot(env:NodeJS.ProcessEnv=process.env):string {
  const base=env.LOCALAPPDATA||env.APPDATA||env.HOME||env.USERPROFILE;
  if(!base) throw new Error('无法确定 Graybox 本地数据目录。');
  return resolve(base,LOCAL_DATA_DIR);
}

export async function openLocalDatabase(dataRoot=defaultDataRoot()):Promise<LocalDatabase> {
  const root=resolve(dataRoot); await mkdir(root,{recursive:true});
  const db=new DatabaseSync(join(root,DATABASE_FILE));
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrateDatabase(db);
  return db;
}

export function migrateDatabase(db:LocalDatabase):void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
    INSERT INTO schema_version(version) SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM schema_version);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ideas(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, relative_path TEXT NOT NULL, sha256 TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS avatars(id TEXT PRIMARY KEY, relative_path TEXT NOT NULL, sha256 TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
}

export async function backupDatabase(db:LocalDatabase,target:string):Promise<void> {
  const destination=resolve(target); await mkdir(dirname(destination),{recursive:true});
  const temporary=destination+'.partial';
  await backup(db,temporary);
  await copyFile(temporary,destination);
}

export async function localDataStats(dataRoot=defaultDataRoot()) {
  const db=await openLocalDatabase(dataRoot);
  try {
    const count=(table:string)=>Number((db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {count:number}).count);
    const entries=await readdir(resolve(dataRoot),{withFileTypes:true});
    return {projects:count('projects'),ideas:count('ideas'),experiments:count('experiments'),tags:count('tags'),attachments:count('attachments'),avatars:count('avatars'),activities:count('activities'),files:entries.length};
  } finally {db.close();}
}

export async function assertDatabaseFile(path:string):Promise<void> {
  const info=await stat(path); if(!info.isFile()||info.size<1) throw new Error('SQLite 数据库文件无效。');
}
