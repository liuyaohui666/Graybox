import {CloudAuth} from '../../../packages/core/src/cloud-auth.ts';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import cors from '@fastify/cors';
import { z } from 'zod';
import { DomainError,Service } from '../../../packages/core/src/service.ts';
import type { Principal } from '../../../packages/contracts/src/index.ts';
export async function buildApp(options: {pool:Pool;mode:string;authPool?:Pool}) {
  if(!['local','cloud'].includes(options.mode)) throw new Error('Production start disabled: unsupported mode');
  if(options.mode==='cloud'&&!options.authPool) throw new Error('Cloud authPool required');
  const auth=options.mode==='cloud'?new CloudAuth(options.authPool!):null;
  const publicRoutes=new Set(['/v1/health',...(auth?['/v1/auth/login','/v1/auth/redeem','/v1/auth/pair/start','/v1/auth/pair/poll']:[])]);
  const limits=new Map<string,{count:number;until:number}>();
  const app=Fastify({logger:false,bodyLimit:256*1024,trustProxy:options.mode==='cloud'?(address,hop)=>hop===0&&(address==='127.0.0.1'||address==='::ffff:127.0.0.1'):false}); const service=new Service(options.pool,options.mode as 'local'|'cloud');
  await app.register(cors,{origin:['http://127.0.0.1:1420','http://localhost:1420','http://127.0.0.1:5173','http://localhost:5173','http://tauri.localhost','tauri://localhost'],methods:['GET','POST'],allowedHeaders:['authorization','content-type']});
  app.decorateRequest('principal',null);
  app.addHook('preHandler',async request=> {
    const path=request.url.split('?')[0];
    if(auth&&request.method!=='OPTIONS'&&path.startsWith('/v1/auth/')) {
      const key=request.ip,now=Date.now();
      let limit=limits.get(key);
      if(!limit||limit.until<now) {
        if(!limit&&limits.size>=10000) {
          for(const [k,v] of limits)if(v.until<now)limits.delete(k);
          if(limits.size>=10000)throw new DomainError('RATE_LIMITED','Try again later',429);
        }
        limit={count:0,until:now+60000};limits.set(key,limit);
      }
      if(++limit.count>30)throw new DomainError('RATE_LIMITED','Try again later',429);
    }
    if(publicRoutes.has(path) || request.method==='OPTIONS') return;
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
  app.get('/v1/people',async r=>({data:await service.people(principal(r))}));
  app.get<{Params:{id:string}}>('/v1/projects/:id/agreement',async r=>({data:await service.agreement(principal(r),id(r.params.id))}));
  app.post<{Params:{id:string}}>('/v1/projects/:id/agreement',async r=>({data:await service.agreement(principal(r),id(r.params.id),r.body??null)}));
  app.get('/v1/notifications',async r=>({data:await service.notifications(principal(r),r.query)}));
  app.post('/v1/notifications/read',async r=>({data:await service.readNotifications(principal(r),r.body)}));
  app.post('/v1/profile/avatar',async r=>({data:await service.setAvatar(principal(r),r.body)}));
  app.post('/v1/profile/name',async r=>({data:await service.setName(principal(r),r.body)}));
  app.get<{Querystring:{tag?:string}}>('/v1/projects',async request=>({data:await service.list(principal(request),'projects',undefined,request.query.tag)}));
  app.get<{Querystring:{workspace_id?:string;q?:string}}>('/v1/tags',async request=>({data:await service.tags(principal(request),request.query.workspace_id?id(request.query.workspace_id):undefined,request.query.q)}));
  for(const table of ['retrospectives','comments'] as const) app.get<{Params:{id:string}}>(`/v1/projects/:id/${table}`,async request=>({data:await service.projectChildren(principal(request),id(request.params.id),table)}));
  app.get<{Params:{id:string}}>('/v1/projects/:id',async request=>({data:await service.getProject(principal(request),id(request.params.id))}));
  app.get<{Querystring:{project_id?:string}}>('/v1/experiments',async request=>({data:await service.list(principal(request),'experiments',request.query.project_id? id(request.query.project_id):undefined)}));
  app.get<{Params:{id:string}}>('/v1/experiments/:id',async request=>({data:await service.getExperiment(principal(request),id(request.params.id))}));
  app.get('/v1/ideas',async r=>({data:await service.ideas(principal(r),r.query)}));
  app.get<{Params:{id:string}}>('/v1/ideas/:id',async r=>({data:await service.getIdea(principal(r),id(r.params.id))}));
  app.get<{Params:{id:string}}>('/v1/merge-requests/:id',async r=>({data:await service.getMergeRequest(principal(r),id(r.params.id))}));
  app.get('/v1/collaboration',async r=>({data:await service.collaboration(principal(r),r.query)}));
  app.get('/v1/collaboration/notifications',async r=>({data:await service.collaborationNotifications(principal(r))}));
  app.post('/v1/collaboration/notifications/read',async r=>({data:await service.collaborationNotifications(principal(r),r.body)}));
  app.get<{Querystring:{entity_id?:string;batch_id?:string}}>('/v1/activity',async request=>({data:await service.activity(principal(request),request.query.entity_id?id(request.query.entity_id):undefined,request.query.batch_id?id(request.query.batch_id):undefined)}));
  app.post('/v1/commands',async request=>({data:await service.command(principal(request),request.body)}));
  app.post<{Params:{id:string}}>('/v1/batches/:id/preview',async request=> {if(request.body && (typeof request.body!=='object'||Object.keys(request.body).length)) throw new DomainError('VALIDATION','Preview body must be empty',400);return {data:await service.preview(principal(request),id(request.params.id))};});
  app.post<{Params:{id:string}}>('/v1/batches/:id/undo',async request=>({data:await service.undo(principal(request),id(request.params.id),request.body)}));
  if(auth){
    app.post('/v1/auth/login',async r=>({data:await auth.login(r.body)}));
    app.post('/v1/auth/redeem',async r=>({data:await auth.redeem(r.body)}));
    app.post('/v1/auth/pair/start',async r=>({data:await auth.pairStart(r.body)}));
    app.post('/v1/auth/pair/poll',async r=>({data:await auth.pairPoll(r.body)}));
    for(const [path,action] of [['/v1/auth/me','me'],['/v1/members','members'],['/v1/agents','agents']])app.get(path,async r=>({data:await auth.action(principal(r),action,{})}));
    for(const [path,action] of [['/v1/auth/logout','logout'],['/v1/members/invite','invite'],['/v1/agents/pair/approve','approve']])app.post(path,async r=>({data:await auth.action(principal(r),action,r.body)}));
    app.post<{Params:{id:string}}>('/v1/members/:id/disable',async r=>({data:await auth.action(principal(r),'disable',r.body,id(r.params.id))}));
    app.post<{Params:{id:string}}>('/v1/agents/:id/revoke',async r=>({data:await auth.action(principal(r),'revoke',r.body,id(r.params.id))}));
  }
  return app;
}

export function parseServerPort(value?:string):number {
  if(value===undefined)return 4318;
  if(!/^[0-9]+$/.test(value)||Number(value)<1||Number(value)>65535)throw new Error('Invalid server port');
  return Number(value);
}
