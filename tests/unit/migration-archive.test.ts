import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openLocalDatabase } from '../../packages/local-db/src/index.ts';
import { exportArchive, validateArchive } from '../../packages/migration/src/index.ts';

describe('graybox migration archive',()=>it('exports and validates database plus attachments',async()=>{
  const root=await mkdtemp(join(tmpdir(),'graybox-archive-'));try{const db=await openLocalDatabase(root);db.close();await mkdir(join(root,'attachments'));await writeFile(join(root,'attachments','demo.txt'),'demo');const archive=join(root,'backup.graybox');const manifest=await exportArchive(root,archive);expect(manifest.format_version).toBe(1);expect((await validateArchive(archive)).files[0]?.path).toBe('attachments/demo.txt');}finally{await rm(root,{recursive:true,force:true});}}));
