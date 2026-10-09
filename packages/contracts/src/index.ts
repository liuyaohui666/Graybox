import { z } from 'zod';
const uuid=z.uuid();
const text=z.string().trim().min(1).max(4000);
const url=z.url().max(2000);
const lifecycle=z.enum(['todo','in_progress','completed','paused']);
const priority=z.enum(['high','medium','low']);
const tags=z.array(z.string().trim().min(1).max(100)).max(30);
const section=z.string().max(12000);
const projectFields={lifecycle,priority,tags,name:text,description:z.string().max(12000),status:z.enum(['active','paused','archived']),repo_url:url.nullable()};
const experimentFields={name:text,goal:text,summary:z.string().max(12000),change_summary:z.string().max(12000),status:z.literal('experimenting')};
const commit=z.strictObject({sha:z.string().regex(/^[a-fA-F0-9]{7,64}$/),message:z.string().max(4000).optional()});
const execution=z.strictObject({command:text,summary:text,exit_code:z.number().int().optional()});
export const evidenceDetails={git:z.strictObject({commits:z.array(commit).max(100),repo_url:url.optional()}),build:execution,test:execution,launch:execution,metric:z.strictObject({name:text,value:z.number().finite(),unit:z.string().max(100).optional()}),change:z.strictObject({summary:text,files:z.array(z.string().max(1000)).max(100).optional()})};
const envelope={idempotency_key:uuid,batch_id:uuid,session_id:uuid.optional()};
const update={...envelope,expected_revision:z.number().int().positive()};
export const legacyCommandSchema=z.discriminatedUnion('type',[
  z.strictObject({...envelope,type:z.literal('project_create'),payload:z.strictObject({workspace_id:uuid,name:projectFields.name,description:projectFields.description.optional(),status:projectFields.status.optional(),repo_url:projectFields.repo_url.optional(),lifecycle:lifecycle.optional(),priority:priority.optional(),tags:tags.optional()})}),
  z.strictObject({...update,type:z.literal('project_update'),payload:z.strictObject({id:uuid,...Object.fromEntries(Object.entries(projectFields).map(([k,v])=>[k,v.optional()]))})}),
  z.strictObject({...envelope,type:z.literal('experiment_create'),payload:z.strictObject({project_id:uuid,series_id:uuid.optional(),series_name:text.optional(),name:text,goal:text,based_on:uuid.optional(),source_idea_id:uuid.optional(),progress:lifecycle.optional(),priority:priority.optional(),outcome:z.enum(['inconclusive','success','partial','failure']).optional()}).refine(x=>!!x.series_id!==!!x.series_name,'Exactly one series identifier/name required').refine(x=>!(x.based_on&&x.source_idea_id),'Choose one source')}),
  z.strictObject({...update,type:z.literal('experiment_update'),payload:z.strictObject({id:uuid,name:experimentFields.name.optional(),goal:experimentFields.goal.optional(),summary:experimentFields.summary.optional(),change_summary:experimentFields.change_summary.optional(),status:experimentFields.status.optional(),progress:lifecycle.optional(),priority:priority.optional(),outcome:z.enum(['inconclusive','success','partial','failure']).optional()})}),
  z.strictObject({...update,type:z.literal('evidence_append'),payload:z.strictObject({experiment_id:uuid,type:z.enum(['git','build','test','launch','metric','change']),source_kind:z.enum(['agent_reported','local_collector','ci']),result:z.enum(['passed','failed','not_run','inconclusive']),details:z.unknown()}).superRefine((p,ctx)=> { const parsed=evidenceDetails[p.type].safeParse(p.details); if(!parsed.success) ctx.addIssue({code:'custom',message:'Invalid strict evidence details',path:['details']}); })}),
  z.strictObject({...update,type:z.literal('review_submit'),payload:z.strictObject({experiment_id:uuid,reviewers:z.array(uuid).max(3).optional()})}),
  z.strictObject({...update,type:z.literal('retrospective_create'),payload:z.strictObject({project_id:uuid,title:z.string().trim().min(1).max(200),goal:section,approach:section,result:section,verification:section,failures:section,reusable:section,lessons:section,next_steps:section,outcome:z.enum(['success','partial','failure','inconclusive']),custom_sections:z.array(z.strictObject({title:z.string().trim().min(1).max(200),content:section})).max(20)})}),
  z.strictObject({...update,type:z.literal('comment_create'),payload:z.strictObject({project_id:uuid,body:z.string().trim().min(1).max(12000)})})
]);
export const undoSchema=z.strictObject({expected_batch_revision:z.number().int().positive(),preview_token:z.string().min(1).max(16000),idempotency_key:uuid});
export type Principal={id:string;human_id:string;agent_id:string|null;kind:'human'|'agent';project_ids:string[]|null};
export type Entity={id:string;revision:number;project_id?:string;[key:string]:unknown};

const target={entity_type:z.enum(['idea','experiment']),entity_id:uuid};
export const collaborationCommandSchema=z.discriminatedUnion('type',[
 z.strictObject({...envelope,type:z.literal('idea_create'),payload:z.strictObject({workspace_id:uuid.optional(),name:text,body:section,priority:priority.optional(),project_id:uuid.nullable().optional()})}),
 z.strictObject({...update,type:z.literal('idea_update'),payload:z.strictObject({id:uuid,name:text.optional(),body:section.optional(),priority:priority.optional(),project_id:uuid.nullable().optional()})}),
 z.strictObject({...update,type:z.literal('entity_join'),payload:z.strictObject(target)}),
 z.strictObject({...update,type:z.literal('entity_branch'),payload:z.strictObject({...target,name:text.optional()})}),
 z.strictObject({...update,type:z.literal('entity_comment'),payload:z.strictObject({...target,body:text})}),
 z.strictObject({...update,type:z.literal('entity_agree'),payload:z.strictObject({...target,agreed:z.boolean()})}),
 z.strictObject({...update,type:z.literal('merge_submit'),payload:z.strictObject({...target,selected_fields:z.array(z.enum(['name','body','goal','summary','change_summary'])).min(1).max(5)})}),
 z.strictObject({...update,type:z.literal('merge_resolve'),payload:z.strictObject({id:uuid,decision:z.enum(['accept','reject','partial']),selected_fields:z.array(z.enum(['name','body','goal','summary','change_summary'])).optional(),expected_target_revision:z.number().int().positive()})})
]);
export const commandSchema=z.union([legacyCommandSchema,collaborationCommandSchema]);
export type CollaborationCommand=z.infer<typeof collaborationCommandSchema>;
