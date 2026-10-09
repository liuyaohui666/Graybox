import React, { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Avatar, PeopleContext } from './avatars.tsx';
import { ApiError, request, sessionGeneration } from './platform.ts';
import { commandRetry } from './retry.ts';
import { writeSafety } from './write-safety.ts';
import { evidenceLabel, statusLabel } from './model.ts';
import './collaboration.css';
import {Attachments} from './attachments.tsx';

type Kind = 'project' | 'idea' | 'experiment';
type Page = 'projects' | 'ideas' | 'experiments' | 'messages' | 'member';
interface Source { entity_type: 'idea' | 'experiment'; entity_id: string; revision: number; author_id: string; snapshot: Record<string, unknown> }
export interface CollaborationRecord {
 id: string; name: string; revision: number; project_id?: string | null; workspace_id?: string;
 description?: string; body?: string; goal?: string; summary?: string; change_summary?: string;
 owner_id?: string | null; creator_id?: string | null; owner_name?: string | null; creator_name?: string | null;
 can_edit?: boolean; can_contribute?:boolean; progress?: string; lifecycle?: string; priority?: string; outcome?: string; status?: string;
 tags?: string[]; source?: Source | null; updated_at?: string;
 evidence?: { id: string; type: string; result: string; details: unknown }[];
 submissions?: {id:string;created_at:string;snapshot:unknown}[];
}
interface Comment { id: string; body: string; author_id?: string; author_name?: string; human_id?: string; created_at?: string }
interface Merge { id: string; revision: number; decision: 'accept'|'reject'|'partial'|null; can_resolve:boolean; selected_fields: string[]; entity_id:string; source_name?: string; target_id: string; target_revision: number; snapshot?: Record<string, unknown> }
interface Social { comments: Comment[]; agreements: { count: number; agreed: boolean }; participants: { author_id?: string; author_name?: string }[]; merge_requests: Merge[] }
interface Message { id:string;entity_type?:string;entity_id?:string;project_id?:string;project_name?:string;actor_id?:string;actor_name?:string;kind:string;comment_preview?:string;read_at?:string|null;created_at?:string }
interface Inbox {items:Message[];unread_count:number;next_cursor?:string}
interface Report {id:string;title:string;outcome?:string;[key:string]:unknown}
interface ChangeActivity {id:string;human_id:string;agent_id?:string|null;type:string;created_at:string}
interface ProjectAgreement {count:number;agreed:boolean;can_agree:boolean}
type Selection={kind:Kind;id:string};
type Editor={mode:'create'|'edit'|'branch'|'comment'|'merge';kind:Kind;record?:CollaborationRecord;sourceIdea?:CollaborationRecord;participant?:boolean};
const labels:Record<string,string>={todo:'待开始',in_progress:'进行中',completed:'已结束',paused:'暂停',active:'进行中',archived:'已归档',high:'高',medium:'中',low:'低',inconclusive:'暂无结论',success:'成功',partial:'部分成功',failure:'失败',pending:'待采纳',accepted:'已采纳',rejected:'未采纳',comment:'评论',agreement:'赞同',merge:'合并请求',merge_submitted:'提交合并',merge_resolved:'处理合并'};
const label=(value?:string)=>value?(labels[value]??statusLabel(value)):'待开始';
const owner=(r:CollaborationRecord)=>r.owner_id??r.creator_id;
const priorityRank:Record<string,number>={high:0,medium:1,low:2};
export function filterCollaborationRecords(items:CollaborationRecord[],query:string,priority:string,tag:string,projects:CollaborationRecord[]=[]) {
 const text=query.trim().toLocaleLowerCase();
 return items.filter(r=>(!priority||r.priority===priority)&&(!tag||r.tags?.includes(tag)||projects.find(p=>p.id===r.project_id)?.tags?.includes(tag))&&(!text||[r.name,r.body,r.description,r.goal,r.summary,projects.find(p=>p.id===r.project_id)?.name,...r.tags??[]].filter(Boolean).join(' ').toLocaleLowerCase().includes(text)))
 .sort((a,b)=>(priorityRank[a.priority??'medium']??1)-(priorityRank[b.priority??'medium']??1)||(b.updated_at??'').localeCompare(a.updated_at??''));
}
const emptySocial:Social={comments:[],agreements:{count:0,agreed:false},participants:[],merge_requests:[]};
export function relatedCollaborationRoutes(kind:'idea'|'experiment',record:CollaborationRecord,ideas:CollaborationRecord[],experiments:CollaborationRecord[]) {
 const all=[...ideas.map(record=>({kind:'idea' as const,record})),...experiments.map(record=>({kind:'experiment' as const,record}))];
 const key=(k:string,id:string)=>`${k}:${id}`,connected=new Set([key(kind,record.id)]);
 let changed=true;
 while(changed){changed=false;for(const item of all){const source=item.record.source;if(!source)continue;const own=key(item.kind,item.record.id),parent=key(source.entity_type,source.entity_id);if(connected.has(own)||connected.has(parent)){if(!connected.has(own)||!connected.has(parent))changed=true;connected.add(own);connected.add(parent);}}}
 return all.filter(item=>connected.has(key(item.kind,item.record.id)));
}
export function addCollaborationTag(tags:string[],value:string){const name=value.trim().replace(/\s+/g,' ');return !name||name.length>100||tags.length>=30||tags.some(t=>t.toLocaleLowerCase()===name.toLocaleLowerCase())?tags:[...tags,name];}
export function collaborationActionLabel(action:string) {return ({project_create:'创建项目',project_update:'更新项目',experiment_create:'创建实验',experiment_update:'更新实验',evidence_append:'补充证据',review_submit:'提交验收',retrospective_create:'记录复盘',comment_create:'添加评论',collaboration_idea_create:'创建想法',collaboration_idea_update:'更新想法',collaboration_entity_join:'加入推进',collaboration_entity_branch:'创建分支',collaboration_entity_comment:'添加评论',collaboration_entity_agree:'更新赞同',collaboration_merge_submit:'提交合并',collaboration_merge_resolve:'处理合并'} as Record<string,string>)[action]??'修改记录';}

