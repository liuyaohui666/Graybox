import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {Principal,Entity,CollaborationCommand} from '../../contracts/src/index.ts';
type DB=Pool|PoolClient;
export async function experimentOwner(c:DB,id:string) {
 const meta=(await c.query('SELECT * FROM graybox.experiment_collaboration WHERE experiment_id=$1',[id])).rows[0];
 const owner=meta?.owner_id??(await c.query("SELECT human_id FROM graybox.activities WHERE entity_type='experiment' AND entity_id=$1 AND type='experiment_create' AND before IS NULL ORDER BY created_at,id LIMIT 1",[id])).rows[0]?.human_id??null;
 return {owner_id:owner,source:meta?.source??null};
}
export async function presentExperiment(c:DB,p:Principal,e:Entity):Promise<Entity> {
 const owner=await experimentOwner(c,e.id),user=owner.owner_id?(await c.query('SELECT name FROM graybox.users WHERE id=$1',[owner.owner_id])).rows[0]:null;
 const participant=(await c.query("SELECT id FROM graybox.collaboration_events WHERE entity_type='experiment' AND entity_id=$1 AND author_id=$2 AND kind='join' LIMIT 1",[e.id,p.human_id])).rowCount;
 return {...e,...owner,can_contribute:owner.owner_id===p.human_id||!!participant,owner_name:user?.name??null,can_edit:owner.owner_id===p.human_id,progress:e.progress??(e.status==='experimenting'?'in_progress':'todo'),priority:e.priority??'medium',outcome:e.outcome??'inconclusive'};
}
export async function idea(c:DB,p:Principal,id:string,fail:(code:string,message:string,status?:number)=>never):Promise<Entity> {
 const row=(await c.query('SELECT i.*,u.name AS owner_name FROM graybox.ideas i JOIN graybox.users u ON u.id=i.owner_id WHERE i.id=$1',[id])).rows[0];
 if(!row || (p.project_ids!==null && (!row.project_id || !p.project_ids.includes(row.project_id))))return fail('NOT_FOUND','Idea not found',404);
 const {data,...base}=row;return {...base,...data,can_edit:row.owner_id===p.human_id};
}
