import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Principal} from '../../contracts/src/index.ts';

// Called only within Service's authoritative, globally serialized transaction.
export async function notifyOwner(c:PoolClient,p:Principal,project:{id:string;creator_id?:unknown},kind:'agreement'|'comment',commentId?:string) {
 if(!project.creator_id || project.creator_id===p.human_id)return;
 await c.query(`INSERT INTO graybox.notifications(id,recipient_id,actor_id,agent_id,project_id,kind,comment_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[randomUUID(),project.creator_id,p.human_id,p.agent_id,project.id,kind,commentId??null]);
}
export async function agreementState(c:PoolClient,p:Principal,project:{id:string;creator_id?:unknown}) {
 const row=(await c.query('SELECT count(*) FILTER(WHERE active)::int AS count,coalesce(bool_or(active AND user_id=$2),false) AS agreed FROM graybox.project_agreements WHERE project_id=$1',[project.id,p.human_id])).rows[0];
 return {...row,can_agree:p.kind==='human'&&!!project.creator_id&&project.creator_id!==p.human_id};
}
export async function inboxPage(c:PoolClient,p:Principal,before?:string) {
 const scope='($2::uuid[] IS NULL OR n.project_id=ANY($2::uuid[]))';
 const params=[p.human_id,p.project_ids,before??null];
 const rows=(await c.query(`SELECT n.id,n.project_id,pr.data->>'name' AS project_name,pr.deleted_at IS NULL AS project_available,n.actor_id,u.name AS actor_name,n.agent_id,n.kind,left(cm.body,240) AS comment_preview,n.created_at,n.read_at FROM graybox.notifications n JOIN graybox.projects pr ON pr.id=n.project_id JOIN graybox.users u ON u.id=n.actor_id LEFT JOIN graybox.comments cm ON cm.id=n.comment_id WHERE n.recipient_id=$1 AND ${scope} AND ($3::uuid IS NULL OR (n.created_at,n.id)<(SELECT created_at,id FROM graybox.notifications WHERE id=$3 AND recipient_id=$1)) ORDER BY n.created_at DESC,n.id DESC LIMIT 101`,params)).rows;
 const unread=(await c.query(`SELECT count(*)::int AS count FROM graybox.notifications n WHERE n.recipient_id=$1 AND ${scope} AND read_at IS NULL`,params.slice(0,2))).rows[0].count;
 return {items:rows.slice(0,100),unread_count:unread,...(rows.length>100?{next_cursor:rows[99].id}:{})};
}