/** Render inside PeopleProvider so the account slot and member identities share one source. */
export function CollaborationWorkbench({profile,account}:{profile:string;account:React.ReactNode}) {
 const {people,mode,error:peopleError}=useContext(PeopleContext);
 const [page,setPage]=useState<Page>('projects'),[projectId,setProjectId]=useState(''),[memberId,setMemberId]=useState('');
 const [projects,setProjects]=useState<CollaborationRecord[]>([]),[ideas,setIdeas]=useState<CollaborationRecord[]>([]),[experiments,setExperiments]=useState<CollaborationRecord[]>([]),[workspaces,setWorkspaces]=useState<{id:string;name:string}[]>([]);
 const [query,setQuery]=useState(''),[priority,setPriority]=useState(''),[tag,setTag]=useState(''),[filter,setFilter]=useState('all');
 const [selection,setSelection]=useState<Selection|null>(null),[detail,setDetail]=useState<CollaborationRecord|null>(null),[social,setSocial]=useState<Social>(emptySocial),[reports,setReports]=useState<Report[]>([]),[projectComments,setProjectComments]=useState<Comment[]>([]);
 const [projectAgreement,setProjectAgreement]=useState<ProjectAgreement>({count:0,agreed:false,can_agree:false}),[activity,setActivity]=useState<ChangeActivity[]>([]);
 const [inbox,setInbox]=useState<Inbox>({items:[],unread_count:0}),[legacyInbox,setLegacyInbox]=useState<Inbox>({items:[],unread_count:0});
 const [loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false),[error,setError]=useState(''),[detailError,setDetailError]=useState(''),[notice,setNotice]=useState(''),[editor,setEditor]=useState<Editor|null>(null),[busy,setBusy]=useState(false);
 const [refreshVersion,setRefreshVersion]=useState(0),[recoveryVerified,setRecoveryVerified]=useState(false);
 const pending=useSyncExternalStore(writeSafety.subscribe,writeSafety.snapshot,writeSafety.snapshot);
 const reading=useRef(0),detailReading=useRef(0),active=useRef(profile),writing=useRef(false);active.current=profile;
 const operation=useRef<{type:string;payload:object;revision?:number}|null>(null);
 const messageOperation=useRef<{ids:string[];legacy:boolean}|null>(null);
 const agreementOperation=useRef<{id:string;agreed:boolean}|null>(null);
 const blocked=busy||!!pending;
 useEffect(()=>{if(pending?.ambiguous)setRecoveryVerified(false);},[pending?.signature,pending?.ambiguous]);
 const project=projects.find(p=>p.id===projectId);
 const chosenMember=people.find(p=>p.id===memberId);
 const personName=(id?:string|null,fallback?:string|null)=>people.find(p=>p.id===id)?.name??fallback??'历史记录未注明';
 function refresh(){setRefreshVersion(v=>v+1);}
 useEffect(()=>{setProjects([]);setIdeas([]);setExperiments([]);setSelection(null);setProjectId('');setEditor(null);setNotice('');operation.current=null;},[profile]);
 useEffect(()=>{
  let disposed=false;const token=++reading.current,s=sessionGeneration();setLoading(true);setError('');
  const current=()=>!disposed&&active.current===profile&&token===reading.current&&s===sessionGeneration();
  void Promise.all([
   request<CollaborationRecord[]>(profile,'/v1/projects'),request<CollaborationRecord[]>(profile,'/v1/ideas'),request<CollaborationRecord[]>(profile,'/v1/experiments'),request<{id:string;name:string}[]>(profile,'/v1/workspaces'),request<Inbox>(profile,'/v1/collaboration/notifications'),request<Inbox>(profile,'/v1/notifications')
  ]).then(([p,i,e,w,n,l])=>{if(current()){setProjects(p);setIdeas(i);setExperiments(e);setWorkspaces(w);setInbox(n);setLegacyInbox(l);setRecoveryVerified(true);setNotice(previous=>previous==='正在刷新…'?'列表已刷新。':previous);}}).catch(e=>{if(current()){setError((e as Error).message);setNotice(previous=>previous==='正在刷新…'?'刷新失败，请重试。':previous);}}).finally(()=>{if(current())setLoading(false);});
  return()=>{disposed=true;};
 },[profile,refreshVersion]);
 const selectionKey=selection?`${selection.kind}:${selection.id}`:'';
 useEffect(()=>{
  let disposed=false;const token=++detailReading.current,s=sessionGeneration();setDetail(null);setSocial(emptySocial);setReports([]);setProjectComments([]);setActivity([]);setProjectAgreement({count:0,agreed:false,can_agree:false});setDetailError('');
  if(!selection){setDetailLoading(false);return;}
  setDetailLoading(true);const current=()=>!disposed&&active.current===profile&&token===detailReading.current&&s===sessionGeneration();
  const path=selection.kind==='project'?`/v1/projects/${selection.id}`:`/v1/${selection.kind==='idea'?'ideas':'experiments'}/${selection.id}`;
  void (async()=>{
   const [item,changes]=await Promise.all([request<CollaborationRecord>(profile,path),request<ChangeActivity[]>(profile,`/v1/activity?entity_id=${encodeURIComponent(selection.id)}`)]);
   if(current())setActivity(changes.slice(-10).reverse());
   if(selection.kind==='project') {const [r,c,a]=await Promise.all([request<Report[]>(profile,`${path}/retrospectives`),request<Comment[]>(profile,`${path}/comments`),request<ProjectAgreement>(profile,`${path}/agreement`)]);if(current()){setDetail(item);setReports(r);setProjectComments(c);setProjectAgreement(a);}}
   else {const state=await request<Social>(profile,`/v1/collaboration?entity_type=${selection.kind}&entity_id=${selection.id}`);if(current()){setDetail(item);setSocial(state);}}
  })().catch(e=>{if(current())setDetailError((e as Error).message);}).finally(()=>{if(current())setDetailLoading(false);});
  return()=>{disposed=true;};
 },[profile,selectionKey,refreshVersion]);
 function navigate(next:Page){setPage(next);setProjectId('');setSelection(null);setQuery('');setTag('');setPriority('');setFilter('all');}
 function openProject(id:string){setPage('projects');setProjectId(id);setSelection(null);setFilter('all');setQuery('');}
 function openRecord(kind:Kind,id:string){setSelection({kind,id});}
 async function write(type:string,payload:object,revision?:number) {
  if(writing.current)return;writing.current=true;setBusy(true);setNotice('');setRecoveryVerified(false);const id=profile,s=sessionGeneration();
  operation.current={type,payload,revision};
  try {
   const body=commandRetry.prepare(id,type,payload,revision);
   const result=await request<CollaborationRecord>(id,'/v1/commands','POST',body);
   commandRetry.clear();operation.current=null;
   if(active.current!==id||s!==sessionGeneration())return;
   setNotice('已保存。');setEditor(null);refresh();
   if((type==='entity_branch'||type==='idea_create'||type==='experiment_create')&&result.id)openRecord(type==='idea_create'?'idea':type==='experiment_create'?'experiment':payload&&'entity_type' in payload?payload.entity_type as Kind:'experiment',result.id);
  }catch(e){
   if(e instanceof ApiError)commandRetry.rejected(e.code);
   if(active.current===id&&s===sessionGeneration()){
    setNotice(e instanceof ApiError&&e.code==='REVISION_CONFLICT'?'记录已被其他成员更新，正在重新读取。请核对后再次保存。':(e as Error).message);
    if(e instanceof ApiError&&e.code==='REVISION_CONFLICT'){operation.current=null;setEditor(null);refresh();}
   }
  }finally{writing.current=false;if(active.current===id)setBusy(false);}
 }
 async function readMessages(ids:string[],legacy:boolean,retry=false){
  if((blocked&&!retry)||writing.current)return;writing.current=true;setBusy(true);setRecoveryVerified(false);const id=profile,s=sessionGeneration();messageOperation.current={ids,legacy};operation.current=null;
  try {await request(id,legacy?'/v1/notifications/read':'/v1/collaboration/notifications/read','POST',{ids});messageOperation.current=null;if(active.current===id&&s===sessionGeneration())refresh();}catch(e){if(active.current===id)setNotice((e as Error).message);}finally{writing.current=false;if(active.current===id)setBusy(false);}
 }
 async function agreeProject(id:string,agreed:boolean,retry=false){
  if((blocked&&!retry)||writing.current)return;writing.current=true;setBusy(true);setRecoveryVerified(false);const identity=profile,session=sessionGeneration();agreementOperation.current={id,agreed};operation.current=null;messageOperation.current=null;
  try{await request(identity,`/v1/projects/${encodeURIComponent(id)}/agreement`,'POST',{agreed});agreementOperation.current=null;if(active.current===identity&&sessionGeneration()===session)refresh();}catch(e){if(active.current===identity&&sessionGeneration()===session)setNotice((e as Error).message);}finally{writing.current=false;if(active.current===identity)setBusy(false);}
 }
 const rows=useMemo(()=>{
  let all:{kind:Kind;record:CollaborationRecord}[]=[];
  if(page==='projects'&&!projectId)all=projects.map(record=>({kind:'project',record}));
  else if(page==='ideas')all=ideas.filter(r=>filter==='all'||(filter==='unlinked'?!r.project_id:!!r.project_id)).map(record=>({kind:'idea',record}));
  else if(page==='experiments')all=experiments.map(record=>({kind:'experiment',record}));
  else if(page==='member')all=[...projects.filter(r=>owner(r)===memberId).map(record=>({kind:'project' as Kind,record})),...ideas.filter(r=>owner(r)===memberId).map(record=>({kind:'idea' as Kind,record})),...experiments.filter(r=>owner(r)===memberId).map(record=>({kind:'experiment' as Kind,record}))].filter(r=>filter==='all'||r.kind===filter);
  else if(projectId)all=[...experiments.filter(r=>r.project_id===projectId).map(record=>({kind:'experiment' as Kind,record})),...ideas.filter(r=>r.project_id===projectId).map(record=>({kind:'idea' as Kind,record}))].filter(r=>filter==='all'||r.kind===filter);
  const visible=new Set(filterCollaborationRecords(all.map(r=>r.record),query,priority,tag,projects).map(r=>r.id));
  return all.filter(r=>visible.has(r.record.id)).sort((a,b)=>(priorityRank[a.record.priority??'medium']??1)-(priorityRank[b.record.priority??'medium']??1));
 },[page,projectId,memberId,projects,ideas,experiments,filter,query,priority,tag]);
 const tags=[...new Set([...projects,...ideas,...experiments].flatMap(r=>r.tags??[]))].sort();
 function Person({id,name}:{id?:string|null;name?:string|null}){const p=people.find(p=>p.id===id);return <button className="cw-person" onClick={()=>{navigate('member');setMemberId(id??'');}} disabled={!id}><Avatar person={p??(name?{id:id??name,name}:undefined)} mode={mode}/><span>{personName(id,name)}</span></button>;}
 const target=detail&&selection&&selection.kind!=='project'?{entity_type:selection.kind,entity_id:detail.id}:null;
 const kindName=(kind:Kind)=>({project:'项目',idea:'想法',experiment:'实验'}[kind]);
 return <div className="cw-app">
  <aside className="cw-sidebar"><div className="cw-brand">Graybox</div><nav aria-label="主导航">{(['projects','ideas','experiments','messages'] as Page[]).map((p,i)=><button key={p} aria-current={page===p?'page':undefined} onClick={()=>navigate(p)}><span aria-hidden="true">{['▱','◉','⚗','◇'][i]}</span>{['项目','想法','实验','消息'][i]}{p==='messages'&&(inbox.unread_count+legacyInbox.unread_count)>0&&<span className="cw-unread">{inbox.unread_count+legacyInbox.unread_count}</span>}</button>)}</nav>
   <section className="cw-members"><h2>成员</h2>{peopleError&&<p role="alert">{peopleError}</p>}{people.map(p=><button key={p.id} title={`${p.name}的主页`} aria-current={page==='member'&&memberId===p.id?'page':undefined} onClick={()=>{navigate('member');setMemberId(p.id);}}><Avatar person={p} mode={mode}/><span>{p.name}{p.id===profile?' · 我':''}</span></button>)}</section><div className="cw-account">{account}</div>
  </aside>
  <main className="cw-main">
   <header className="cw-header"><div>{projectId&&<button onClick={()=>navigate('projects')}>← 全部项目</button>}<h1>{projectId?project?.name??'项目':page==='member'?`${chosenMember?.name??'成员'}的主页`:({projects:'项目',ideas:'想法',experiments:'实验',messages:'消息'} as Record<string,string>)[page]}</h1>{projectId&&project&&<div className="cw-meta"><Person id={owner(project)} name={project.owner_name??project.creator_name}/><span>主导</span><span className="cw-badge">{label(project.lifecycle??project.status)}</span>{project.tags?.map(t=><span className="cw-tag" key={t}>{t}</span>)}</div>}</div>
    <div className="cw-actions"><button disabled={loading||detailLoading} aria-busy={loading||detailLoading} title="更新列表、当前详情和消息" onClick={()=>{setNotice('正在刷新…');refresh();}}>{loading||detailLoading?'刷新中…':'刷新'}</button>{page!=='messages'&&page!=='member'&&(projectId?<details className="cw-new"><summary>＋ 新建</summary><div><button disabled={blocked} onClick={()=>setEditor({mode:'create',kind:'idea'})}>新建想法</button><button disabled={blocked} onClick={()=>setEditor({mode:'create',kind:'experiment'})}>新建实验</button></div></details>:<button className="cw-primary" disabled={blocked} onClick={()=>setEditor({mode:'create',kind:page==='ideas'?'idea':page==='experiments'?'experiment':'project'})}>＋ 新建{page==='ideas'?'想法':page==='experiments'?'实验':'项目'}</button>)}</div></header>
   {projectId&&project&&<p className="cw-description">{project.description||'尚未填写项目说明'}</p>}
   {notice&&<div role="status" className="cw-notice">{notice}</div>}
   {pending?.ambiguous&&<div className="cw-notice" role="alert">上次写入结果尚未确认。<button disabled={busy||(!operation.current&&!messageOperation.current&&!agreementOperation.current)} onClick={()=>{const o=operation.current;if(o)void write(o.type,o.payload,o.revision);else {const m=messageOperation.current;if(m)void readMessages(m.ids,m.legacy,true);else {const a=agreementOperation.current;if(a)void agreeProject(a.id,a.agreed,true);}}}}>重试原操作</button><button disabled={loading||busy} onClick={()=>{refresh();setNotice('正在核对最新记录，请确认后解除标记。');}}>读取最新记录</button><button disabled={loading||detailLoading||busy||!recoveryVerified||!!error||!!detailError} onClick={()=>{writeSafety.acknowledge();commandRetry.clear();operation.current=null;messageOperation.current=null;agreementOperation.current=null;setNotice('已解除标记。请核对记录后再操作。');}}>已核对，解除标记</button></div>}
   {error&&<div className="cw-notice" role="alert">{error}<button onClick={refresh}>重试读取</button></div>}
   {loading&&<p role="status" className="cw-loading">正在读取…</p>}
   {page==='messages'?<section className="cw-messages">{[{data:inbox,legacy:false},{data:legacyInbox,legacy:true}].map(({data,legacy})=>data.items.map(n=><article key={n.id}><Person id={n.actor_id} name={n.actor_name}/><div><strong>{n.actor_name??'成员'}{label(n.kind)}了{n.project_name?`「${n.project_name}」`:'记录'}</strong><p>{n.comment_preview}</p><small>{n.created_at?new Date(n.created_at).toLocaleString('zh-CN'):''}{n.read_at?' · 已读':' · 未读'}</small></div><button onClick={()=>{if(n.entity_id&&(n.entity_type==='idea'||n.entity_type==='experiment')){navigate(n.entity_type==='idea'?'ideas':'experiments');openRecord(n.entity_type,n.entity_id);}else if(n.project_id)openProject(n.project_id);}}>查看</button>{!n.read_at&&<button disabled={blocked} onClick={()=>void readMessages([n.id],legacy)}>标为已读</button>}</article>))}{!loading&&!inbox.items.length&&!legacyInbox.items.length&&<p className="cw-empty">暂无消息</p>}</section>:<>
    <div className="cw-toolbar"><div className="cw-filters">{page==='ideas'?['all','unlinked','linked'].map((f,i)=><button key={f} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{['全部','新想法 · 未关联','已关联项目'][i]}</button>):projectId||page==='member'?['all','idea','experiment',...(page==='member'?['project']:[])].map(f=><button key={f} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f==='all'?'全部内容':kindName(f as Kind)}</button>):null}{projectId&&<button onClick={()=>openRecord('project',projectId)}>复盘与历史记录</button>}</div><input aria-label="搜索记录" placeholder="搜索名称、内容或项目" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="优先级筛选" value={priority} onChange={e=>setPriority(e.target.value)}><option value="">全部优先级</option>{['high','medium','low'].map(p=><option key={p} value={p}>{label(p)}优先级</option>)}</select><select aria-label="标签筛选" value={tag} onChange={e=>setTag(e.target.value)}><option value="">全部标签</option>{tags.map(t=><option key={t}>{t}</option>)}</select></div>
    <div className="cw-split"><section className="cw-list" aria-label="记录列表"><div className="cw-list-head">{rows.length} 条记录 · 优先级由高到低</div>{rows.map(({kind,record:r})=><button className="cw-record" key={`${kind}:${r.id}`} aria-pressed={selection?.id===r.id&&selection.kind===kind} onClick={()=>kind==='project'&&page==='projects'&&!projectId?openProject(r.id):openRecord(kind,r.id)}><span className="cw-row"><small>{kindName(kind)}</small><small className={r.priority==='high'?'cw-high':''}>{label(r.priority??'medium')}优先级</small></span><strong>{r.name}</strong><span className="cw-row"><span className="cw-badge">{label(r.progress??r.lifecycle??r.status)}</span><small>{personName(owner(r),r.owner_name??r.creator_name)}</small></span>{kind==='idea'&&<small className="cw-relation">{r.project_id?projects.find(p=>p.id===r.project_id)?.name??'关联项目':'独立想法 · 未关联项目'}</small>}{r.source&&<small className="cw-relation">分支 · 来源版本 {r.source.revision}</small>}</button>)}{!loading&&!rows.length&&<p className="cw-empty">没有符合条件的记录</p>}</section>
     <section className="cw-detail" aria-label="记录详情" aria-busy={detailLoading}>
      {detailLoading?<p role="status">正在读取详情…</p>:detailError?<div role="alert">{detailError}<button onClick={refresh}>重试读取</button></div>:!detail||!selection?<p className="cw-empty">选择左侧记录，查看详情与讨论</p>:<>
       <div className="cw-meta"><span className="cw-badge">{kindName(selection.kind)}</span><span>{label(detail.progress??detail.lifecycle??detail.status)}</span>{selection.kind==='experiment'&&<span>结果：{label(detail.outcome??'inconclusive')}</span>}</div><h2>{detail.name}</h2><Person id={owner(detail)} name={detail.owner_name??detail.creator_name}/><span className="cw-muted"> 主导 · 版本 {detail.revision}</span>
       {selection.kind!=='project'&&<div className="cw-associated">{detail.project_id?<><span>关联项目</span><button onClick={()=>openProject(detail.project_id!)}>{projects.find(p=>p.id===detail.project_id)?.name??'打开项目'} ↗</button></>:<span>独立想法 · 未关联项目</span>}</div>}
       <p className="cw-body">{detail.body??detail.description??detail.goal??'尚未填写说明'}</p>
       <Attachments key={`${profile}:${selection.kind}:${detail.id}`} profile={profile} target={{entity_type:selection.kind,entity_id:detail.id}} editable={!!detail.can_edit||!!detail.can_contribute} refreshVersion={refreshVersion}/>
       <div className="cw-actions cw-detail-actions">{(detail.can_edit||(selection.kind==='experiment'&&(detail.can_contribute||social.participants.some(p=>p.author_id===profile))))&&<button disabled={blocked} onClick={()=>setEditor({mode:'edit',kind:selection.kind,record:detail,participant:!detail.can_edit})}>编辑{kindName(selection.kind)}</button>}{selection.kind==='project'?<><button onClick={()=>openProject(detail.id)}>打开项目内容</button><button disabled={blocked||!projectAgreement.can_agree} onClick={()=>void agreeProject(detail.id,!projectAgreement.agreed)}>{projectAgreement.agreed?'取消赞同':'赞同'} · {projectAgreement.count}</button><button disabled={blocked} onClick={()=>setEditor({mode:'comment',kind:'project',record:detail})}>留言评论</button></>:<><button disabled={blocked} onClick={()=>void write('entity_join',target!,detail.revision)}>共同推进</button><button disabled={blocked} onClick={()=>setEditor({mode:'branch',kind:selection.kind,record:detail})}>另开分支</button>{selection.kind==='idea'&&<button disabled={blocked} onClick={()=>setEditor({mode:'create',kind:'experiment',sourceIdea:detail})}>开始实验</button>}{detail.source?.entity_type===selection.kind&&<button disabled={blocked||!detail.can_edit} onClick={()=>setEditor({mode:'merge',kind:selection.kind,record:detail})}>提交合并</button>}<button disabled={blocked||owner(detail)===profile} onClick={()=>void write('entity_agree',{...target,agreed:!social.agreements.agreed},detail.revision)}>{social.agreements.agreed?'取消赞同':'赞同'} · {social.agreements.count}</button></>}</div>
       {detail.source&&<section className="cw-section"><h3>分支来源</h3><p>基于 {personName(detail.source.author_id)} 的记录，版本 {detail.source.revision}。</p><button onClick={()=>openRecord(detail.source!.entity_type,detail.source!.entity_id)}>查看原路线</button><details><summary>来源内容快照</summary><pre>{JSON.stringify(detail.source.snapshot,null,2)}</pre></details></section>}
       {selection.kind!=='project'&&<section className="cw-section"><h3>实验路线与分支</h3><div className="cw-routes">{relatedCollaborationRoutes(selection.kind,detail,ideas,experiments).map(({kind,record:r})=><article key={`${kind}:${r.id}`} aria-current={selection.id===r.id?'true':undefined}><div className="cw-row"><button onClick={()=>openRecord(kind,r.id)}>{r.name}</button><span className="cw-badge">{r.source?'分支':'原始路线'}</span></div><div className="cw-meta"><Person id={owner(r)} name={r.owner_name??r.creator_name}/><span>{label(r.progress??r.status??'todo')}</span><span>{label(r.priority??'medium')}优先级</span></div>{r.source&&<small>来源版本 {r.source.revision} · {ideas.concat(experiments).find(x=>x.id===r.source?.entity_id)?.name??'历史来源'}</small>}</article>)}</div></section>}
       {selection.kind==='experiment'&&<><section className="cw-section"><h3>本次进展</h3><p className="cw-body">{detail.summary||'尚未填写进展'}</p><h3>变更说明</h3><p className="cw-body">{detail.change_summary||'尚未填写变更说明'}</p></section><section className="cw-section"><h3>证据与历史验收</h3>{detail.evidence?.map(e=><details key={e.id}><summary>{({git:'提交记录',build:'构建',test:'测试',launch:'运行',metric:'指标',change:'变更'} as Record<string,string>)[e.type]??e.type} · {evidenceLabel(e.result)}</summary><pre>{JSON.stringify(e.details,null,2)}</pre></details>)}{detail.submissions?.map(s=><details key={s.id}><summary>验收快照 · {new Date(s.created_at).toLocaleString('zh-CN')}</summary><pre>{JSON.stringify(s.snapshot,null,2)}</pre></details>)}{!detail.evidence?.length&&!detail.submissions?.length&&<p>暂无证据或验收快照</p>}</section></>}
       {selection.kind==='project'?<><section className="cw-section"><h3>复盘</h3>{reports.map(r=><details key={r.id}><summary>{r.title} · {label(r.outcome)}</summary>{(['goal','approach','result','verification','failures','reusable','lessons','next_steps'] as const).map((f,i)=><section key={f}><h4>{['目标','做法','结果','验证','失败与问题','可复用内容','经验','下一步'][i]}</h4><p className="cw-body">{String(r[f]??'未填写')}</p></section>)}</details>)}{!reports.length&&<p>暂无复盘</p>}</section><section className="cw-section"><h3>项目讨论</h3>{projectComments.map(c=><article key={c.id}><Person id={c.author_id??c.human_id} name={c.author_name}/><p className="cw-body">{c.body}</p></article>)}{!projectComments.length&&<p>暂无评论</p>}<button disabled={blocked} onClick={()=>setEditor({mode:'comment',kind:'project',record:detail})}>留言评论</button></section></>:<>
        <section className="cw-section"><h3>参与成员</h3><div className="cw-meta">{social.participants.map((p,i)=><Person key={p.author_id??i} id={p.author_id} name={p.author_name}/>)}{!social.participants.length&&<p>暂无共同参与记录</p>}</div></section>
        <section className="cw-section"><h3>合并请求</h3>{social.merge_requests.map(m=><article key={m.id} className="cw-merge"><strong>{m.source_name??'分支成果'} · {label(m.decision==='accept'?'accepted':m.decision==='reject'?'rejected':m.decision==='partial'?'partial':'pending')}</strong><p>提交内容：{m.selected_fields.map(f=>({name:'名称',body:'内容',goal:'目标',summary:'进展',change_summary:'变更说明'} as Record<string,string>)[f]??f).join('、')}</p>{m.snapshot&&<details><summary>提交内容</summary><pre>{JSON.stringify(m.snapshot,null,2)}</pre></details>}{!m.decision&&m.can_resolve&&<MergeDecision merge={m} blocked={blocked} save={write}/>}</article>)}{!social.merge_requests.length&&<p>暂无合并请求</p>}</section>
        <section className="cw-section"><h3>讨论 · {social.comments.length}</h3>{social.comments.map(c=><article className="cw-comment" key={c.id}><Person id={c.author_id??c.human_id} name={c.author_name}/><p className="cw-body">{c.body}</p><small>{c.created_at?new Date(c.created_at).toLocaleString('zh-CN'):''}</small></article>)}{!social.comments.length&&<p>暂无评论</p>}<button disabled={blocked} onClick={()=>setEditor({mode:'comment',kind:selection.kind,record:detail})}>留言评论</button></section>
       </>}
       <section className="cw-section"><h3>近期修改记录</h3>{activity.map(a=><article className="cw-activity" key={a.id}><Person id={a.human_id}/><div><strong>{collaborationActionLabel(a.type)}</strong>{a.agent_id&&<small> · 助手代记</small>}<time dateTime={a.created_at}>{new Date(a.created_at).toLocaleString('zh-CN')}</time></div></article>)}{!activity.length&&<p>暂无修改记录</p>}</section>
      </>}
     </section></div>
   </>}
  </main>
  {editor&&<RecordEditor key={`${editor.mode}:${editor.record?.id??editor.kind}`} profile={profile} editor={editor} projectId={editor.sourceIdea?.project_id??projectId} projects={projects} workspaces={workspaces} busy={busy} blocked={!!pending} close={()=>setEditor(null)} save={write}/>} 
 </div>;
}

