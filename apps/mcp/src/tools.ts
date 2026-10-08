import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { commandSchema,evidenceDetails,undoSchema } from '../../../packages/contracts/src/index.ts';
import { resolveContext,executeCommand,undoExecutionContext } from '../../../packages/local-context/src/binding.ts';
import { ClientError,safeError } from '../../../packages/client/src/client.ts';
const cwd=z.string().min(1).describe('Explicit absolute directory of the user project. Never inferred from MCP process cwd.');
const commands=commandSchema.options;
export const schemas={
  retrospective_create:commands.find(command=>command.shape.type.value==='retrospective_create')!.extend({cwd}),
  comment_create:commands.find(command=>command.shape.type.value==='comment_create')!.extend({cwd}),
  retrospective_list:z.strictObject({cwd}),
  comment_list:z.strictObject({cwd}),
  tag_list:z.strictObject({cwd,q:z.string().max(200).optional()}),
  context_resolve:z.strictObject({cwd,include_git:z.boolean().optional()}),
  entity_get:z.strictObject({cwd,entity_type:z.enum(['project','experiment']),id:z.uuid().optional()}),
  project_write:z.strictObject({cwd,type:z.enum(['project_create','project_update']),idempotency_key:z.uuid(),batch_id:z.uuid(),session_id:z.uuid().optional(),expected_revision:z.number().int().positive().optional(),payload:z.union([commands[0].shape.payload,commands[1].shape.payload])}),
  experiment_create:commands[2].extend({cwd}),
  experiment_update:commands[3].extend({cwd}),
  evidence_append:commands[4].extend({cwd,payload:commands[4].shape.payload.safeExtend({details:z.union([evidenceDetails.git,evidenceDetails.test,evidenceDetails.metric,evidenceDetails.change])})}),
  review_submit:commands[5].extend({cwd}),
  activity_list:z.strictObject({cwd,entity_id:z.uuid().optional(),batch_id:z.uuid().optional()}),
  batch_undo:z.strictObject({cwd,action:z.enum(['preview','execute']),batch_id:z.uuid(),expected_batch_revision:undoSchema.shape.expected_batch_revision.optional(),preview_token:undoSchema.shape.preview_token.optional(),idempotency_key:undoSchema.shape.idempotency_key.optional()})
};
export async function entityGet(cwd:string,entity_type:'project'|'experiment',id?:string){
  const ctx=await resolveContext({cwd});if(entity_type==='project'){if(id&&id!==ctx.project.id)throw new ClientError('PROJECT_MISMATCH','Requested project differs from the explicit project binding');return ctx.project;}
  const selected=id??ctx.active_experiment?.id;if(!selected)throw new ClientError('EXPERIMENT_REQUIRED','Explicit experiment UUID or active local experiment is required');
  const experiment=await ctx.api.experiment(selected);if(experiment.project_id!==ctx.project.id)throw new ClientError('EXPERIMENT_MISMATCH','Requested experiment belongs to another project');return experiment;
}
export async function projectChildren(cwd:string,kind:'retrospectives'|'comments'){const ctx=await resolveContext({cwd});return kind==='retrospectives'?ctx.api.retrospectives(ctx.project.id):ctx.api.comments(ctx.project.id);}
export async function tagList(cwd:string,q?:string){const ctx=await resolveContext({cwd});return ctx.api.tags(ctx.binding.workspace_id,q);}
export async function activityList(cwd:string,filters:{entity_id?:string;batch_id?:string}){const ctx=await resolveContext({cwd});return (await ctx.api.activity(filters)).filter(item=>item.project_id===ctx.project.id);}
export async function batchUndo(cwd:string,body:{action:'preview'|'execute';batch_id:string;expected_batch_revision?:number;preview_token?:string;idempotency_key?:string}){
  if(body.action==='execute'){
    const parsed=undoSchema.safeParse({expected_batch_revision:body.expected_batch_revision,preview_token:body.preview_token,idempotency_key:body.idempotency_key});if(!parsed.success)throw new ClientError('VALIDATION','Undo execution requires the preview token, matching revision and original stable UUID key');
    const ctx=await undoExecutionContext({cwd},body.batch_id);return ctx.api.undo(body.batch_id,parsed.data);
  }
  const ctx=await resolveContext({cwd}),activity=await ctx.api.activity({batch_id:body.batch_id});if(!activity.length)throw new ClientError('NOT_FOUND','Batch is missing or inaccessible',404);
  if(activity.some(item=>item.project_id!==ctx.project.id))throw new ClientError('PROJECT_MISMATCH','Batch contains changes outside the explicit project binding');
  if(body.action==='preview'){if(body.preview_token||body.expected_batch_revision||body.idempotency_key)throw new ClientError('VALIDATION','Preview accepts only action and batch UUID');return ctx.api.preview(body.batch_id);}
  throw new ClientError('VALIDATION','Unknown undo action');
}
const descriptions:Record<keyof typeof schemas,string>={
  retrospective_create:'Append a truthful structured report to the bound project. Requires current project expected_revision and stable UUID keys; immutable after creation.',
  comment_create:'Append a discussion or correction to the bound project with current project expected_revision and stable UUID keys.',
  retrospective_list:'Read reports for the explicit bound project.',
  comment_list:'Read discussion for the explicit bound project.',
  tag_list:'Read the shared workspace tag catalog visible to this agent, optionally search q.',
  context_resolve:'Resolve explicit cwd against the nearest unambiguous project binding, trusted personal environment and distinct agent identity; optionally report bounded read-only Git metadata.',
  entity_get:'Read a bound project or its experiment. An active local experiment may supply the experiment id.',
  project_write:'Create in the bound workspace or update the bound project using a caller supplied stable UUID idempotency_key and batch_id. Update requires expected_revision.',
  experiment_create:'Create an idea experiment in the bound project with exactly one series_id or series_name; caller must supply stable UUID keys.',
  experiment_update:'Update explicit experiment business fields; expected_revision and stable UUID keys required. Agent may only enter experimenting state.',
  evidence_append:'Append immutable, truthfully reported typed evidence. Explicit result/source_kind, expected_revision and stable keys are required; this tool does not execute commands.',
  review_submit:'Submit an immutable experiment snapshot for separate human review; expected_revision and stable keys required. Closes batch.',
  activity_list:'Read immutable activities for the explicit bound project, optionally filtering entity or batch UUID.',
  batch_undo:'Preview closes a batch and returns its signed five-minute token. Execute requires that token, matching batch revision and a stable UUID key. Only the selected agent’s own bound-project batches are eligible.'
};
export function registerTools(server:McpServer){
  for(const [name,inputSchema] of Object.entries(schemas))server.registerTool(name,{description:descriptions[name as keyof typeof schemas],inputSchema:inputSchema as z.ZodType<Record<string,unknown>>,annotations:{readOnlyHint:['context_resolve','entity_get','activity_list','retrospective_list','comment_list','tag_list'].includes(name),destructiveHint:name==='batch_undo',openWorldHint:false}},async(input:Record<string,unknown>)=>{
    try{
      const args=input as Record<string,unknown>,cwd=args.cwd as string;let data:unknown;
      if(name==='context_resolve')data=(await resolveContext({cwd,includeGit:args.include_git as boolean|undefined})).safe;
      else if(name==='entity_get')data=await entityGet(cwd,args.entity_type as 'project'|'experiment',args.id as string|undefined);
      else if(name==='retrospective_list'||name==='comment_list')data=await projectChildren(cwd,name==='retrospective_list'?'retrospectives':'comments');
      else if(name==='tag_list')data=await tagList(cwd,args.q as string|undefined);
      else if(name==='activity_list')data=await activityList(cwd,{entity_id:args.entity_id as string|undefined,batch_id:args.batch_id as string|undefined});
      else if(name==='batch_undo')data=await batchUndo(cwd,args as Parameters<typeof batchUndo>[1]);
      else{const {cwd:_cwd,...command}=args;data=await executeCommand({cwd},command);}
      return {content:[{type:'text',text:JSON.stringify({data})}]};
    }catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify(safeError(error))}]};}
  });
}
