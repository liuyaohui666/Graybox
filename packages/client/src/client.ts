import { z } from 'zod';
import { commandSchema, undoSchema, type Entity } from '../../contracts/src/index.ts';
import type {Attachment,UploadMetadata} from '../../core/src/attachments.ts';

export class ClientError extends Error {
  constructor(public readonly code:string,message:string,public readonly status=400){super(message);this.name='ClientError';}
}
export function safeError(error:unknown) {
  return {error:error instanceof ClientError?{code:error.code,message:error.message,status:error.status}:{code:'CLIENT_INTERNAL',message:'Local client failed; check configuration and service availability',status:500}};
}
export function localEndpoint(value:string):string {
  let url:URL;try{url=new URL(value);}catch{throw new ClientError('ENDPOINT_INVALID','A local numeric loopback HTTP endpoint is required');}
  if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new ClientError('ENDPOINT_INVALID','A local numeric loopback HTTP endpoint without userinfo, path, query or fragment is required');
  return url.origin;
}
export function cloudEndpoint(value:string):string {
  let url:URL;try{url=new URL(value);}catch{throw new ClientError('ENDPOINT_INVALID','HTTPS origin required');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new ClientError('ENDPOINT_INVALID','Cloud endpoint must be an HTTPS origin without userinfo, path, query or fragment');
  return url.origin;
}
function id(value:string){const parsed=z.uuid().safeParse(value);if(!parsed.success)throw new ClientError('VALIDATION','Valid UUID required');return parsed.data;}
export type AgentIdentity={credential_id:string;human_id:string;agent_id:string;kind:'agent';project_ids:string[]|null};
export type Health={environment_id:string;mode:'local'|'cloud'};
export type Project=Entity&{workspace_id:string;name?:string};
export type Experiment=Entity&{project_id:string};
export class ApiClient {
  readonly endpoint:string;
  readonly #token:string;
  readonly #timeout:number;
  constructor(options:{endpoint:string;token:string;timeout_ms?:number;mode?:'local'|'cloud'}) {
    this.endpoint=options.mode==='cloud'?cloudEndpoint(options.endpoint):localEndpoint(options.endpoint);
    if(!options.token||/[\r\n]/.test(options.token))throw new ClientError('CREDENTIAL_INVALID','Invalid local agent credential');
    this.#token=options.token;this.#timeout=options.timeout_ms??8000;
    if(!Number.isInteger(this.#timeout)||this.#timeout<1||this.#timeout>60000)throw new ClientError('VALIDATION','Timeout must be 1–60000 ms');
  }
  private async request<T>(method:'GET'|'POST',path:string,body?:unknown,authenticated=true,raw?:{bytes:Buffer;metadata:UploadMetadata}):Promise<T> {
    let response:Response;
    try{response=await fetch(this.endpoint+path,{method,redirect:'manual',signal:AbortSignal.timeout(this.#timeout),headers:{...(authenticated?{authorization:`Bearer ${this.#token}`} : {}),...(raw?{'content-type':'application/octet-stream','x-graybox-metadata':Buffer.from(JSON.stringify(raw.metadata)).toString('base64url')}:body===undefined?{}:{'content-type':'application/json'})},...(raw?{body:new Uint8Array(raw.bytes)}:body===undefined?{}:{body:JSON.stringify(body)})});}
    catch{throw new ClientError('CONNECTION_FAILED','Local API request failed or timed out; retry only with the same stable key',503);}
    if(response.status>=300&&response.status<400)throw new ClientError('REDIRECT_REJECTED','API redirect rejected; credentials were not forwarded',502);
    let result:{data?:T;error?:{code?:unknown;message?:unknown}};
    try{const text=await response.text();if(text.length>2*1024*1024)throw new Error();result=JSON.parse(text);}catch{throw new ClientError('RESPONSE_INVALID','Local API response is not a bounded JSON envelope',502);}
    if(!response.ok){const code=typeof result?.error?.code==='string'&&/^[A-Z_]{1,80}$/.test(result.error.code)?result.error.code:'API_FAILED';const message=typeof result?.error?.message==='string'?result.error.message.split(this.#token).join('[redacted]').slice(0,500):'Local API rejected request';throw new ClientError(code,message,response.status);}
    if(!result||!Object.hasOwn(result,'data'))throw new ClientError('RESPONSE_INVALID','Local API response is missing data',502);
    return result.data as T;
  }
  async health(){const value=await this.request<unknown>('GET','/v1/health',undefined,false);const parsed=z.object({environment_id:z.uuid(),mode:z.enum(['local','cloud'])}).safeParse(value);if(!parsed.success)throw new ClientError('RESPONSE_INVALID','Invalid environment health',502);return parsed.data;}
  async me():Promise<AgentIdentity>{
    const value=await this.request<unknown>('GET','/v1/me');const parsed=z.object({credential_id:z.uuid(),human_id:z.uuid(),agent_id:z.uuid(),kind:z.literal('agent'),project_ids:z.array(z.uuid()).nullable()}).safeParse(value);
    if(!parsed.success)throw new ClientError('AGENT_REQUIRED','CLI and MCP require a distinct local agent identity',403);return parsed.data;
  }
  workspaces(){return this.request<Array<{id:string;name:string}>>('GET','/v1/workspaces');}
  attachments(target:{entity_type:'project'|'idea'|'experiment';entity_id:string}){return this.request<Attachment[]>('GET',`/v1/attachments?entity_type=${target.entity_type}&entity_id=${id(target.entity_id)}`);}
  uploadAttachment(metadata:UploadMetadata,bytes:Buffer){return this.request<Attachment>('POST','/v1/attachments/upload',undefined,true,{metadata,bytes});}
  linkAttachment(metadata:{idempotency_key:string;entity_type:'project'|'idea'|'experiment';entity_id:string;name:string;caption:string;kind:'repository'|'demo_link';url:string}){return this.request<Attachment>('POST','/v1/attachments/link',metadata);}
  projects(){return this.request<Project[]>('GET','/v1/projects');}
  project(projectId:string){return this.request<Project>('GET',`/v1/projects/${id(projectId)}`);}
  experiment(experimentId:string){return this.request<Experiment>('GET',`/v1/experiments/${id(experimentId)}`);}
  experiments(projectId:string){return this.request<Experiment[]>('GET',`/v1/experiments?project_id=${id(projectId)}`);}
  idea(ideaId:string){return this.request<Entity>('GET',`/v1/ideas/${id(ideaId)}`);}
  mergeRequest(requestId:string){return this.request<Entity>('GET',`/v1/merge-requests/${id(requestId)}`);}
  ideas(filters:{project_id?:string;unlinked?:boolean}={}){const query=new URLSearchParams();if(filters.project_id)query.set('project_id',id(filters.project_id));if(filters.unlinked)query.set('unlinked','true');return this.request<Entity[]>('GET',`/v1/ideas${query.size?'?'+query:''}`);}
  collaboration(entity_type:'idea'|'experiment',entity_id:string){return this.request<{comments:Entity[];agreements:{count:number;agreed:boolean};participants:Entity[];merge_requests:Entity[]}>('GET',`/v1/collaboration?entity_type=${entity_type}&entity_id=${id(entity_id)}`);}
  retrospectives(projectId:string){return this.request<Array<Record<string,unknown>>>('GET',`/v1/projects/${id(projectId)}/retrospectives`);}
  comments(projectId:string){return this.request<Array<Record<string,unknown>>>('GET',`/v1/projects/${id(projectId)}/comments`);}
  tags(workspaceId:string,q?:string){const query=new URLSearchParams({workspace_id:id(workspaceId)});if(q)query.set('q',q);return this.request<Array<{id:string;workspace_id:string;name:string}>>('GET',`/v1/tags?${query}`);}
  activity(filters:{entity_id?:string;batch_id?:string}={}){const query=new URLSearchParams();for(const [key,value]of Object.entries(filters))if(value)query.set(key,id(value));return this.request<Array<Record<string,unknown>>>('GET',`/v1/activity${query.size?'?'+query:''}`);}
  async command(body:unknown){const parsed=commandSchema.safeParse(body);if(!parsed.success)throw new ClientError('VALIDATION','Command violates the shared contract; stable UUID keys and revisions are required');return this.request<Entity>('POST','/v1/commands',parsed.data);}
  preview(batchId:string){return this.request<{batch_id:string;batch_revision:number;preview_token:string;expires_at:string;changes:Array<{project_id:string;[key:string]:unknown}>}>('POST',`/v1/batches/${id(batchId)}/preview`,{});}
  async undo(batchId:string,body:unknown){const parsed=undoSchema.safeParse(body);if(!parsed.success)throw new ClientError('VALIDATION','Undo requires preview token, matching batch revision and stable UUID key');return this.request<{batch_id:string;compensation_batch_id:string;undone:true}>('POST',`/v1/batches/${id(batchId)}/undo`,parsed.data);}
}