function CollaborationTagPicker({profile,workspace,tags,disabled,onChange}:{profile:string;workspace:string;tags:string[];disabled:boolean;onChange:(tags:string[])=>void}) {
 const [query,setQuery]=useState(''),[catalog,setCatalog]=useState<{id:string;name:string}[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const generation=useRef(0),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{
  let disposed=false;const token=++generation.current,session=sessionGeneration();setCatalog([]);setError('');setLoading(!!workspace);
  if(!workspace)return;
  const timer=setTimeout(()=>{void request<{id:string;name:string}[]>(profile,`/v1/tags?workspace_id=${encodeURIComponent(workspace)}&q=${encodeURIComponent(query.trim())}`).then(rows=>{if(!disposed&&token===generation.current&&session===sessionGeneration())setCatalog(rows.slice(0,50));}).catch(e=>{if(!disposed&&token===generation.current)setError((e as Error).message);}).finally(()=>{if(!disposed&&token===generation.current)setLoading(false);});},200);
  return()=>{disposed=true;clearTimeout(timer);};
 },[profile,workspace,query,retry]);
 const normalized=query.trim().replace(/\s+/g,' '),selected=(name:string)=>tags.some(t=>t.toLocaleLowerCase()===name.toLocaleLowerCase());
 function add(name:string){onChange(addCollaborationTag(tags,name));setQuery('');input.current?.focus();}
 const exact=catalog.find(t=>t.name.toLocaleLowerCase()===normalized.toLocaleLowerCase());
 return <fieldset className="cw-tag-picker" disabled={disabled}><legend>标签</legend><div className="cw-tag-chips">{tags.map(t=><span className="cw-tag" key={t}>{t}<button type="button" aria-label={`移除标签${t}`} onClick={()=>onChange(tags.filter(tag=>tag!==t))}>×</button></span>)}</div><label htmlFor="cw-tag-query">输入标签或搜索已有标签</label><div className="cw-tag-entry"><input ref={input} id="cw-tag-query" value={query} maxLength={100} placeholder="例如：联机、像素" onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(normalized&&!selected(normalized)&&tags.length<30)add(exact?.name??normalized);}}}/><button type="button" disabled={!normalized||selected(normalized)||tags.length>=30||loading} onClick={()=>add(exact?.name??normalized)}>{exact?'选择标签':'添加新标签'}</button></div>{loading&&<p role="status">正在搜索标签…</p>}{error&&<p role="alert">{error}<button type="button" onClick={()=>setRetry(v=>v+1)}>重试搜索</button></p>}<div className="cw-tag-options" aria-label="已有标签">{catalog.filter(t=>!selected(t.name)).map(t=><button key={t.id} type="button" disabled={tags.length>=30} onClick={()=>add(t.name)}>{t.name}</button>)}</div>{!loading&&!error&&!catalog.length&&<p>暂无匹配标签，可输入后添加。</p>}<small>最多 30 个标签；新标签随项目保存。</small></fieldset>;
}

