import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { commandSchema, type Entity } from '../../contracts/src/index.ts';
import { ClientError } from '../../client/src/client.ts';
import { resolveContext, executeCommand, type ContextOptions } from './binding.ts';

const scopeSchema=z.strictObject({environment_id:z.uuid(),workspace_id:z.uuid(),project_id:z.uuid(),human_id:z.uuid(),agent_id:z.uuid(),cwd:z.string().min(1),entity_type:z.enum(['project','idea','experiment']),entity_id:z.uuid()});
const receiptSchema=z.strictObject({operation_id:z.uuid(),through:z.string().min(1).max(4000),command:commandSchema,state:z.enum(['pending','verified','rejected']),response:z.record(z.string(),z.unknown()).optional(),verified_at:z.string().optional(),rejection_code:z.enum(['REVISION_CONFLICT','BATCH_CLOSED']).optional()});
const storeSchema=z.strictObject({version:z.literal(1),scope:scopeSchema,checkpoint:z.string().nullable(),receipts:z.array(receiptSchema)});
type Scope=z.infer<typeof scopeSchema>;
type Store=z.infer<typeof storeSchema>;
function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
function fail(code:string,message:string):never{throw new ClientError(code,message);}

/** Private, identity-scoped store beside trusted config, never in the repository. */
export class SyncJournal {
  readonly path:string;
  constructor(configPath:string,readonly scope:Scope){scopeSchema.parse(scope);this.path=join(dirname(configPath),'sync-receipts',createHash('sha256').update(canonical(scope)).digest('hex')+'.json');}
  async read():Promise<Store>{try{const text=await readFile(this.path,'utf8');if(text.length>4*1024*1024)fail('SYNC_INVALID','Sync journal exceeds bounded size');const parsed=storeSchema.parse(JSON.parse(text));if(canonical(parsed.scope)!==canonical(this.scope))fail('SYNC_SCOPE','Sync journal belongs to another identity or context');return parsed;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,scope:this.scope,checkpoint:null,receipts:[]};if(error instanceof ClientError)throw error;fail('SYNC_INVALID','Sync journal is invalid; preserve it for recovery');}}
  private async mutate<T>(fn:(store:Store)=>T|Promise<T>):Promise<T>{
    await mkdir(dirname(this.path),{recursive:true});let lock;try{lock=await open(this.path+'.lock','wx',0o600);}catch{fail('SYNC_BUSY','Another sync owns this journal; retry later. A stale lock requires explicit recovery after checking the writer has stopped');}
    const temp=this.path+'.'+randomUUID()+'.tmp';
    try{const store=await this.read(),result=await fn(store),text=JSON.stringify(store,null,2)+'\n';if(text.length>4*1024*1024)fail('SYNC_FULL','Sync journal is full; preserve receipts and explicitly archive verified history before continuing');const file=await open(temp,'wx',0o600);try{await file.writeFile(text);await file.sync();}finally{await file.close();}await rename(temp,this.path);return result;}finally{await rm(temp,{force:true});await lock.close();await rm(this.path+'.lock',{force:true});}
  }
  async prepare(operation_id:string,through:string,body:unknown){const parsed=receiptSchema.parse({operation_id,through,command:body,state:'pending'});return this.mutate(store=>{
    const found=store.receipts.find(r=>r.operation_id===operation_id);if(found){if(found.through!==through||canonical(found.command)!==canonical(parsed.command))fail('SYNC_CONFLICT','Operation already exists with a different payload; retry the persisted operation');return found;}
    if(store.receipts.some(r=>r.state==='pending'))fail('SYNC_PENDING','Recover the pending write before preparing another operation');
    if(store.receipts.some(r=>r.command.idempotency_key===parsed.command.idempotency_key))fail('SYNC_CONFLICT','Stable write key already belongs to another operation');
    store.receipts.push(parsed);return parsed;
  });}
  async execute(operation_id:string,write:(body:unknown)=>Promise<Entity>,readBack:(response:Entity)=>Promise<Entity>){return this.mutate(async store=>{
    const receipt=store.receipts.find(r=>r.operation_id===operation_id);if(!receipt)fail('SYNC_MISSING','Prepare and durably save the operation before executing');if(receipt.state!=='pending')return receipt;
    // Failure or timeout writes no new checkpoint. The saved exact body remains replayable.
    let response:Entity;
    try{response=await write(receipt.command);}catch(error){
      // Exact server replay checks committed receipts before validating a fresh write.
      // These definitive rejection codes therefore prove this body has no receipt.
      // Authorization, scope, transport and read-back failures provide no such proof.
      if(error instanceof ClientError&&error.status>=400&&error.status<500&&['REVISION_CONFLICT','BATCH_CLOSED'].includes(error.code)){
        receipt.state='rejected';receipt.rejection_code=error.code as 'REVISION_CONFLICT'|'BATCH_CLOSED';return receipt;
      }
      throw error;
    }
    const actual=await readBack(response);
    if(canonical(actual)!==canonical(response))fail('SYNC_UNVERIFIED','Read-back differs from the write receipt; checkpoint remains unchanged');
    receipt.response=response;receipt.state='verified';receipt.verified_at=new Date().toISOString();store.checkpoint=receipt.through;return receipt;
  });}
}
async function journal(options:ContextOptions){const ctx=await resolveContext(options),entity_type=ctx.active_idea?'idea':ctx.active_experiment?'experiment':'project',entity_id=ctx.active_idea?.id??ctx.active_experiment?.id??ctx.project.id;return {ctx,journal:new SyncJournal(ctx.config_path,{environment_id:ctx.binding.environment_id,workspace_id:ctx.binding.workspace_id,project_id:ctx.project.id,human_id:ctx.identity.human_id,agent_id:ctx.identity.agent_id,cwd:ctx.paths.cwd,entity_type,entity_id})};}
export async function syncStatus(options:ContextOptions){const value=await journal(options);return value.journal.read();}
export async function syncPrepare(options:ContextOptions,input:{operation_id:string;through:string;command:unknown}){
  const value=await journal(options),command=commandSchema.parse(input.command),scope=value.journal.scope;
  if(scope.entity_type!=='project'){
    const payload=command.payload as Record<string,unknown>,target=payload.entity_id??payload.experiment_id??payload.id;
    const type=payload.entity_type??(command.type.startsWith('idea_')?'idea':command.type.startsWith('experiment_')||['evidence_append','review_submit'].includes(command.type)?'experiment':undefined);
    if(target!==scope.entity_id||type!==scope.entity_type)fail('SYNC_TARGET','Command differs from selected sync entity; explicitly select the intended target first');
  }
  return value.journal.prepare(input.operation_id,input.through,command);
}
export async function syncExecute(options:ContextOptions,operation_id:string){const {ctx,journal:store}=await journal(options);return store.execute(operation_id,body=>executeCommand(options,body),async response=>{
  // Immutable activity is read back from the API, allowing later concurrent edits.
  const pending=(await store.read()).receipts.find(r=>r.operation_id===operation_id)!;
  const activities=await ctx.api.activity({batch_id:pending.command.batch_id});
  const proof=activities.find(a=>a.entity_id===response.id&&canonical(a.after)===canonical(response));
  if(!proof)fail('SYNC_UNVERIFIED','No matching server activity read-back; checkpoint remains unchanged');return proof.after as Entity;
});}
