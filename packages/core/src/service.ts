import { createHash,createHmac,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import {z} from 'zod';
import {agreementState,inboxPage,notifyOwner} from './social.ts';
import {experimentOwner,presentExperiment,idea} from './collaboration.ts';
import {validAvatar} from './avatar.ts';
import { legacyCommandSchema,collaborationCommandSchema,undoSchema,type Principal,type Entity,type CollaborationCommand } from '../../contracts/src/index.ts';

export class DomainError extends Error { constructor(public code:string,message:string,public status=409) {super(message);} }
const fail=(code:string,message:string,status=409):never=> {throw new DomainError(code,message,status);};
function canonical(value:unknown):string {
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const normalize=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
const tables={project:'projects',experiment:'experiments',series:'experiment_series',evidence:'evidence',submission:'submissions',retrospective:'retrospectives',comment:'comments'} as const;
type EntityType=keyof typeof tables;
type Change={entity_type:EntityType;entity_id:string;project_id:string;before:Entity|null;after:Entity;expected_revision:number};
export class Service {
  private previewSecret=randomBytes(32);
  constructor(private pool:Pool,private mode:'local'|'cloud'='local') {}
  async authenticate(token:string):Promise<Principal> {
    if(!token || token.length>512) return fail('UNAUTHORIZED','Valid local credential required',401);
    const row=(await this.pool.query(`SELECT c.id,c.human_id,c.agent_id,c.kind,c.project_ids FROM graybox.credentials c JOIN graybox.users u ON u.id=c.human_id WHERE token_hash=$1 AND revoked_at IS NULL AND ($2='local' OR (c.expires_at>now() AND u.username IS NOT NULL)) AND (c.expires_at IS NULL OR c.expires_at>now()) AND u.disabled_at IS NULL`,[createHash('sha256').update(token).digest('hex'),this.mode])).rows[0] as Principal|undefined;
    return row ?? fail('UNAUTHORIZED','Valid local credential required',401);
  }
  scope(p:Principal,projectId:string) { if(p.project_ids && !p.project_ids.includes(projectId)) fail('FORBIDDEN','Project is outside credential scope',403); }
  async people(p:Principal) {
    return this.transaction(p,async(c,current)=>{
      if(current.kind!=='human')fail('FORBIDDEN','Human profile required',403);
      return (await c.query('SELECT id,name,avatar_data FROM graybox.users WHERE disabled_at IS NULL ORDER BY name,id')).rows;
    });
  }
  async agreement(p:Principal,id:string,body?:unknown) {
    return this.transaction(p,async(c,current)=>{
      if(body!==undefined && current.kind!=='human')fail('FORBIDDEN','Only a human can agree',403);
      const project=await this.entity(c,'project',id,body!==undefined,current);
      if(body!==undefined) {
        const parsed=z.strictObject({agreed:z.boolean()}).safeParse(body);
        if(!parsed.success)return fail('VALIDATION','Agreement requires a boolean state',400);
        if(!project.creator_id || project.creator_id===current.human_id)fail('FORBIDDEN','Cannot agree with your own or unassigned project',403);
        // False before a first agreement is a no-op. Inactive history after a true remains persistent.
        if(parsed.data.agreed) {
          await c.query('INSERT INTO graybox.project_agreements(project_id,user_id,active) VALUES($1,$2,true) ON CONFLICT(project_id,user_id) DO UPDATE SET active=true,updated_at=now()',[id,current.human_id]);
          await notifyOwner(c,current,project,'agreement');
        } else await c.query('UPDATE graybox.project_agreements SET active=false,updated_at=now() WHERE project_id=$1 AND user_id=$2',[id,current.human_id]);
      }
      return agreementState(c,current,project);
    });
  }
  async notifications(p:Principal,query:unknown={}) {
    return this.transaction(p,async(c,current)=>{
      if(current.kind!=='human')fail('FORBIDDEN','Human inbox required',403);
      const parsed=z.strictObject({before:z.uuid().optional()}).safeParse(query);
      if(!parsed.success)return fail('VALIDATION','Invalid inbox cursor',400);
      if(parsed.data.before && !(await c.query('SELECT id FROM graybox.notifications WHERE id=$1 AND recipient_id=$2 AND ($3::uuid[] IS NULL OR project_id=ANY($3::uuid[]))',[parsed.data.before,current.human_id,current.project_ids])).rowCount)fail('NOT_FOUND','Inbox cursor not found',404);
      return inboxPage(c,current,parsed.data.before);
    });
  }
  async readNotifications(p:Principal,body:unknown) {
    return this.transaction(p,async(c,current)=>{
      if(current.kind!=='human')fail('FORBIDDEN','Human inbox required',403);
      const parsed=z.strictObject({ids:z.array(z.uuid()).max(100)}).safeParse(body);
      if(!parsed.success)return fail('VALIDATION','Provide up to 100 visible notification ids',400);
      await c.query('UPDATE graybox.notifications SET read_at=coalesce(read_at,now()) WHERE recipient_id=$1 AND id=ANY($2::uuid[]) AND ($3::uuid[] IS NULL OR project_id=ANY($3::uuid[]))',[current.human_id,parsed.data.ids,current.project_ids]);
      return inboxPage(c,current);
    });
  }
  async setName(p:Principal,body:unknown) {
    return this.transaction(p,async(c,current)=>{
      if(current.kind!=='human')fail('FORBIDDEN','Human profile required',403);
      const parsed=z.strictObject({name:z.string().regex(/^[^\u0000-\u001f\u007f]*$/).trim().min(1).max(100)}).safeParse(body);
      if(!parsed.success)return fail('VALIDATION','昵称需要 1–100 个字符，不能包含控制字符。',400);
      return (await c.query('SELECT * FROM graybox.set_profile_name($1,$2)',[current.id,parsed.data.name])).rows[0];
    });
  }
  async setAvatar(p:Principal,body:unknown) {
    return this.transaction(p,async(c,current)=>{
      if(current.kind!=='human')fail('FORBIDDEN','Human profile required',403);
      const parsed=z.strictObject({avatar_data:z.string().max(180000).nullable()}).safeParse(body);
      if(!parsed.success)return fail('VALIDATION','Avatar data required',400);
      if(parsed.data.avatar_data!==null&&!validAvatar(parsed.data.avatar_data))fail('VALIDATION','Avatar must be a bounded 128–256px PNG or JPEG raster',400);
      return (await c.query('UPDATE graybox.users SET avatar_data=$2 WHERE id=$1 RETURNING id,name,role,avatar_data',[current.human_id,parsed.data.avatar_data])).rows[0];
    });
  }
  private async currentPrincipal(c:Pool|PoolClient,id:string):Promise<Principal> {
    const row=(await c.query(`SELECT a.* FROM graybox.authoritative_credential($1) a JOIN graybox.credentials c ON c.id=a.id JOIN graybox.users u ON u.id=a.human_id WHERE ($2='local' OR (c.expires_at IS NOT NULL AND u.username IS NOT NULL))`,[id,this.mode])).rows[0] as Principal|undefined;
    return row??fail('UNAUTHORIZED','Credential revoked',401);
  }
  private async transaction<T>(p:Principal,fn:(c:PoolClient,current:Principal)=>Promise<T>):Promise<T> {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN'); await c.query('SELECT pg_advisory_xact_lock(77321)');
      const current=await this.currentPrincipal(c,p.id);
      const result=normalize(await fn(c,current)); await c.query('COMMIT'); return result;
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
  private async idempotent<T>(c:PoolClient,p:Principal,key:string,body:unknown,fn:()=>Promise<T>):Promise<T> {
    const hash=digest(body),prior=(await c.query('SELECT payload_hash,response FROM graybox.idempotency WHERE credential_id=$1 AND key=$2',[p.id,key])).rows[0];
    if(prior) {
      // Cached data remains private even though the original command already committed.
      // Authorization comes from the stored server response/activity, never the new payload.
      const response=prior.response as Record<string,unknown>;
      // Cached collaboration snapshots still require access to their live endpoints.
      if((response.entity_type==='idea'||response.entity_type==='experiment') && typeof response.entity_id==='string') {
        await this.collaborationEntity(c,p,response.entity_type,response.entity_id);
        if(typeof response.target_id==='string')await this.collaborationEntity(c,p,response.entity_type,response.target_id);
      }
      if(typeof response.workspace_id==='string' && 'project_id' in response && typeof response.id==='string' && 'body' in response)await idea(c,p,response.id,fail);

      if(typeof response.project_id==='string') this.scope(p,response.project_id);
      if('project_id' in response && response.project_id===null && p.project_ids!==null)fail('FORBIDDEN','Unlinked entity outside credential scope',403);
      if(!('project_id' in response) && typeof response.workspace_id==='string' && typeof response.id==='string') this.scope(p,response.id);
      if(typeof response.batch_id==='string') {
        const projects=(await c.query('SELECT DISTINCT project_id FROM graybox.activities WHERE batch_id=$1',[response.batch_id])).rows;
        for(const row of projects) this.scope(p,row.project_id);
      }
      if(prior.payload_hash!==hash) fail('IDEMPOTENCY_MISMATCH','Key was already used for a different request');return prior.response as T;
    }
    const result=normalize(await fn()); await c.query('INSERT INTO graybox.idempotency(credential_id,key,payload_hash,response) VALUES($1,$2,$3,$4)',[p.id,key,hash,result]); return result;
  }
  private async entity(c:Pool|PoolClient,type:EntityType,id:string,lock=false,p?:Principal):Promise<Entity> {
    // Immutable children need no row write lock; all domain writers share the transaction lock.
    const scoped=p?.project_ids!==undefined && p.project_ids!==null;
    const scopeColumn=type==='project'?'id':'project_id';
    const row=(await c.query(`SELECT * FROM graybox.${tables[type]} WHERE id=$1 ${scoped?`AND ${scopeColumn}=ANY($2::uuid[])`:''} ${lock && type!=='evidence' && type!=='submission'?'FOR UPDATE':''}`,scoped?[id,p.project_ids]:[id])).rows[0];
    if(!row || row.deleted_at) return fail('NOT_FOUND','Entity not found',404);
    if(type==='project' || type==='experiment') { const {data,...base}=row; const entity=normalize({...base,...data}) as Entity; return type==='project' && p ? this.presentProject(c,p,entity) : entity; }
    if(type==='evidence'||type==='submission') {
      if((await c.query('SELECT id FROM graybox.tombstones WHERE entity_type=$1 AND entity_id=$2',[type,id])).rowCount) return fail('NOT_FOUND','Entity not found',404);
      return normalize({...row,revision:1}) as Entity;
    }
    return normalize(row) as Entity;
  }
  async getProject(p:Principal,id:string) {p=await this.currentPrincipal(this.pool,p.id);return this.entity(this.pool,'project',id,false,p);}
  async getExperiment(p:Principal,id:string) {
    p=await this.currentPrincipal(this.pool,p.id);
    const e=await this.entity(this.pool,'experiment',id,false,p);
    const evidence=await this.children(this.pool,'evidence',id),submissions=await this.children(this.pool,'submissions',id);return {...await this.presentExperiment(this.pool,p,e),evidence,submissions};
  }
  private presentExperiment=presentExperiment;
  private async experimentEditable(c:PoolClient,p:Principal,e:Entity) {
    if((await experimentOwner(c,e.id)).owner_id!==p.human_id && !(await c.query("SELECT id FROM graybox.collaboration_events WHERE entity_type='experiment' AND entity_id=$1 AND author_id=$2 AND kind='join' LIMIT 1",[e.id,p.human_id])).rowCount)fail('FORBIDDEN','Only experiment owner may edit',403);
  }
  async getIdea(p:Principal,id:string) {return this.transaction(p,(c,current)=>idea(c,current,id,fail));}
  async ideas(p:Principal,query:unknown) {
    return this.transaction(p,async(c,current)=>{
      const parsed=z.strictObject({project_id:z.uuid().optional(),unlinked:z.enum(['true','false']).optional()}).safeParse(query);
      if(!parsed.success)fail('VALIDATION','Invalid idea query',400);
      const rows=(await c.query('SELECT id FROM graybox.ideas WHERE ($1::uuid IS NULL OR project_id=$1) AND ($2::boolean=false OR project_id IS NULL) ORDER BY created_at,id',[parsed.data!.project_id??null,parsed.data!.unlinked==='true'])).rows;
      const out=[];for(const row of rows){try{out.push(await idea(c,current,row.id,fail));}catch(e){if(!(e instanceof DomainError&&e.code==='NOT_FOUND'))throw e;}}return out;
    });
  }
  private async collaborationEntity(c:PoolClient,p:Principal,type:'idea'|'experiment',id:string) {
    return type==='idea'?idea(c,p,id,fail):this.presentExperiment(c,p,await this.entity(c,'experiment',id,true,p));
  }
  async collaboration(p:Principal,query:unknown) {
    return this.transaction(p,async(c,current)=>{
      const parsed=z.strictObject({entity_type:z.enum(['idea','experiment']),entity_id:z.uuid()}).safeParse(query);
      if(!parsed.success)return fail('VALIDATION','Entity required',400);
      const t=parsed.data,e=await this.collaborationEntity(c,current,t.entity_type,t.entity_id);
      const events=(await c.query('SELECT e.*,u.name AS author_name FROM graybox.collaboration_events e JOIN graybox.users u ON u.id=e.author_id WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at,id',[t.entity_type,t.entity_id])).rows;
      const latest=new Map<string,any>();for(const event of events.filter(x=>x.kind==='agreement'))latest.set(event.author_id,event);
      const requests=(await c.query('SELECT r.*,d.decision AS resolved_decision,d.selected_fields AS adopted_fields FROM graybox.merge_requests r LEFT JOIN graybox.merge_decisions d ON d.request_id=r.id WHERE r.entity_type=$1 AND (r.entity_id=$2 OR r.target_id=$2) ORDER BY r.created_at,r.id',[t.entity_type,t.entity_id])).rows;
      const merge_requests=[];for(const r of requests){try{const target=await this.collaborationEntity(c,current,t.entity_type,r.target_id);const branch=await this.collaborationEntity(c,current,t.entity_type,r.entity_id);merge_requests.push({...r,project_id:target.project_id??null,target_project_id:target.project_id??null,source_project_id:branch.project_id??null,decision:r.resolved_decision??null,can_resolve:target.owner_id===current.human_id&&!r.resolved_decision,target_revision:target.revision});}catch(error){if(!(error instanceof DomainError&&error.code==='NOT_FOUND'))throw error;}}
      return {comments:events.filter(x=>x.kind==='comment').map(x=>({...x,body:x.data.body})),participants:[...new Map(events.filter(x=>x.kind==='join').map(x=>[x.author_id,x])).values()],agreements:{count:[...latest.values()].filter(x=>x.data.agreed).length,agreed:latest.get(current.human_id)?.data.agreed??false},merge_requests};
    });
  }
  async getMergeRequest(p:Principal,id:string) {
    return this.transaction(p,async(c,current)=>{
      const r=(await c.query('SELECT r.*,d.decision AS resolved_decision FROM graybox.merge_requests r LEFT JOIN graybox.merge_decisions d ON d.request_id=r.id WHERE r.id=$1',[id])).rows[0];
      if(!r)return fail('NOT_FOUND','Merge request not found',404);
      const target=await this.collaborationEntity(c,current,r.entity_type,r.target_id);const branch=await this.collaborationEntity(c,current,r.entity_type,r.entity_id);
      const project=target.project_id?await this.entity(c,'project',target.project_id,false,current):null;
      return {...r,project_id:target.project_id??null,target_project_id:target.project_id??null,source_project_id:branch.project_id??null,decision:r.resolved_decision??null,workspace_id:target.workspace_id??project?.workspace_id,can_resolve:target.owner_id===current.human_id&&!r.resolved_decision,target_revision:target.revision};
    });
  }
  async collaborationNotifications(p:Principal,body?:unknown) {
    return this.transaction(p,async(c,current)=>{
      if(current.kind!=='human')fail('FORBIDDEN','Human inbox required',403);
      if(body!==undefined){const parsed=z.strictObject({ids:z.array(z.uuid()).max(100)}).safeParse(body);if(!parsed.success)return fail('VALIDATION','Notification ids required',400);await c.query('UPDATE graybox.collaboration_notifications SET read_at=coalesce(read_at,now()) WHERE recipient_id=$1 AND id=ANY($2::uuid[]) AND ($3::uuid[] IS NULL OR project_id=ANY($3::uuid[]))',[current.human_id,parsed.data.ids,current.project_ids]);}
      const items=(await c.query('SELECT n.*,u.name AS actor_name FROM graybox.collaboration_notifications n JOIN graybox.users u ON u.id=n.actor_id WHERE recipient_id=$1 AND ($2::uuid[] IS NULL OR project_id=ANY($2::uuid[])) ORDER BY created_at DESC,id DESC LIMIT 100',[current.human_id,current.project_ids])).rows;
      return {items,unread_count:items.filter(x=>!x.read_at).length};
    });
  }
  private async collaborationCommand(p:Principal,command:CollaborationCommand,input:unknown) {
    return this.transaction(p,(c,current)=>this.idempotent(c,current,command.idempotency_key,input,async()=>{
      p=current;await this.batch(c,p,command.batch_id);let result:any,before:Entity|null=null,entityType:'idea'|'experiment'='idea';
      const owner=(e:Entity)=>{if(e.owner_id!==p.human_id)fail('FORBIDDEN','Only entity owner may edit',403);};
      const project=async(id:string|null|undefined)=>{if(id)await this.entity(c,'project',id,true,p);else if(p.project_ids!==null)fail('FORBIDDEN','Unlinked ideas require unrestricted credential',403);};
      const notify=async(e:Entity,kind:string)=>{if(e.owner_id&&e.owner_id!==p.human_id)await c.query('INSERT INTO graybox.collaboration_notifications(id,recipient_id,actor_id,agent_id,entity_type,entity_id,project_id,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),e.owner_id,p.human_id,p.agent_id,entityType,e.id,e.project_id??null,kind]);};
      if(command.type==='idea_create') {
        await project(command.payload.project_id);const workspace=command.payload.project_id?(await this.entity(c,'project',command.payload.project_id,false,p)).workspace_id:command.payload.workspace_id??(await c.query('SELECT id FROM graybox.workspaces ORDER BY id LIMIT 1')).rows[0]?.id;
        if(!(await c.query('SELECT id FROM graybox.workspaces WHERE id=$1',[workspace])).rowCount)fail('NOT_FOUND','Workspace not found',404);
        const id=randomUUID();await c.query('INSERT INTO graybox.ideas(id,project_id,owner_id,data,workspace_id) VALUES($1,$2,$3,$4,$5)',[id,command.payload.project_id??null,p.human_id,{name:command.payload.name,body:command.payload.body,priority:command.payload.priority??'medium'},workspace]);result=await idea(c,p,id,fail);
      } else if(command.type==='idea_update') {
        before=await idea(c,p,command.payload.id,fail);owner(before);this.revision(before,command.expected_revision);const fields=command.payload;
        if(fields.project_id!==undefined)await project(fields.project_id);
        await c.query('UPDATE graybox.ideas SET data=$2,project_id=$3,workspace_id=$4,revision=revision+1,updated_at=now() WHERE id=$1',[before.id,{name:fields.name??before.name,body:fields.body??before.body,priority:fields.priority??before.priority??'medium'},fields.project_id===undefined?before.project_id:fields.project_id,fields.project_id?(await this.entity(c,'project',fields.project_id,false,p)).workspace_id:before.workspace_id]);result=await idea(c,p,before.id,fail);
      } else if(command.type==='merge_resolve') {
        const r=(await c.query('SELECT * FROM graybox.merge_requests WHERE id=$1',[command.payload.id])).rows[0];if(!r)return fail('NOT_FOUND','Merge request not found',404);
        entityType=r.entity_type;const branch=await this.collaborationEntity(c,p,entityType,r.entity_id);before=await this.collaborationEntity(c,p,entityType,r.target_id);owner(before);this.revision(r,command.expected_revision);this.revision(before,command.payload.expected_target_revision);
        if((await c.query('SELECT id FROM graybox.merge_decisions WHERE request_id=$1',[r.id])).rowCount)fail('MERGE_RESOLVED','Already resolved');
        const chosen=command.payload.decision==='reject'?[]:command.payload.decision==='accept'?r.selected_fields:command.payload.selected_fields??[];
        if(command.payload.decision==='partial'&&!chosen.length)fail('VALIDATION','Select fields for partial adoption',400);
        if(chosen.some((k:string)=>!r.selected_fields.includes(k)))fail('VALIDATION','Cannot adopt unsubmitted content',400);
        const fields=Object.fromEntries(chosen.map((k:string)=>[k,r.snapshot[k]]));
        if(chosen.length){if(entityType==='idea'){await c.query('UPDATE graybox.ideas SET data=$2,revision=revision+1,updated_at=now() WHERE id=$1',[before.id,{name:before.name,body:before.body,priority:before.priority??'medium',...fields}]);}else await this.save(c,'experiment',before,{...this.business(before,'experiment'),...fields});}
        result=await this.collaborationEntity(c,p,entityType,before.id);
        await c.query('INSERT INTO graybox.merge_decisions(id,request_id,author_id,decision,selected_fields,target_revision) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),r.id,p.human_id,command.payload.decision,JSON.stringify(chosen),result.revision]);
        await notify(branch,'merge_decision');
        await c.query('INSERT INTO graybox.activities(id,batch_id,credential_id,human_id,agent_id,session_id,entity_type,entity_id,project_id,type,before,after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[randomUUID(),command.batch_id,p.id,p.human_id,p.agent_id,command.session_id??null,entityType,result.id,result.project_id??null,'collaboration_merge_target',before,result]);
        result={...r,decision:command.payload.decision,target_revision:result.revision,adopted_fields:chosen};
      } else {
        entityType=command.payload.entity_type;before=await this.collaborationEntity(c,p,entityType,command.payload.entity_id);this.revision(before,command.expected_revision);
        if(command.type==='entity_branch') {
          const source={entity_type:entityType,entity_id:before.id,revision:before.revision,author_id:before.owner_id,snapshot:before},id=randomUUID();
          if(entityType==='idea'){await c.query('INSERT INTO graybox.ideas(id,project_id,owner_id,data,source,workspace_id) VALUES($1,$2,$3,$4,$5,$6)',[id,before.project_id??null,p.human_id,{name:command.payload.name??before.name,body:before.body,priority:before.priority??'medium'},source,before.workspace_id]);result=await idea(c,p,id,fail);}
          else {const series=await this.entity(c,'series',String(before.series_id),true,p);const v=(await c.query('UPDATE graybox.experiment_series SET next_version=next_version+1 WHERE id=$1 RETURNING next_version-1 AS version',[series.id])).rows[0].version;await c.query('INSERT INTO graybox.experiments(id,project_id,series_id,version,revision,data) VALUES($1,$2,$3,$4,1,$5)',[id,before.project_id,before.series_id,v,{...this.business(before,'experiment'),name:command.payload.name??before.name,based_on:before.id,status:'idea',progress:'todo',outcome:'inconclusive',summary:'',change_summary:''}]);await c.query('INSERT INTO graybox.experiment_collaboration(experiment_id,owner_id,source) VALUES($1,$2,$3)',[id,p.human_id,source]);result=await this.collaborationEntity(c,p,entityType,id);}
        } else if(command.type==='merge_submit') {
          owner(before);const source=before.source as any;if(!source||source.entity_type!==entityType)fail('VALIDATION','Only a branch of the same entity type can submit merge',400);const target=await this.collaborationEntity(c,p,entityType,source.entity_id);
          const allowed=entityType==='idea'?['name','body']:['name','goal','summary','change_summary'];if(command.payload.selected_fields.some(k=>!allowed.includes(k)))fail('VALIDATION','Field unavailable for entity',400);
          await c.query('INSERT INTO graybox.activities(id,batch_id,credential_id,human_id,agent_id,session_id,entity_type,entity_id,project_id,type,before,after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[randomUUID(),command.batch_id,p.id,p.human_id,p.agent_id,command.session_id??null,entityType,target.id,target.project_id??null,'collaboration_merge_requested',target,target]);
          result=(await c.query('INSERT INTO graybox.merge_requests(id,entity_type,entity_id,target_id,project_id,author_id,snapshot,selected_fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[randomUUID(),entityType,before.id,target.id,before.project_id??null,p.human_id,before,JSON.stringify(command.payload.selected_fields)])).rows[0];await notify(target,'merge_request');
        } else {
          if(command.type==='entity_agree'&&(p.kind!=='human'||before.owner_id===p.human_id))fail('FORBIDDEN','Agreement requires another human',403);
          const kind=command.type==='entity_join'?'join':command.type==='entity_comment'?'comment':'agreement';
          const data=command.type==='entity_comment'?{body:command.payload.body}:command.type==='entity_agree'?{agreed:command.payload.agreed}:{};
          result=(await c.query('INSERT INTO graybox.collaboration_events(id,entity_type,entity_id,project_id,kind,author_id,agent_id,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[randomUUID(),entityType,before.id,before.project_id??null,kind,p.human_id,p.agent_id,data])).rows[0];result={...result,revision:1};if(kind!=='join')await notify(before,kind);
        }
      }
      result={...result,batch_id:command.batch_id};
      // Immutable collaboration activities make the entire batch unavailable to legacy undo.
      await c.query('INSERT INTO graybox.activities(id,batch_id,credential_id,human_id,agent_id,session_id,entity_type,entity_id,project_id,type,before,after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[randomUUID(),command.batch_id,p.id,p.human_id,p.agent_id,command.session_id??null,entityType,result.id,result.project_id??before?.project_id??null,'collaboration_'+command.type,before,result]);
      await c.query('UPDATE graybox.batches SET operation_count=operation_count+1,revision=revision+1 WHERE id=$1',[command.batch_id]);return result;
    }));
  }
  private async canEdit(c:Pool|PoolClient,p:Principal,project:Entity) {
    return project.creator_id===p.human_id;
  }
  private async editable(c:Pool|PoolClient,p:Principal,project:Entity) {
    if(!await this.canEdit(c,p,project)) fail('FORBIDDEN','Only the project owner may edit this project',403);
  }
  private async presentProject(c:Pool|PoolClient,p:Principal,project:Entity):Promise<Entity> {
    const creator=project.creator_id?(await c.query('SELECT name FROM graybox.users WHERE id=$1',[project.creator_id])).rows[0]:null;
    const can_edit=await this.canEdit(c,p,project);
    return {...project,creator_name:creator?.name??null,owner_id:project.creator_id??null,owner_name:creator?.name??null,project_role:can_edit?'owner':'member',can_edit};
  }
  private async projectData(c:PoolClient,workspace:string,data:Record<string,unknown>) {
    const names:string[]=[];
    for(const raw of (data.tags??[]) as string[]) {
      const name=raw.trim().replace(/\s+/g,' '),key=name.toLowerCase();
      const existing=(await c.query('SELECT name FROM graybox.tags WHERE workspace_id=$1 AND normalized_name=$2',[workspace,key])).rows[0];
      const canonicalName=existing?.name??name;
      if(!existing)await c.query('INSERT INTO graybox.tags(id,workspace_id,name,normalized_name) VALUES($1,$2,$3,$4)',[randomUUID(),workspace,name,key]);
      if(!names.includes(canonicalName))names.push(canonicalName);
    }
    return {...data,tags:names};
  }
  async list(p:Principal,type:'projects'|'experiments',project_id?:string,tag?:string) {
    p=await this.currentPrincipal(this.pool,p.id);
    if(project_id) this.scope(p,project_id);
    const rows=(await this.pool.query(`SELECT * FROM graybox.${type} WHERE deleted_at IS NULL ${type==='experiments'&&project_id?'AND project_id=$1':''} ORDER BY ${type==='projects'?"CASE data->>'priority' WHEN 'high' THEN 0 WHEN 'low' THEN 2 ELSE 1 END,":''}created_at,id`,type==='experiments'&&project_id?[project_id]:[])).rows;
    const visible=rows.filter(row=>p.project_ids===null || p.project_ids.includes(type==='projects'?row.id:row.project_id)).map(row=>normalize({...Object.fromEntries(Object.entries(row).filter(([k])=>k!=='data')),...row.data}) as Entity);
    const key=tag?.trim().replace(/\s+/g,' ').toLowerCase();
    return Promise.all(visible.filter(row=>!key || ((row.tags??[]) as string[]).some(t=>t.toLowerCase()===key)).map(row=>type==='projects'?this.presentProject(this.pool,p,row):this.presentExperiment(this.pool,p,row)));
  }
  async tags(p:Principal,workspace?:string,q?:string) {
    p=await this.currentPrincipal(this.pool,p.id);
    const rows=(await this.pool.query('SELECT id,workspace_id,name FROM graybox.tags WHERE ($1::uuid IS NULL OR workspace_id=$1) ORDER BY normalized_name,id',[workspace??null])).rows;
    const key=q?.trim().replace(/\s+/g,' ').toLowerCase();
    // Scoped agents only see tags already associated with accessible projects.
    const projects=p.project_ids===null?null:await this.list(p,'projects');
    return rows.filter(row=>(!key || row.name.toLowerCase().includes(key)) && (!projects || projects.some(pr=>pr.workspace_id===row.workspace_id && ((pr.tags??[]) as string[]).includes(row.name))));
  }
  async projectChildren(p:Principal,id:string,table:'retrospectives'|'comments') {
    p=await this.currentPrincipal(this.pool,p.id);await this.entity(this.pool,'project',id,false,p);
    return normalize((await this.pool.query(`SELECT x.*,u.name AS author_name FROM graybox.${table} x JOIN graybox.users u ON u.id=x.author_id WHERE project_id=$1 ORDER BY x.created_at,x.id`,[id])).rows.map(({data,...row})=>({...row,...data})));
  }
  async activity(p:Principal,entity_id?:string,batch_id?:string) {
    p=await this.currentPrincipal(this.pool,p.id);
    const rows=(await this.pool.query('SELECT * FROM graybox.activities WHERE ($1::uuid IS NULL OR entity_id=$1) AND ($2::uuid IS NULL OR batch_id=$2) ORDER BY created_at,id',[entity_id??null,batch_id??null])).rows;
    return rows.filter(row=>p.project_ids===null || p.project_ids.includes(row.project_id));
  }
  async health() {return {environment_id:(await this.pool.query("SELECT value FROM graybox.metadata WHERE key='environment_id'")).rows[0].value,mode:this.mode};}
  async workspaces() {return (await this.pool.query('SELECT * FROM graybox.workspaces ORDER BY name')).rows;}
  private async children(c:Pool|PoolClient,table:'evidence'|'submissions',id:string) {
    return normalize((await c.query(`SELECT x.* FROM graybox.${table} x WHERE experiment_id=$1 AND NOT EXISTS(SELECT 1 FROM graybox.tombstones t WHERE t.entity_type=$2 AND t.entity_id=x.id) ORDER BY created_at,id`,[id,table==='evidence'?'evidence':'submission'])).rows);
  }
  private async batch(c:PoolClient,p:Principal,id:string) {
    let b=(await c.query('SELECT * FROM graybox.batches WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(b && b.credential_id!==p.id) fail('FORBIDDEN','Batch belongs to another credential',403);
    if(b && (b.closed_at || b.undone_at || b.operation_count>=50 || Date.now()-new Date(b.created_at).getTime()>30*60*1000)) fail('BATCH_CLOSED','Batch is closed, expired or full');
    if(!b) b=(await c.query('INSERT INTO graybox.batches(id,credential_id) VALUES($1,$2) RETURNING *',[id,p.id])).rows[0];
    return b;
  }
  private async record(c:PoolClient,p:Principal,batchId:string,type:string,entityType:EntityType,before:Entity|null,after:Entity,session?:string) {
    await c.query('INSERT INTO graybox.activities(id,batch_id,credential_id,human_id,agent_id,session_id,entity_type,entity_id,project_id,type,before,after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[randomUUID(),batchId,p.id,p.human_id,p.agent_id,session??null,entityType,after.id,entityType==='project'?after.id:after.project_id,type,before,after]);
  }
  private revision(entity:Entity,expected:number) {if(entity.revision!==expected) fail('REVISION_CONFLICT','Expected revision does not match current revision');}
  private async save(c:PoolClient,type:'project'|'experiment',entity:Entity,data:Record<string,unknown>) {
    const after=(await c.query(`UPDATE graybox.${tables[type]} SET data=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,[entity.id,data])).rows[0];
    const {data:business,...base}=after;return normalize({...base,...business}) as Entity;
  }
  private business(entity:Entity,type:'project'|'experiment') {
    const fields=type==='project'?['name','description','status','repo_url','lifecycle','priority','tags']:['name','goal','summary','change_summary','status','based_on','progress','priority','outcome'];
    const data=Object.fromEntries(fields.filter(k=>entity[k]!==undefined).map(k=>[k,entity[k]]));
    if(type==='project') return {lifecycle:entity.status==='paused'?'paused':entity.status==='archived'?'completed':'in_progress',priority:'medium',tags:[],...data};
    return data;
  }
  async command(p:Principal,input:unknown) {
    const collab=collaborationCommandSchema.safeParse(input); if(collab.success)return this.collaborationCommand(p,collab.data,input);
    const parsed=legacyCommandSchema.safeParse(input); if(!parsed.success) return fail('VALIDATION','Invalid command shape or fields',400);
    const command=parsed.data;
    return this.transaction(p,(c,p)=>this.idempotent(c,p,command.idempotency_key,input,async()=> {
      const {type,batch_id,session_id,payload}=command;
      await this.batch(c,p,batch_id);
      let result:Entity;
      if(type==='project_create') {
        if(p.project_ids!==null) fail('FORBIDDEN','Restricted credentials cannot create projects',403);
        if(!(await c.query('SELECT id FROM graybox.workspaces WHERE id=$1',[payload.workspace_id])).rowCount) fail('NOT_FOUND','Workspace not found',404);
        const id=randomUUID(); const {workspace_id,...data}=payload;
        const lifecycle=data.lifecycle??(data.status==='paused'?'paused':data.status==='archived'?'completed':data.status==='active'?'in_progress':'todo');
        const business=await this.projectData(c,workspace_id,{description:'',priority:'medium',...data,lifecycle,status:lifecycle==='paused'?'paused':lifecycle==='completed'?'archived':'active'});
        await c.query('INSERT INTO graybox.projects(id,workspace_id,revision,data,creator_id) VALUES($1,$2,1,$3,$4)',[id,workspace_id,business,p.human_id]);
        result=await this.entity(c,'project',id,false,p); await this.record(c,p,batch_id,type,'project',null,result,session_id);
      } else if(type==='project_update') {
        this.scope(p,payload.id); const before=await this.entity(c,'project',payload.id,true);await this.editable(c,p,before);this.revision(before,command.expected_revision);
        const {id,...rawFields}=payload;
        const fields=rawFields as Record<string,unknown>;
        const lifecycle=fields.lifecycle??(fields.status?(fields.status==='paused'?'paused':fields.status==='archived'?'completed':'in_progress'):before.lifecycle);
        const data=await this.projectData(c,String(before.workspace_id),{...this.business(before,'project'),...fields,lifecycle,status:lifecycle==='paused'?'paused':lifecycle==='completed'?'archived':'active'});
        result=await this.presentProject(c,p,await this.save(c,'project',before,data));await this.record(c,p,batch_id,type,'project',before,result,session_id);
      } else if(type==='retrospective_create' || type==='comment_create') {
        const before=await this.entity(c,'project',payload.project_id,true,p);
        if(type==='retrospective_create')await this.editable(c,p,before);
        this.revision(before,command.expected_revision);
        const id=randomUUID(),{project_id,...data}=payload;
        const table=type==='comment_create'?'comments':'retrospectives';
        const child=(await c.query(`INSERT INTO graybox.${table}(id,project_id,batch_id,author_id,agent_id,${type==='comment_create'?'body':'data'}) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[id,project_id,batch_id,p.human_id,p.agent_id,type==='comment_create'?(data as {body:string}).body:data])).rows[0];
        if(type==='comment_create')await notifyOwner(c,p,before,'comment',id);
        const parent=await this.save(c,'project',before,this.business(before,'project'));
        const author=(await c.query('SELECT name FROM graybox.users WHERE id=$1',[p.human_id])).rows[0];
        result=normalize({...Object.fromEntries(Object.entries(child).filter(([k])=>k!=='data')),...child.data,revision:1,author_name:author.name,project_revision:parent.revision}) as Entity;
        await this.record(c,p,batch_id,type,type==='comment_create'?'comment':'retrospective',null,result,session_id);
        await this.record(c,p,batch_id,type,'project',before,parent,session_id);
      } else if(type==='experiment_create') {
        this.scope(p,payload.project_id);await this.entity(c,'project',payload.project_id,true);
        let seriesId=payload.series_id;
        if(!seriesId) {
          seriesId=randomUUID();await c.query('INSERT INTO graybox.experiment_series(id,project_id,name) VALUES($1,$2,$3)',[seriesId,payload.project_id,payload.series_name]);
          await this.record(c,p,batch_id,type,'series',null,await this.entity(c,'series',seriesId),session_id);
        }
        const series=await this.entity(c,'series',seriesId,true,p);if(series.project_id!==payload.project_id) fail('VALIDATION','Series project mismatch',400);
        if(payload.based_on) {const source=await this.entity(c,'experiment',payload.based_on,false,p);if(source.project_id!==payload.project_id) fail('VALIDATION','Source project mismatch',400);}
        const v=(await c.query('UPDATE graybox.experiment_series SET next_version=next_version+1 WHERE id=$1 RETURNING next_version-1 AS version',[seriesId])).rows[0].version;
        const id=randomUUID();await c.query('INSERT INTO graybox.experiments(id,project_id,series_id,version,revision,data) VALUES($1,$2,$3,$4,1,$5)',[id,payload.project_id,seriesId,v,{name:payload.name,goal:payload.goal,status:'idea',summary:'',change_summary:'',progress:payload.progress??'todo',priority:payload.priority??'medium',outcome:payload.outcome??'inconclusive',...(payload.based_on?{based_on:payload.based_on}:{})}]);
        const sourceIdea=payload.source_idea_id?await idea(c,p,payload.source_idea_id,fail):null;
        const sourceExperiment=payload.based_on?await this.presentExperiment(c,p,await this.entity(c,'experiment',payload.based_on,false,p)):null;const source=sourceIdea??sourceExperiment;
        await c.query('INSERT INTO graybox.experiment_collaboration(experiment_id,owner_id,source) VALUES($1,$2,$3)',[id,p.human_id,source?{entity_type:sourceIdea?'idea':'experiment',entity_id:source.id,revision:source.revision,author_id:source.owner_id,snapshot:source}:null]);
        result=await this.presentExperiment(c,p,await this.entity(c,'experiment',id));await this.record(c,p,batch_id,type,'experiment',null,result,session_id);
      } else {
        const id=type==='experiment_update'?payload.id:payload.experiment_id;
        const before=await this.entity(c,'experiment',id,true,p);
        await this.experimentEditable(c,p,before);
        this.revision(before,command.expected_revision);
        let data=this.business(before,'experiment');
        if(type==='experiment_update') {
          const {id:ignored,...fields}=payload;
          if((await experimentOwner(c,id)).owner_id!==p.human_id && Object.keys(fields).some(k=>!['summary','change_summary','progress'].includes(k)))fail('FORBIDDEN','Only leader can change experiment metadata',403);
          if(fields.status && !['idea','waiting_for_review'].includes(String(before.status))) fail('INVALID_TRANSITION','Only idea or waiting_for_review may resume experimenting');
          data={...data,...fields};
        } else if(type==='evidence_append') {
          const evidenceId=randomUUID();const {experiment_id,...fields}=payload;
          await c.query('INSERT INTO graybox.evidence(id,experiment_id,project_id,batch_id,type,source_kind,result,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[evidenceId,id,before.project_id,batch_id,fields.type,fields.source_kind,fields.result,fields.details]);
          await this.record(c,p,batch_id,type,'evidence',null,await this.entity(c,'evidence',evidenceId),session_id);
        } else {
          const reviewers=payload.reviewers??[];
          if(reviewers.length && (await c.query('SELECT id FROM graybox.users WHERE id=ANY($1::uuid[])',[reviewers])).rowCount!==new Set(reviewers).size) fail('VALIDATION','Unknown human reviewer',400);
          const evidence=await this.children(c,'evidence',id),submissionId=randomUUID();
          const commits=evidence.filter(e=>e.type==='git').flatMap(e=>e.details.commits);
          const snapshot={experiment:before,goal:before.goal,summary:before.summary,change_summary:before.change_summary,evidence,commits};
          await c.query('INSERT INTO graybox.submissions(id,experiment_id,project_id,batch_id,reviewers,snapshot) VALUES($1,$2,$3,$4,$5,$6)',[submissionId,id,before.project_id,batch_id,JSON.stringify(reviewers),snapshot]);
          await this.record(c,p,batch_id,type,'submission',null,await this.entity(c,'submission',submissionId),session_id);data={...data,status:'waiting_for_review'};
          await c.query('UPDATE graybox.batches SET closed_at=now() WHERE id=$1',[batch_id]);
        }
        result=await this.save(c,'experiment',before,data);await this.record(c,p,batch_id,type,'experiment',before,result,session_id);
      }
      await c.query('UPDATE graybox.batches SET operation_count=operation_count+1,revision=revision+1 WHERE id=$1',[batch_id]);return result;
    }));
  }
  private async undoChanges(c:PoolClient,p:Principal,batchId:string):Promise<{batch:Record<string,unknown>;changes:Change[]}> {
    const batch=(await c.query('SELECT * FROM graybox.batches WHERE id=$1 FOR UPDATE',[batchId])).rows[0];
    if(!batch) return fail('NOT_FOUND','Batch not found',404);
    if(batch.credential_id!==p.id) fail('FORBIDDEN','Only batch credential owner may undo',403);
    if(batch.undone_at || Date.now()-new Date(batch.created_at).getTime()>30*24*60*60*1000) fail('UNDO_UNAVAILABLE','Batch already undone or beyond 30 days');
    const rows=(await c.query('SELECT * FROM graybox.activities WHERE batch_id=$1 ORDER BY created_at,id',[batchId])).rows;
    if(rows.some(a=>a.type.startsWith('collaboration_') || ['comment','retrospective'].includes(a.entity_type))) fail('UNDO_UNAVAILABLE','This batch contains immutable comments or retrospectives; create a correction comment or a new retrospective instead');
    const changes=new Map<string,Change>();
    for(const a of rows) {
      this.scope(p,a.project_id);const key=`${a.entity_type}:${a.entity_id}`;const previous=changes.get(key);
      changes.set(key,{entity_type:a.entity_type,entity_id:a.entity_id,project_id:a.project_id,before:previous?previous.before:a.before,after:a.after,expected_revision:a.after.revision});
    }
    const sorted=[...changes.values()].sort((a,b)=>`${a.entity_type}:${a.entity_id}`.localeCompare(`${b.entity_type}:${b.entity_id}`));
    // Every domain entity belongs to a project; historical batch ownership is not edit authority.
    for(const projectId of new Set(sorted.map(change=>change.project_id))) {
      await this.editable(c,p,await this.entity(c,'project',projectId,true,p));
    }
    for(const change of sorted) {
      const current=await this.entity(c,change.entity_type,change.entity_id,true);
      if(current.revision!==change.expected_revision) fail('UNDO_CONFLICT','Entity has a later revision');
      const firstRevision=change.before?.revision??0;
      const later=await c.query("SELECT id FROM graybox.activities WHERE entity_type=$1 AND entity_id=$2 AND batch_id<>$3 AND (after->>'revision')::integer>$4",[change.entity_type,change.entity_id,batchId,firstRevision]);
      if(later.rowCount) fail('UNDO_CONFLICT','Another batch mutated this entity after the batch baseline');
      if(!change.before) {
        const checks: Array<[string,string,unknown[]]>=[];
        if(change.entity_type==='project' && (await c.query('SELECT id FROM graybox.comments WHERE project_id=$1 UNION ALL SELECT id FROM graybox.retrospectives WHERE project_id=$1',[change.entity_id])).rowCount) fail('UNDO_DEPENDENCY','Project has immutable comments or retrospectives; preserve the project');
        if(change.entity_type==='project' && (await c.query('SELECT user_id FROM graybox.project_agreements WHERE project_id=$1',[change.entity_id])).rowCount) fail('UNDO_DEPENDENCY','Project has external agreement history; preserve the project');
        if(change.entity_type==='project' && (await c.query('SELECT id FROM graybox.ideas WHERE project_id=$1 UNION ALL SELECT entity_id AS id FROM graybox.collaboration_events WHERE project_id=$1 UNION ALL SELECT id FROM graybox.merge_requests WHERE project_id=$1',[change.entity_id])).rowCount)fail('UNDO_DEPENDENCY','Project has collaboration history');
        if(change.entity_type==='experiment' && (await c.query("SELECT id FROM graybox.collaboration_events WHERE entity_type='experiment' AND entity_id=$1 UNION ALL SELECT id FROM graybox.merge_requests WHERE entity_type='experiment' AND (entity_id=$1 OR target_id=$1) UNION ALL SELECT experiment_id AS id FROM graybox.experiment_collaboration WHERE source->>'entity_id'=$2",[change.entity_id,change.entity_id])).rowCount)fail('UNDO_DEPENDENCY','Experiment has collaboration history');
        if(change.entity_type==='project') checks.push(['experiments','project_id',[change.entity_id]],['experiment_series','project_id',[change.entity_id]]);
        if(change.entity_type==='series') checks.push(['experiments','series_id',[change.entity_id]]);
        if(change.entity_type==='experiment') {
          checks.push(['evidence','experiment_id',[change.entity_id]],['submissions','experiment_id',[change.entity_id]]);
          const based=(await c.query("SELECT id FROM graybox.experiments WHERE data->>'based_on'=$1 AND deleted_at IS NULL",[change.entity_id])).rows;
          if(based.some(row=>!changes.has(`experiment:${row.id}`))) fail('UNDO_DEPENDENCY','External experiment depends on creation');
        }
        for(const [table,column,params] of checks) {
          const childType:EntityType=table==='experiment_series'?'series':table==='experiments'?'experiment':table==='evidence'?'evidence':'submission';
          const children=(await c.query(`SELECT x.id FROM graybox.${table} x WHERE ${column}=$1 ${['experiments','experiment_series'].includes(table)?'AND deleted_at IS NULL':"AND NOT EXISTS(SELECT 1 FROM graybox.tombstones t WHERE t.entity_id=x.id)"}`,params)).rows;
          if(children.some(row=>!changes.has(`${childType}:${row.id}`))) fail('UNDO_DEPENDENCY','External child prevents batch undo');
        }
      }
    }
    return {batch,changes:sorted};
  }
  async preview(p:Principal,batchId:string) {
    return this.transaction(p,async(c,p)=> {
      const {batch,changes}=await this.undoChanges(c,p,batchId);
      if(!batch.closed_at) {await c.query('UPDATE graybox.batches SET closed_at=now(),revision=revision+1 WHERE id=$1',[batchId]);batch.revision=Number(batch.revision)+1;}
      const expires=Date.now()+5*60*1000;
      const payload=Buffer.from(JSON.stringify({principal:p.id,batch_id:batchId,batch_revision:batch.revision,expires,fingerprint:digest(changes)})).toString('base64url');
      const signed=createHmac('sha256',this.previewSecret).update(payload).digest('base64url');
      return {batch_id:batchId,batch_revision:batch.revision,preview_token:`${payload}.${signed}`,expires_at:new Date(expires).toISOString(),changes};
    });
  }
  async undo(p:Principal,batchId:string,input:unknown) {
    const parsed=undoSchema.safeParse(input);if(!parsed.success) return fail('VALIDATION','Invalid undo request',400);const body=parsed.data;
    return this.transaction(p,(c,p)=>this.idempotent(c,p,body.idempotency_key,{batch_id:batchId,...body},async()=> {
      if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(body.preview_token)) fail('PREVIEW_INVALID','Invalid signed preview encoding');
      const [payload,signature]=body.preview_token.split('.');
      const expected=createHmac('sha256',this.previewSecret).update(payload??'').digest('base64url');
      if(!signature || signature.length!==expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) fail('PREVIEW_INVALID','Invalid signed preview');
      let preview:{principal:string;batch_id:string;batch_revision:number;expires:number;fingerprint:string};
      try {preview=JSON.parse(Buffer.from(payload!,'base64url').toString('utf8'));} catch {return fail('PREVIEW_INVALID','Malformed signed preview');}
      if(preview.principal!==p.id || preview.batch_id!==batchId || preview.expires<Date.now()) fail('PREVIEW_INVALID','Preview is expired or does not belong to this credential/batch');
      const {batch,changes}=await this.undoChanges(c,p,batchId);
      if(batch.revision!==body.expected_batch_revision || preview.batch_revision!==batch.revision || digest(changes)!==preview.fingerprint) fail('UNDO_CONFLICT','Preview changed; re-preview required');
      const compensation=randomUUID();await c.query('INSERT INTO graybox.batches(id,credential_id,closed_at,compensates) VALUES($1,$2,now(),$3)',[compensation,p.id,batchId]);
      for(const change of changes) {
        let after:Entity;
        if(change.entity_type==='evidence'||change.entity_type==='submission') {
          await c.query('INSERT INTO graybox.tombstones(id,batch_id,entity_type,entity_id) VALUES($1,$2,$3,$4)',[randomUUID(),compensation,change.entity_type,change.entity_id]);
          after={...change.after,revision:2,deleted_at:new Date().toISOString()};
        } else if(!change.before) {
          const row=(await c.query(`UPDATE graybox.${tables[change.entity_type]} SET deleted_at=now(),revision=revision+1 WHERE id=$1 RETURNING *`,[change.entity_id])).rows[0];
          after=normalize({...Object.fromEntries(Object.entries(row).filter(([k])=>k!=='data')),...row.data}) as Entity;
        } else if(change.entity_type==='project'||change.entity_type==='experiment') {
          after=await this.save(c,change.entity_type,change.after,this.business(change.before,change.entity_type));
        } else { return fail('UNDO_UNAVAILABLE','Unsupported series restoration'); }
        await this.record(c,p,compensation,'batch_undo',change.entity_type,change.after,after);
      }
      await c.query('UPDATE graybox.batches SET undone_at=now(),revision=revision+1 WHERE id=$1',[batchId]);
      await c.query('UPDATE graybox.batches SET operation_count=$2,revision=revision+1 WHERE id=$1',[compensation,changes.length]);
      return {batch_id:batchId,compensation_batch_id:compensation,undone:true};
    }));
  }
}
