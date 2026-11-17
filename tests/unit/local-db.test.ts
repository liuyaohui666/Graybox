import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalDatabase, localDataStats, backupDatabase, defaultDataRoot } from '../../packages/local-db/src/index.ts';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true});});

describe('local SQLite store',()=>{
  it('defaults Windows data to D drive and accepts an explicit override',()=>{
    expect(defaultDataRoot({})).toBe(process.platform==='win32'?'D:\\Graybox':defaultDataRoot({HOME:'/tmp'}));
    expect(defaultDataRoot({GRAYBOX_DATA_ROOT:'D:/Graybox-custom'})).toContain('Graybox-custom');
  });
  it('initializes a portable database and enables foreign keys',async()=>{
    const root=await mkdtemp(join(tmpdir(),'graybox-local-'));roots.push(root);
    const db=await openLocalDatabase(root);
    expect((db.prepare('PRAGMA foreign_keys').get() as {foreign_keys:number}).foreign_keys).toBe(1);
    expect(await localDataStats(root)).toMatchObject({projects:0,ideas:0,experiments:0,tags:0});
    db.close();
  });
  it('keeps data after reopening and can create a backup',async()=>{
    const root=await mkdtemp(join(tmpdir(),'graybox-local-'));roots.push(root);
    const db=await openLocalDatabase(root); const now=new Date().toISOString();
    db.prepare('INSERT INTO projects(id,name,data,created_at,updated_at) VALUES(?,?,?,?,?)').run('p1','本地项目','{}',now,now); db.close();
    const reopened=await openLocalDatabase(root); expect(await localDataStats(root)).toMatchObject({projects:1});
    const backup=join(root,'backups','graybox.sqlite'); await backupDatabase(reopened,backup); reopened.close();
    await expect((await import('node:fs/promises')).stat(backup)).resolves.toBeTruthy();
  });
});
