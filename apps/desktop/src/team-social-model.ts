import type {Project} from './model.ts';
export interface AgreementState {count:number;agreed:boolean;can_agree:boolean}
export interface NotificationItem {id:string;project_id:string;project_name:string;project_available:boolean;actor_id:string;actor_name:string;agent_id:string|null;kind:'agreement'|'comment';comment_preview:string|null;created_at:string;read_at:string|null}
export interface InboxPage {items:NotificationItem[];unread_count:number;next_cursor?:string}
export function memberWork(projects:Project[],id:string) {
 const own=projects.filter(p=>p.creator_id===id);
 return {ideas:own.filter(p=>p.lifecycle==='todo'),led:own.filter(p=>p.lifecycle!=='todo')};
}
export class AgreementAttempt {
 private target:{profile:string;projectId:string;session:number;agreed:boolean}|null=null;
 prepare(profile:string,projectId:string,session:number,current:boolean) {
  if(this.target&&(this.target.profile!==profile||this.target.projectId!==projectId||this.target.session!==session))throw new Error('赞同结果未确认，请回到原项目完成恢复。');
  return this.target??(this.target={profile,projectId,session,agreed:!current});
 }
 finish(success:boolean,ambiguous:boolean) {if(success||!ambiguous)this.target=null;}
 clear(){this.target=null;}
}
export class NotificationReadAttempt {
 private ids:string[]|null=null;
 private offset=0;
 prepare(ids:string[]) {if(!this.ids){this.ids=[...new Set(ids)];this.offset=0;}}
 chunk(){return this.ids?.slice(this.offset,this.offset+100)??[];}
 success(){this.offset+=100;}
 clear(){this.ids=null;this.offset=0;}
}