function MergeDecision({merge,blocked,save}:{merge:Merge;blocked:boolean;save:(type:string,payload:object,revision?:number)=>Promise<void>}) {
 const [fields,setFields]=useState(merge.selected_fields);
 const resolve=(decision:string)=>void save('merge_resolve',{id:merge.id,decision,expected_target_revision:merge.target_revision,...(decision==='partial'?{selected_fields:fields}:{})},merge.revision);
 return <><div className="cw-merge-fields">{merge.selected_fields.map(f=><label key={f}><input type="checkbox" checked={fields.includes(f)} disabled={blocked} onChange={e=>setFields(v=>e.target.checked?[...v,f]:v.filter(k=>k!==f))}/>{({name:'名称',body:'内容',goal:'目标',summary:'进展',change_summary:'变更说明'} as Record<string,string>)[f]}</label>)}</div><div className="cw-actions"><button disabled={blocked} onClick={()=>resolve('accept')}>采纳全部成果</button><button disabled={blocked||!fields.length} onClick={()=>resolve('partial')}>采纳选中内容</button><button disabled={blocked} onClick={()=>resolve('reject')}>不采纳</button></div></>;
}

function RecordEditor({profile,editor,projectId,projects,workspaces,busy,blocked,close,save}:{profile:string;editor:Editor;projectId:string;projects:CollaborationRecord[];workspaces:{id:string;name:string}[];busy:boolean;blocked:boolean;close:()=>void;save:(type:string,payload:object,revision?:number)=>Promise<void>}) {
 const r=editor.record,dialog=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 const [name,setName]=useState(editor.mode==='branch'?`${r?.name??''} · 新分支`:r?.name??''),[body,setBody]=useState(editor.mode==='comment'?'':r?.body??r?.description??r?.goal??''),[project,setProject]=useState(r?.project_id??projectId),[workspace,setWorkspace]=useState(r?.workspace_id??workspaces[0]?.id??''),[progress,setProgress]=useState(r?.progress??r?.lifecycle??'todo'),[priority,setPriority]=useState(r?.priority??'medium'),[outcome,setOutcome]=useState(r?.outcome??'inconclusive'),[summary,setSummary]=useState(r?.summary??''),[change,setChange]=useState(r?.change_summary??''),[tags,setTags]=useState<string[]>(r?.tags??[]);
 const fields=editor.kind==='idea'?['name','body']:['name','goal','summary','change_summary'];
 const [selectedFields,setSelectedFields]=useState<string[]>(editor.kind==='idea'?['body']:['summary','change_summary']);
 useEffect(()=>{returnFocus.current=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>{returnFocus.current?.focus();};},[]);
 const title=editor.mode==='create'?`新建${{project:'项目',idea:'想法',experiment:'实验'}[editor.kind]}`:editor.mode==='edit'?'编辑记录':editor.mode==='branch'?'基于此另开分支':editor.mode==='merge'?'提交合并':'留言评论';
 async function submit(e:React.FormEvent){e.preventDefault();if(busy||blocked)return;
  if(editor.mode==='comment'&&editor.kind==='project'){if(r)await save('comment_create',{project_id:r.id,body},r.revision);return;}
  if(editor.mode==='branch'||editor.mode==='comment'||editor.mode==='merge') {if(!r)return;await save(editor.mode==='branch'?'entity_branch':editor.mode==='comment'?'entity_comment':'merge_submit',{entity_type:editor.kind,entity_id:r.id,...(editor.mode==='branch'?{name}:editor.mode==='comment'?{body}:{selected_fields:selectedFields})},r.revision);return;}
  let payload:Record<string,unknown>;
  if(editor.kind==='idea')payload={name,body,project_id:project||null,priority,...(editor.mode==='create'&&!project?{workspace_id:workspace}:{})};
  else if(editor.kind==='experiment')payload=editor.participant?{progress,summary,change_summary:change}:{name,goal:body,progress,priority,outcome,...(editor.mode==='create'?{project_id:project,series_name:name,...(editor.sourceIdea?{source_idea_id:editor.sourceIdea.id}:{})}:{summary,change_summary:change})};
  else payload={name,description:body,lifecycle:progress,priority,tags,...(editor.mode==='create'?{workspace_id:workspace}:{})};
  if(editor.mode==='edit'&&r)payload.id=r.id;
  await save(`${editor.kind}_${editor.mode==='edit'?'update':'create'}`,payload,r?.revision);
 }
 return <dialog ref={dialog} className="cw-dialog" onCancel={e=>{if(busy)e.preventDefault();else close();}}><header><h2>{title}</h2><button type="button" disabled={busy} onClick={close} aria-label="关闭编辑">×</button></header><form onSubmit={e=>void submit(e)}>
  {(editor.mode==='branch'||editor.mode==='merge')&&<p>来源：{r?.name} · 版本 {r?.revision}。保留原作者与原记录。</p>}
  {editor.mode==='merge'?<><p>选择提交给原记录主导者的成果：</p>{fields.map(f=><label className="cw-check" key={f}><input disabled={busy||blocked} type="checkbox" checked={selectedFields.includes(f)} onChange={e=>setSelectedFields(v=>e.target.checked?[...v,f]:v.filter(k=>k!==f))}/>{({name:'名称',body:'内容',goal:'目标',summary:'进展',change_summary:'变更说明'} as Record<string,string>)[f]}<span>{String((r as unknown as Record<string,unknown>)?.[f]??'尚未填写')}</span></label>)}</>:<>
   {editor.mode!=='comment'&&!editor.participant&&<label>名称<input autoFocus required maxLength={4000} disabled={busy||blocked} value={name} onChange={e=>setName(e.target.value)}/></label>}
   {editor.mode!=='branch'&&!editor.participant&&<label>{editor.mode==='comment'?'评论内容':editor.kind==='experiment'?'验证目标':'内容说明'}<textarea autoFocus={editor.mode==='comment'} required={editor.mode==='comment'||editor.kind==='experiment'} rows={5} maxLength={editor.mode==='comment'?4000:12000} disabled={busy||blocked} value={body} onChange={e=>setBody(e.target.value)}/></label>}
   {(editor.mode==='create'||editor.mode==='edit')&&<>
    {editor.kind==='project'?editor.mode==='create'&&<label>工作区<select required value={workspace} onChange={e=>setWorkspace(e.target.value)}>{!workspaces.length&&<option value="">没有可用工作区</option>}{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>:<label>关联项目<select required={editor.kind==='experiment'} disabled={busy||blocked||editor.kind==='experiment'&&editor.mode==='edit'} value={project} onChange={e=>setProject(e.target.value)}><option value="">{editor.kind==='idea'?'不关联 · 独立想法':'请选择项目'}</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    {editor.kind==='idea'&&editor.mode==='create'&&!project&&<label>工作区<select required disabled={busy||blocked} value={workspace} onChange={e=>setWorkspace(e.target.value)}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}{editor.kind==='idea'&&<label>优先级<select disabled={busy||blocked} value={priority} onChange={e=>setPriority(e.target.value)}>{['high','medium','low'].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>}{editor.kind!=='idea'&&<><div className="cw-form-row"><label>进度<select disabled={busy||blocked} value={progress} onChange={e=>setProgress(e.target.value)}>{['todo','in_progress','paused','completed'].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label><label>优先级<select disabled={busy||blocked||editor.participant} value={priority} onChange={e=>setPriority(e.target.value)}>{['high','medium','low'].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label></div>{editor.kind==='project'?<CollaborationTagPicker profile={profile} workspace={workspace} tags={tags} disabled={busy||blocked} onChange={setTags}/>:<><label>结果<select disabled={busy||blocked||editor.participant} value={outcome} onChange={e=>setOutcome(e.target.value)}>{['inconclusive','success','partial','failure'].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>{editor.mode==='edit'&&<><label>本次进展<textarea rows={4} maxLength={12000} disabled={busy||blocked} value={summary} onChange={e=>setSummary(e.target.value)}/></label><label>变更说明<textarea rows={3} maxLength={12000} disabled={busy||blocked} value={change} onChange={e=>setChange(e.target.value)}/></label></>}</>}</>}
   </>}
  </>}
  {blocked&&<p role="alert">写入结果尚未确认，请在工作台重试原操作或核对记录。</p>}<footer><button type="button" disabled={busy} onClick={close}>取消</button><button className="cw-primary" disabled={busy||blocked||editor.mode==='merge'&&!selectedFields.length} type="submit">{busy?'正在保存…':editor.mode==='merge'?'提交给主导者':editor.mode==='comment'?'发送评论':'保存'}</button></footer>
 </form></dialog>;
}


