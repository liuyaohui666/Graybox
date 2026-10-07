import Fastify from 'fastify';
import type { Pool } from 'pg';
import cors from '@fastify/cors';
import { z } from 'zod';
import { DomainError,Service } from '../../../packages/core/src/service.ts';
import type { Principal } from '../../../packages/contracts/src/index.ts';
export async function buildApp(options: {pool:Pool;mode:string}) {
  if(options.mode!=='local') throw new Error('Production start disabled: real Auth integration is required');
  const app=Fastify({logger:false,bodyLimit:256*1024}); const service=new Service(options.pool);
  await app.register(cors,{origin:['http://127.0.0.1:1420','http://localhost:1420','http://127.0.0.1:5173','http://localhost:5173','http://tauri.localhost','tauri://localhost'],methods:['GET','POST'],allowedHeaders:['authorization','content-type']});
  app.decorateRequest('principal',null);
  app.addHook('preHandler',async request=> {
    if(request.url.split('?')[0]==='/v1/health' || request.method==='OPTIONS') return;
    const authorization=request.headers.authorization??'';
    if(!authorization.startsWith('Bearer ')) throw new DomainError('UNAUTHORIZED','Bearer credential required',401);
    (request as typeof request & {principal:Principal}).principal=await service.authenticate(authorization.slice(7));
  });
  app.setErrorHandler((error,_request,reply)=> {
    if(error instanceof DomainError) return reply.code(error.status).send({error:{code:error.code,message:error.message}});
    if((error as {statusCode?:number}).statusCode===400) return reply.code(400).send({error:{code:'VALIDATION',message:'Invalid request'}});
    // Database exception details can contain data; never reflect them to callers.
    return reply.code(500).send({error:{code:'INTERNAL',message:'Operation failed; transaction was rolled back'}});
  });
  const principal=(request:unknown)=>(request as {principal:Principal}).principal;
  const id=(value:unknown)=> {const result=z.uuid().safeParse(value);if(!result.success) throw new DomainError('VALIDATION','Valid UUID required',400);return result.data;};
  app.get('/v1/health',async()=>({data:await service.health()}));
  app.get('/v1/me',async request=> {const p=principal(request);return {data:{credential_id:p.id,human_id:p.human_id,agent_id:p.agent_id,kind:p.kind,project_ids:p.project_ids}};});
  app.get('/v1/workspaces',async()=>({data:await service.workspaces()}));
  app.get('/v1/projects',async request=>({data:await service.list(principal(request),'projects')}));
  app.get<{Params:{id:string}}>('/v1/projects/:id',async request=>({data:await service.getProject(principal(request),id(request.params.id))}));
  app.get<{Querystring:{project_id?:string}}>('/v1/experiments',async request=>({data:await service.list(principal(request),'experiments',request.query.project_id? id(request.query.project_id):undefined)}));
  app.get<{Params:{id:string}}>('/v1/experiments/:id',async request=>({data:await service.getExperiment(principal(request),id(request.params.id))}));
  app.get<{Querystring:{entity_id?:string;batch_id?:string}}>('/v1/activity',async request=>({data:await service.activity(principal(request),request.query.entity_id?id(request.query.entity_id):undefined,request.query.batch_id?id(request.query.batch_id):undefined)}));
  app.post('/v1/commands',async request=>({data:await service.command(principal(request),request.body)}));
  app.post<{Params:{id:string}}>('/v1/batches/:id/preview',async request=> {if(request.body && (typeof request.body!=='object'||Object.keys(request.body).length)) throw new DomainError('VALIDATION','Preview body must be empty',400);return {data:await service.preview(principal(request),id(request.params.id))};});
  app.post<{Params:{id:string}}>('/v1/batches/:id/undo',async request=>({data:await service.undo(principal(request),id(request.params.id),request.body)}));
  return app;
}
