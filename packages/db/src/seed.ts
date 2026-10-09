import { Pool } from 'pg';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { Service } from '../../core/src/service.ts';
export async function seedDemonstration(pool:Pool,workspaceId:string,token:string) {
  const service=new Service(pool),principal=await service.authenticate(token),batch_id=randomUUID();
  const invoke=(type:string,payload:unknown,expected_revision?:number)=>service.command(principal,{type,payload,batch_id,idempotency_key:randomUUID(),...(expected_revision?{expected_revision}:{})});
  const project=await invoke('project_create',{workspace_id:workspaceId,name:'M1 local demonstration',description:'Demonstration placeholders only; no real user test results.'});
  let experiment=await invoke('experiment_create',{project_id:project.id,series_name:'Demonstration series',name:'Local workflow demonstration',goal:'Demonstrate the review and immutable evidence workflow.'});
  experiment=await invoke('evidence_append',{experiment_id:experiment.id,type:'test',source_kind:'agent_reported',result:'not_run',details:{command:'demonstration placeholder (not executed)',summary:'No actual test execution is asserted by this seeded example.'}},experiment.revision);
  await invoke('review_submit',{experiment_id:experiment.id},experiment.revision);
}
export async function seedDatabase(pool:Pool,includeRestricted=true) {
  const workspace_id=randomUUID(); const tokens:Record<string,string>={};
  const humans:Array<{id:string;name:string;role:string;token:string}>=[];
  const agents:Array<{id:string;human_id:string;name:string;token:string;project_ids:string[]|null}>=[];
  const c=await pool.connect();
  try {
    await c.query('BEGIN'); await c.query('INSERT INTO graybox.workspaces VALUES($1,$2)',[workspace_id,'Local demonstration workspace']);
    for(let i=0;i<3;i++) {
      const id=randomUUID(),name=['本地用户1','本地用户2','本地用户3'][i]!,role=i===0?'owner':'member';
      await c.query('INSERT INTO graybox.users VALUES($1,$2,$3)',[id,name,role]);
      const humanToken=randomBytes(32).toString('base64url'); humans.push({id,name,role,token:humanToken});
      await c.query('INSERT INTO graybox.credentials(id,human_id,kind,token_hash,label) VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,'human',createHash('sha256').update(humanToken).digest('hex'),`human_${i}`]);
      const agentId=randomUUID(),label=['owner_agent','member_agent','third_agent'][i]!,token=randomBytes(32).toString('base64url'); tokens[label]=token;
      agents.push({id:agentId,human_id:id,name:`${name} agent`,token,project_ids:null});
      await c.query('INSERT INTO graybox.agents VALUES($1,$2,$3)',[agentId,id,`${name} agent`]);
      await c.query('INSERT INTO graybox.credentials(id,human_id,agent_id,kind,token_hash,label) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,agentId,'agent',createHash('sha256').update(token).digest('hex'),label]);
      if(i===2 && includeRestricted) {
        const restricted=randomUUID(),secret=randomBytes(32).toString('base64url');tokens.restricted_agent=secret;
        await c.query('INSERT INTO graybox.agents VALUES($1,$2,$3)',[restricted,id,'Restricted test agent']);
        await c.query("INSERT INTO graybox.credentials(id,human_id,agent_id,kind,token_hash,label,project_ids) VALUES($1,$2,$3,'agent',$4,'restricted_agent','[]')",[randomUUID(),id,restricted,createHash('sha256').update(secret).digest('hex')]);
      }
    }
    await c.query('COMMIT'); return {workspace_id,tokens,humans,agents};
  } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  config({quiet:true}); if(process.env.GRAYBOX_MODE!=='local') throw new Error('Seed is local only');
  const pool=new Pool({connectionString:process.env.GRAYBOX_MIGRATION_DATABASE_URL});
  try {
    const existing=await pool.query('SELECT count(*)::int n FROM graybox.users');
    if(existing.rows[0].n) { await readFile('.local/credentials.json','utf8'); console.log('Local seed already initialized; preserving credentials'); }
    else {
      const seeded=await seedDatabase(pool,false); await mkdir('.local',{recursive:true});
      await writeFile('.local/credentials.json',JSON.stringify({mode:'local-demonstration-only',workspace_id:seeded.workspace_id,humans:seeded.humans,agents:seeded.agents},null,2),{mode:0o600});
      if(process.platform==='win32') {
        const who=execFileSync('whoami',[],{encoding:'utf8'}).trim();
        execFileSync('icacls',['.local/credentials.json','/inheritance:r','/grant:r',`${who}:(F)`],{stdio:'ignore'});
      }
      console.log('Local demonstration seed initialized; credentials stored privately in .local/credentials.json');
    }
    if(!(await pool.query('SELECT id FROM graybox.projects LIMIT 1')).rowCount) {
      if(!process.env.GRAYBOX_DATABASE_URL) throw new Error('Runtime URL required for domain demonstration seed');
      const saved=JSON.parse(await readFile('.local/credentials.json','utf8')) as {workspace_id:string;agents:Array<{token:string}>};
      const runtime=new Pool({connectionString:process.env.GRAYBOX_DATABASE_URL});
      try {await seedDemonstration(runtime,saved.workspace_id,saved.agents[0]!.token);} finally {await runtime.end();}
      console.log('Demonstration workflow seeded with not_run evidence');
    }
  } finally {await pool.end();}
}
