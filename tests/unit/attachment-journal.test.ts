import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AttachmentJournal} from '../../packages/local-context/src/attachment-sync.ts';
test('durable attachment retry uses original key and verifies again before cached success',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'attachment-journal-'));
 try {const journal=new AttachmentJournal(join(dir,'config.json'),{agent_id:'agent',credential_id:'credential',environment_id:'environment',cwd:dir});
 const payload={entity_type:'project',entity_id:'project',name:'x.png',caption:'',kind:'image',sha256:'a'.repeat(64)};
 const receipt=await journal.prepare(payload);let key='';
 await expect(journal.execute(receipt.operation_id,async metadata=>{key=metadata.idempotency_key;throw Error('lost response');},async()=>[])).rejects.toThrow('lost response');
 const recovered=new AttachmentJournal(join(dir,'config.json'),journal.scope);expect((await recovered.prepare(payload)).operation_id).toBe(receipt.operation_id);
 const response={...payload,id:'attachment'};
 await recovered.execute(receipt.operation_id,async metadata=>{expect(metadata.idempotency_key).toBe(key);return response as never;},async()=>[response as never]);
 await expect(recovered.execute(receipt.operation_id,async()=>{throw Error('must not write');},async()=>{throw Error('scope revoked');})).rejects.toThrow('scope revoked');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('server metadata mismatch keeps pending and never becomes a successful receipt',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'attachment-mismatch-'));try{const journal=new AttachmentJournal(join(dir,'config.json'),{agent_id:'agent'}),payload={entity_type:'project',entity_id:'project',name:'x.png',caption:'',kind:'image',sha256:'a'.repeat(64)},receipt=await journal.prepare(payload),wrong={...payload,id:'attachment',sha256:'b'.repeat(64)};
 await expect(journal.execute(receipt.operation_id,async()=>wrong as never,async()=>[wrong as never])).rejects.toMatchObject({code:'ATTACHMENT_UNVERIFIED'});expect((await journal.read())[0].state).toBe('pending');
 }finally{await rm(dir,{recursive:true,force:true});}
});
