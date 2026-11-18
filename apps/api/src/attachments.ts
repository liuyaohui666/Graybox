import type {FastifyInstance,FastifyRequest} from 'fastify';
import {createReadStream} from 'node:fs';
import {randomBytes} from 'node:crypto';
import type {Principal} from '../../../packages/contracts/src/index.ts';
import {Attachments,parseAttachmentMetadata,type UploadMetadata} from '../../../packages/core/src/attachments.ts';
import {DomainError} from '../../../packages/core/src/service.ts';
type Request=FastifyRequest&{principal:Principal;attachmentMetadata?:UploadMetadata};
export function registerAttachments(app:FastifyInstance,attachments:Attachments) {
 const slots=new Set<string>();
 const previews=new Map<string,{principal:Principal;attachmentId:string;expires:number}>();
 app.addHook('onClose',async()=>{previews.clear();});
 app.addHook('onRequest',async request=>{
  if(request.method!=='POST'||request.url.split('?')[0]!=='/v1/attachments/upload')return;
  const r=request as Request,encoded=r.headers['x-graybox-metadata'];
  if(typeof encoded!=='string'||encoded.length>16000||!/^[A-Za-z0-9_-]+$/.test(encoded))throw new DomainError('VALIDATION','Attachment metadata header required',400);
  let metadata:unknown;try{metadata=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{throw new DomainError('VALIDATION','Invalid attachment metadata header',400);}
  r.attachmentMetadata=parseAttachmentMetadata(metadata);
  await attachments.authorize(r.principal,r.attachmentMetadata);
  if(slots.size>=2)throw new DomainError('RATE_LIMITED','Two uploads are already in progress; retry later',429);
  const limit=r.attachmentMetadata.kind==='video'?50*1024*1024:r.attachmentMetadata.kind==='demo'?5*1024*1024:10*1024*1024;
  if(Number(r.headers['content-length']??0)>limit)throw new DomainError('PAYLOAD_TOO_LARGE','Attachment exceeds size limit',413);
  if(r.headers['content-type']!=='application/octet-stream')throw new DomainError('VALIDATION','Raw octet-stream required',400);
  slots.add(r.id);
 });
 app.addHook('onResponse',async r=>{slots.delete(r.id);});
 app.addHook('onError',async r=>{slots.delete(r.id);});
 app.addHook('onRequestAbort',async r=>{slots.delete(r.id);});
 app.addContentTypeParser('application/octet-stream',(r,payload,done)=>{
  const metadata=(r as Request).attachmentMetadata;
  if(!metadata){done(new DomainError('VALIDATION','Upload route required',400));return;}
  const limit=metadata.kind==='video'?50*1024*1024:metadata.kind==='demo'?5*1024*1024:10*1024*1024;
  let size=0,finished=false;const chunks:Buffer[]=[];
  const fail=(error:Error)=>{if(finished)return;finished=true;chunks.length=0;done(error);};
  payload.on('data',(chunk:Buffer)=>{if(finished)return;size+=chunk.length;if(size>limit){fail(new DomainError('PAYLOAD_TOO_LARGE','Attachment exceeds size limit',413));return;}chunks.push(chunk);});
  payload.on('error',fail);payload.on('end',()=>{if(!finished){finished=true;done(null,Buffer.concat(chunks,size));}});
 });
 app.get('/v1/attachments',async r=>({data:await attachments.list((r as Request).principal,r.query)}));
 app.post('/v1/attachments/upload',{bodyLimit:50*1024*1024},async r=>({data:await attachments.upload((r as Request).principal,(r as Request).attachmentMetadata!,r.body as Buffer)}));
 app.post('/v1/attachments/link',async r=>({data:await attachments.addLink((r as Request).principal,r.body)}));
 app.post<{Params:{id:string}}>('/v1/attachments/:id/preview',async r=>{
  const principal=(r as Request).principal,{attachment}=await attachments.content(principal,r.params.id);
  if(attachment.kind!=='demo')throw new DomainError('VALIDATION','Only static HTML has a script preview',400);
  const now=Date.now();for(const [ticket,preview] of previews)if(preview.expires<=now)previews.delete(ticket);
  if(previews.size>=256)throw new DomainError('RATE_LIMITED','Preview capacity reached; retry in one minute',429);
  const ticket=randomBytes(32).toString('hex');previews.set(ticket,{principal,attachmentId:attachment.id,expires:now+60000});
  return {data:{url:`/v1/attachment-previews/${ticket}`}};
 });
 app.get<{Params:{ticket:string}}>('/v1/attachment-previews/:ticket',async(r,reply)=>{
  const preview=previews.get(r.params.ticket);
  if(!preview||preview.expires<=Date.now()){previews.delete(r.params.ticket);throw new DomainError('UNAUTHORIZED','Preview expired; reopen the attachment',401);}
  const {attachment,path}=await attachments.content(preview.principal,preview.attachmentId);
  return reply.header('Content-Type','text/html; charset=utf-8').header('Content-Length',attachment.byte_size).header('X-Content-Type-Options','nosniff').header('Cache-Control','private, no-store').header('Referrer-Policy','no-referrer').header('Content-Security-Policy',"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'").send(createReadStream(path));
 });
 app.get<{Params:{id:string}}>('/v1/attachments/:id/content',async(r,reply)=>{
  const {attachment:a,path}=await attachments.content((r as Request).principal,r.params.id);
  reply.header('Content-Type',a.mime_type).header('X-Content-Type-Options','nosniff').header('Cache-Control','private, no-store').header('Content-Disposition',`${a.kind==='demo'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(a.name)}`);
  if(a.kind==='demo')reply.header('Content-Security-Policy',"sandbox; default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if(a.kind==='video')reply.header('Accept-Ranges','bytes');
  const range=r.headers.range;
  if(range&&a.kind==='video'){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);let start=0,end=a.byte_size-1;
   if(match){if(match[1]){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}else if(match[2])start=Math.max(0,a.byte_size-Number(match[2]));else start=-1;}
   if(!match||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=a.byte_size)return reply.code(416).header('Content-Range',`bytes */${a.byte_size}`).send();
   return reply.code(206).header('Content-Range',`bytes ${start}-${end}/${a.byte_size}`).header('Content-Length',end-start+1).send(createReadStream(path,{start,end}));
  }
  return reply.header('Content-Length',a.byte_size).send(createReadStream(path));
 });
}
