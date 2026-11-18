import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,unlink,link} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Pool} from 'pg';
import {z} from 'zod';
import type {Principal} from '../../contracts/src/index.ts';
import {DomainError,Service} from './service.ts';
export const attachmentTargetSchema=z.strictObject({entity_type:z.enum(['project','idea','experiment']),entity_id:z.uuid()});
const shared={...attachmentTargetSchema.shape,idempotency_key:z.uuid(),name:z.string().trim().min(1).max(200).regex(/^[^\\/\u0000-\u001f\u007f]+$/),caption:z.string().max(2000).default('')};
const metadataSchema=z.strictObject({...shared,kind:z.enum(['image','video','demo']),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const linkSchema=z.strictObject({...shared,kind:z.enum(['repository','demo_link']),url:z.string().max(2048)});
function parse<T>(schema:z.ZodType<T>,value:unknown):T {const parsed=schema.safeParse(value);if(!parsed.success)throw new DomainError('VALIDATION','Invalid attachment metadata',400);return parsed.data;}
export const parseAttachmentMetadata=(body:unknown)=>parse(metadataSchema,body);
export type UploadMetadata=z.infer<typeof metadataSchema>;
export type Attachment={id:string;entity_type:'project'|'idea'|'experiment';entity_id:string;kind:'image'|'video'|'demo'|'repository'|'demo_link';name:string;caption:string;mime_type:string;byte_size:number;sha256:string|null;url:string|null;uploader_id:string;created_at:string;target_revision:number};
export function safeAttachmentUrl(value:string):string {
 let url:URL;try{url=new URL(value);}catch{throw new DomainError('VALIDATION','HTTPS URL required',400);}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||/^\d+\.\d+\.\d+\.\d+$/.test(host))throw new DomainError('VALIDATION','Public HTTPS URL without credentials required',400);
 return url.href;
}
export function validateFile(kind:string,bytes:Buffer):string {
 const max=kind==='video'?50*1024*1024:kind==='demo'?5*1024*1024:10*1024*1024;
 if(!bytes.length||bytes.length>max)throw new DomainError('PAYLOAD_TOO_LARGE','Attachment exceeds size limit',413);
 let mime='';
 if(kind==='image') {
  if(bytes.length>24&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0&&bytes.toString('ascii',bytes.length-8,bytes.length-4)==='IEND')mime='image/png';
  else if(bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)mime='image/jpeg';
  else if(bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length&&['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16)))mime='image/webp';
 } else if(kind==='video') {
  if(bytes.length>=24&&bytes.toString('ascii',4,8)==='ftyp'&&bytes.readUInt32BE(0)>=16&&bytes.readUInt32BE(0)<=bytes.length&&['isom','iso2','mp41','mp42','avc1','M4V ','dash'].includes(bytes.toString('ascii',8,12)))mime='video/mp4';
  else if(bytes.length>16&&bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))&&bytes.subarray(4,Math.min(bytes.length,4096)).includes(Buffer.from('webm')))mime='video/webm';
 } else if(kind==='demo') {
  let html='';try{html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{}
  if(!html.includes('\0')&&/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html[\s>]/i.test(html)&&/<\/html\s*>\s*$/i.test(html))mime='text/html';
 }
 if(!mime)throw new DomainError('VALIDATION','File bytes do not match an allowed format',400);return mime;
}
const columns='id,entity_type,entity_id,kind,name,caption,mime_type,byte_size::float8 AS byte_size,sha256,url,uploader_id,created_at,target_revision';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Attachments {
 readonly directory:string;
 constructor(private pool:Pool,private service:Service,directory=process.env.GRAYBOX_ATTACHMENT_DIR??'.local/attachments',private quota=Number(process.env.GRAYBOX_ATTACHMENT_QUOTA_BYTES??1073741824)){this.directory=resolve(directory);if(!Number.isSafeInteger(quota)||quota<1)throw Error('Invalid attachment quota');}
 async authorize(p:Principal,metadata:UploadMetadata) {return this.service.attachmentTransaction(p,metadata.entity_type,metadata.entity_id,true,async()=>null);}
 async list(p:Principal,query:unknown) {const t=parse(attachmentTargetSchema,query);return this.service.attachmentTransaction(p,t.entity_type,t.entity_id,false,async c=>(await c.query(`SELECT ${columns} FROM graybox.attachments WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at,id`,[t.entity_type,t.entity_id])).rows as Attachment[]);}
 async content(p:Principal,id:string) {
  if(!z.uuid().safeParse(id).success)throw new DomainError('VALIDATION','Valid UUID required',400);
  const row=(await this.pool.query(`SELECT ${columns} FROM graybox.attachments WHERE id=$1`,[id])).rows[0] as Attachment|undefined;
  if(!row)throw new DomainError('NOT_FOUND','Attachment not found',404);
  return this.service.attachmentTransaction(p,row.entity_type,row.entity_id,false,async c=>{
   const current=(await c.query(`SELECT ${columns} FROM graybox.attachments WHERE id=$1`,[id])).rows[0] as Attachment;
   if(!current.sha256)throw new DomainError('NOT_FOUND','Link has no file content',404);
   return {attachment:current,path:resolve(this.directory,current.id)};
  });
 }
 async upload(p:Principal,metadata:UploadMetadata,bytes:Buffer) {
  const mime=validateFile(metadata.kind,bytes),sha=createHash('sha256').update(bytes).digest('hex');
  if(sha!==metadata.sha256)throw new DomainError('DIGEST_MISMATCH','File digest mismatch',400);
  return this.save(p,metadata,mime,bytes,sha,null);
 }
 async addLink(p:Principal,body:unknown) {const metadata=parse(linkSchema,body);metadata.url=safeAttachmentUrl(metadata.url);return this.save(p,metadata,'text/uri-list',null,null,metadata.url);}
 private async save(p:Principal,metadata:UploadMetadata|z.infer<typeof linkSchema>,mime:string,bytes:Buffer|null,sha:string|null,url:string|null) {
  const hash=digest(metadata);
  let pendingFile:{id:string;path:string}|null=null;
  try{return await this.service.attachmentTransaction(p,metadata.entity_type,metadata.entity_id,true,async(c,current,target)=>{
   const prior=(await c.query('SELECT a.*,r.payload_hash FROM graybox.attachment_receipts r JOIN graybox.attachments a ON a.id=r.attachment_id WHERE r.credential_id=$1 AND r.key=$2',[current.id,metadata.idempotency_key])).rows[0];
   if(prior){
    if(prior.entity_type!==metadata.entity_type||prior.entity_id!==metadata.entity_id||prior.payload_hash!==hash)throw new DomainError('IDEMPOTENCY_MISMATCH','Key already used for a different request');
    return (await c.query(`SELECT ${columns} FROM graybox.attachments WHERE id=$1`,[prior.id])).rows[0] as Attachment;
   }
   const used=Number((await c.query('SELECT coalesce(sum(byte_size),0) AS used FROM graybox.attachments')).rows[0].used);
   if(bytes&&used+bytes.length>this.quota)throw new DomainError('QUOTA_EXCEEDED','Team attachment quota exceeded',413);
   const id=randomUUID(),path=resolve(this.directory,id),tmp=resolve(this.directory,`${id}.tmp`);
   let installed=false;
   try{
    if(bytes){
     await mkdir(this.directory,{recursive:true,mode:0o700});
     const staged=await open(tmp,'wx',0o600);
     try{await staged.writeFile(bytes);await staged.sync();}finally{await staged.close();}
     await link(tmp,path);installed=true;pendingFile={id,path};await unlink(tmp);
     // Linux directory flush persists the immutable filename before metadata can
     // commit. Windows supports file fsync but not opening directories this way.
     if(process.platform==='linux'){const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}}
    }
    const row=(await c.query(`INSERT INTO graybox.attachments(id,entity_type,entity_id,kind,name,caption,mime_type,byte_size,sha256,url,uploader_id,target_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${columns}`,[id,metadata.entity_type,metadata.entity_id,metadata.kind,metadata.name,metadata.caption,mime,bytes?.length??0,sha,url,current.human_id,target.revision])).rows[0] as Attachment;
    await c.query('INSERT INTO graybox.attachment_receipts(credential_id,key,payload_hash,attachment_id) VALUES($1,$2,$3,$4)',[current.id,metadata.idempotency_key,hash,id]);return row;
   }catch(error){if(bytes){await unlink(tmp).catch(()=>{});if(installed)await unlink(path).catch(()=>{});}throw error;}
  });}catch(error){
   // A lost COMMIT acknowledgement may still have committed. Delete only after
   // a fresh connection positively confirms that no metadata references bytes.
   const orphan=pendingFile as {id:string;path:string}|null;
   if(orphan)try{if(!(await this.pool.query('SELECT id FROM graybox.attachments WHERE id=$1',[orphan.id])).rowCount)await unlink(orphan.path).catch(()=>{});}catch{}
   throw error;
  }
 }
}
