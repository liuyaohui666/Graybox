import { z } from 'zod';
const uuid=z.uuid();
const text=z.string().trim().min(1).max(4000);
const url=z.url().max(2000);
const projectFields={name:text,description:z.string().max(12000),status:z.enum(['active','paused','archived']),repo_url:url.nullable()};
const experimentFields={name:text,goal:text,summary:z.string().max(12000),change_summary:z.string().max(12000),status:z.literal('experimenting')};
const commit=z.strictObject({sha:z.string().regex(/^[a-fA-F0-9]{7,64}$/),message:z.string().max(4000).optional()});
const execution=z.strictObject({command:text,summary:text,exit_code:z.number().int().optional()});
export const evidenceDetails={git:z.strictObject({commits:z.array(commit).max(100),repo_url:url.optional()}),build:execution,test:execution,launch:execution,metric:z.strictObject({name:text,value:z.number().finite(),unit:z.string().max(100).optional()}),change:z.strictObject({summary:text,files:z.array(z.string().max(1000)).max(100).optional()})};
const envelope={idempotency_key:uuid,batch_id:uuid,session_id:uuid.optional()};
const update={...envelope,expected_revision:z.number().int().positive()};
export const commandSchema=z.discriminatedUnion('type',[
  z.strictObject({...envelope,type:z.literal('project_create'),payload:z.strictObject({workspace_id:uuid,name:projectFields.name,description:projectFields.description.optional(),status:projectFields.status.optional(),repo_url:projectFields.repo_url.optional()})}),
  z.strictObject({...update,type:z.literal('project_update'),payload:z.strictObject({id:uuid,...Object.fromEntries(Object.entries(projectFields).map(([k,v])=>[k,v.optional()]))})}),
  z.strictObject({...envelope,type:z.literal('experiment_create'),payload:z.strictObject({project_id:uuid,series_id:uuid.optional(),series_name:text.optional(),name:text,goal:text,based_on:uuid.optional()}).refine(x=>!!x.series_id!==!!x.series_name,'Exactly one series identifier/name required')}),
  z.strictObject({...update,type:z.literal('experiment_update'),payload:z.strictObject({id:uuid,name:experimentFields.name.optional(),goal:experimentFields.goal.optional(),summary:experimentFields.summary.optional(),change_summary:experimentFields.change_summary.optional(),status:experimentFields.status.optional()})}),
  z.strictObject({...update,type:z.literal('evidence_append'),payload:z.strictObject({experiment_id:uuid,type:z.enum(['git','build','test','launch','metric','change']),source_kind:z.enum(['agent_reported','local_collector','ci']),result:z.enum(['passed','failed','not_run','inconclusive']),details:z.unknown()}).superRefine((p,ctx)=> { const parsed=evidenceDetails[p.type].safeParse(p.details); if(!parsed.success) ctx.addIssue({code:'custom',message:'Invalid strict evidence details',path:['details']}); })}),
  z.strictObject({...update,type:z.literal('review_submit'),payload:z.strictObject({experiment_id:uuid,reviewers:z.array(uuid).max(3).optional()})})
]);
export const undoSchema=z.strictObject({expected_batch_revision:z.number().int().positive(),preview_token:z.string().min(1).max(16000),idempotency_key:uuid});
export type Principal={id:string;human_id:string;agent_id:string|null;kind:'human'|'agent';project_ids:string[]|null};
export type Entity={id:string;revision:number;project_id?:string;[key:string]:unknown};
