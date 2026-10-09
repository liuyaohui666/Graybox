import React, {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {DraftWriteAttempt,navigationBlocked} from './library-write-guard.ts';
import {writeSafety} from './write-safety.ts';
import {request} from './platform.ts';
import {ProjectAgreement} from './team-social.tsx';
import {ProjectRow} from './project-row.tsx';
import {ProjectBoard} from './project-board.tsx';
import {Attribution} from './avatars.tsx';
import type {Project,Experiment} from './model.ts';
import {addTag,filterProjects,lifecycleNames,lifecycleLabel,priorityNames,outcomeNames,outcomeLabel,reportSections,reportPayload,normalizeTag} from './project-library-model.ts';
interface Report {author_id?:string;id:string;project_id:string;title:string;outcome:string;author_name:string;created_at:string;custom_sections:{title:string;content:string}[];[key:string]:unknown}
interface Comment {author_id?:string;id:string;body:string;author_name:string;created_at:string;agent_id?:string|null}
interface Draft {name:string;description:string;lifecycle:string;priority:string;tags:string[];revision:number}
interface Props {profile:string;page:'home'|'projects';projects:Project[];experiments:Experiment[];createdId:string;busy:boolean;setBusy:(value:boolean)=>void;send:(type:string,payload:object,revision?:number)=>Promise<unknown>;refresh:()=>Promise<void>;openExperiment:(id:string)=>void;tagFilter?:string;openTag?:(tag:string)=>void;backLabel?:string;onBack?:()=>void}
export function ProjectLibrary({profile,page,projects,experiments,createdId,busy,setBusy,send,refresh,openExperiment,tagFilter='',openTag,backLabel,onBack}:Props) {
  const pendingWrite=useSyncExternalStore(writeSafety.subscribe,writeSafety.snapshot,()=>null);
  const [selected,setSelected]=useState(''), [project,setProject]=useState<Project|null>(null), [draft,setDraft]=useState<Draft|null>(null);
  const [reports,setReports]=useState<Report[]>([]),[comments,setComments]=useState<Comment[]>([]),[recent,setRecent]=useState<Report[]>([]);
  const [reviewedIds,setReviewedIds]=useState<Set<string>>(()=>new Set());
  const [catalog,setCatalog]=useState<{id:string;name:string;workspace_id:string}[]>([]),[search,setSearch]=useState(''),[tagQuery,setTagQuery]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[reportOpen,setReportOpen]=useState(false),[metadataOpen,setMetadataOpen]=useState(false),[custom,setCustom]=useState<{title:string;content:string}[]>([]);
  const generation=useRef(0), active=useRef({profile,id:''}), dirty=useRef(false), writing=useRef(false), reads=useRef(0);
  const attempt=useRef(new DraftWriteAttempt());
  const locked=busy||!!pendingWrite;
  const blocked=()=>navigationBlocked(busy,writing.current,writeSafety.snapshot());
  const stamp=(s:string)=>new Date(s).toLocaleString('zh-CN');
  async function load(id:string,replaceDraft=false) {
    const token=++reads.current, identity=profile;
    const [p,r,c]=await Promise.all([request<Project>(identity,`/v1/projects/${id}`),request<Report[]>(identity,`/v1/projects/${id}/retrospectives`),request<Comment[]>(identity,`/v1/projects/${id}/comments`)]);
    if(active.current.profile!==identity || active.current.id!==id || token!==reads.current) return;
    setProject(p); setReports(r); setComments(c);
    if(replaceDraft || !dirty.current) {setDraft({name:p.name,description:p.description,lifecycle:p.lifecycle,priority:p.priority,tags:p.tags,revision:p.revision});dirty.current=false;}
  }
  useEffect(()=>{generation.current++;active.current={profile,id:selected};setProject(null);setDraft(null);setReports([]);setComments([]);setError('');setNotice('');setReportOpen(false);setMetadataOpen(false);setCustom([]);setTagQuery('');dirty.current=false;
    if(!selected)return;
    setLoading(true); const g=generation.current;
    void load(selected,true).catch(e=>{if(g===generation.current)setError(e.message);}).finally(()=>{if(g===generation.current)setLoading(false);});
    const update=()=>{if(!writing.current)void load(selected).catch(e=>{if(g===generation.current)setError(e.message);});};const timer=setInterval(update,15000);window.addEventListener('focus',update);
    return()=>{generation.current++;clearInterval(timer);window.removeEventListener('focus',update);};
  },[selected,profile]);
  useEffect(()=>{setSelected('');setSearch('');setRecent([]);setReviewedIds(new Set());},[profile]);
  useEffect(()=>{if(createdId)setSelected(createdId);},[createdId]);
  useEffect(()=>{const identity=profile;let cancelled=false;
    const workspaces=[...new Set(projects.map(p=>p.workspace_id))];
    void Promise.all(workspaces.map(id=>request<{id:string;name:string;workspace_id:string}[]>(identity,`/v1/tags?workspace_id=${encodeURIComponent(id)}&q=${encodeURIComponent(tagQuery)}`))).then(v=>{if(!cancelled && active.current.profile===identity)setCatalog(v.flat());}).catch(e=>{if(!cancelled)setError(e.message);});
    return()=>{cancelled=true;};
  },[projects,profile,tagQuery,page]);
  useEffect(()=>{const identity=profile;let cancelled=false;
    if(page==='home') void Promise.all(projects.map(p=>request<Report[]>(identity,`/v1/projects/${p.id}/retrospectives`))).then(v=>{if(!cancelled && active.current.profile===identity){const all=v.flat();setReviewedIds(new Set(all.map(r=>r.project_id)));setRecent(all.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,6));}}).catch(e=>{if(!cancelled && active.current.profile===identity)setError(e.message);});
    return()=>{cancelled=true;};
  },[projects,profile,page]);
  function change(values:Partial<Draft>) {dirty.current=true;setDraft(d=>d?{...d,...values}:d);}
  async function write(type:string,payload:object,revision:number,onSuccess?:()=>void) {
    if(writing.current)return false;
    const saved=attempt.current.prepare(type,payload,revision,!!writeSafety.snapshot());
    writing.current=true;setBusy(true);setError('');setNotice(''); const identity=profile,id=selected;
    try { await send(saved.type,saved.payload,saved.revision);
      if(active.current.profile!==identity || active.current.id!==id)return true;
      onSuccess?.();setNotice('记录已保存。');
      try {await load(id);await refresh();}catch {setError('记录已保存，但刷新失败。请重新读取，无需重复保存。');}
      return true;
    }catch(e){if(active.current.profile===identity && active.current.id===id)setError((e as Error).message);return false;}
    finally {attempt.current.finish(!!writeSafety.snapshot());writing.current=false;setBusy(false);}
  }
  const card=(p:Project)=><ProjectRow key={p.id} project={p} locked={locked} open={()=>{if(!blocked())setSelected(p.id);}}/>;
  return <div className="project-library">
    {error&&<div className="error" role="alert"><span>{error}</span><button disabled={busy} onClick={()=>{if(selected)void load(selected).catch(e=>setError(e.message));else void refresh().catch(e=>setError(e.message));}}>重新读取最新数据</button></div>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    {selected?<>
      <button className="secondary back-button" disabled={busy||!!pendingWrite} onClick={()=>{if(!blocked()){if(onBack)onBack();else setSelected('');}}}>← 返回{backLabel??(page==='home'?'首页':'项目库')}</button>
      {loading&&<p className="empty">正在读取项目…</p>}
      {project&&draft&&<>
        <div className="project-detail-heading"><h2>{project.name}</h2><span>owner <Attribution id={project.owner_id ?? project.creator_id} name={project.owner_name ?? project.creator_name} detail/></span></div>
        <ProjectAgreement profile={profile} projectId={project.id} busy={busy} setBusy={setBusy}/>
        <div className="project-overview"><div className="project-overview-meta"><span className={`project-state state-${project.lifecycle}`}>{lifecycleLabel(project.lifecycle)}</span><span>优先级 {priorityNames[project.priority]}</span>{project.can_edit&&<button className="secondary" disabled={locked} aria-expanded={metadataOpen} onClick={()=>setMetadataOpen(v=>!v)}>{metadataOpen?'收起编辑':'编辑项目'}</button>}</div><p className="prose">{project.description||'暂无说明'}</p><div className="library-tags">{project.tags.map(t=><button key={t} disabled={locked||!openTag} onClick={()=>{if(!blocked())openTag?.(t);}}>{t}</button>)}</div></div>
        {project.can_edit?<form className="library-form" hidden={!metadataOpen} onSubmit={e=>{e.preventDefault();void write('project_update',{id:project.id,name:draft.name.trim(),description:draft.description,lifecycle:draft.lifecycle,priority:draft.priority,tags:draft.tags},draft.revision,()=>{dirty.current=false;});}}>
          <fieldset disabled={locked} style={{display:"grid",gap:16,border:0,padding:0,margin:0,minWidth:0}}><label>项目名称<input required maxLength={120} value={draft.name} onChange={e=>change({name:e.target.value})}/></label>
          <label>项目说明<textarea rows={3} value={draft.description} onChange={e=>change({description:e.target.value})}/></label>
          <div className="form-row"><label>项目进度<select value={draft.lifecycle} onChange={e=>change({lifecycle:e.target.value})}>{Object.entries(lifecycleNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>优先级<select value={draft.priority} onChange={e=>change({priority:e.target.value})}>{Object.entries(priorityNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>
          <label>搜索或创建标签<input value={tagQuery} maxLength={80} onChange={e=>setTagQuery(e.target.value)} placeholder="搜索团队已有标签"/></label>
          <div className="library-tags">{catalog.filter(t=>t.workspace_id===project.workspace_id && normalizeTag(t.name).includes(normalizeTag(tagQuery))).map(t=><button type="button" key={t.id} disabled={draft.tags.some(v=>normalizeTag(v)===normalizeTag(t.name))} onClick={()=>change({tags:addTag(draft.tags,t.name,catalog)})}>＋ {t.name}</button>)}{tagQuery.trim()&&!catalog.some(t=>normalizeTag(t.name)===normalizeTag(tagQuery))&&<button type="button" onClick={()=>change({tags:addTag(draft.tags,tagQuery,catalog)})}>创建标签“{tagQuery.trim()}”</button>}</div>
          <div className="library-tags">{draft.tags.map(t=><button type="button" key={t} aria-label={`移除标签 ${t}`} onClick={()=>change({tags:draft.tags.filter(v=>v!==t)})}>{t} ×</button>)}</div>
          {draft.revision!==project.revision&&<p className="modal-error">项目已有新修订。草稿仍保留原修订，保存时服务器会检查冲突；请核对最新内容后重新编辑。</p>}
          </fieldset><div className="library-tags"><button className="primary" disabled={busy||(!!pendingWrite&&pendingWrite.operation!=='project_update')}>保存项目</button><button className="secondary" type="button" disabled={locked} onClick={()=>{if(!blocked())void load(project.id,true).catch(e=>setError(e.message));}}>放弃修改</button></div>
        </form>:null}
        <div className="section-heading spaced"><h2>经验报告</h2>{project.can_edit&&<button className="secondary" disabled={locked} onClick={()=>setReportOpen(v=>!v)}>{reportOpen?'收起草稿':'＋ 添加经验报告'}</button>}</div>
        {project.can_edit&&<form className="library-form" hidden={!reportOpen} onSubmit={e=>{e.preventDefault();const form=e.currentTarget;void write('retrospective_create',reportPayload(project.id,new FormData(form),custom),project.revision,()=>{form.reset();setCustom([]);setReportOpen(false);});}}>
          <fieldset disabled={locked} style={{display:"grid",gap:16,border:0,padding:0,margin:0,minWidth:0}}><label>报告标题<input name="title" required maxLength={200}/></label><label>报告结论<select name="outcome" defaultValue="inconclusive">{Object.entries(outcomeNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          {Object.entries(reportSections).map(([key,label])=><label key={key}>{label}<textarea name={key} rows={3} maxLength={12000}/></label>)}
          {custom.map((s,i)=><fieldset key={i}><label>自定义章节标题<input required maxLength={200} value={s.title} onChange={e=>setCustom(v=>v.map((s,j)=>j===i?{...s,title:e.target.value}:s))}/></label><label>章节内容<textarea maxLength={12000} value={s.content} onChange={e=>setCustom(v=>v.map((s,j)=>j===i?{...s,content:e.target.value}:s))}/></label><button type="button" onClick={()=>setCustom(v=>v.filter((_,j)=>i!==j))}>移除章节</button></fieldset>)}
          </fieldset><div className="library-tags"><button type="button" disabled={custom.length>=20||locked} onClick={()=>setCustom(v=>[...v,{title:'',content:''}])}>＋ 自定义章节</button><button className="primary" disabled={busy||(!!pendingWrite&&pendingWrite.operation!=='retrospective_create')}>保存经验报告</button></div>
        </form>}
        {reports.length===0&&<p className="empty compact">尚无经验报告。</p>}
        {reports.map(r=><article key={r.id} className="library-report"><h3>{r.title} <span className="status">{outcomeLabel(r.outcome)}</span></h3><small><Attribution id={r.author_id} name={r.author_name} agentId={r.agent_id as string|null}/> · {stamp(r.created_at)}</small>{Object.entries(reportSections).map(([key,label])=><section key={key}><h4>{label}</h4><p className="prose">{String(r[key]||'尚未填写')}</p></section>)}{r.custom_sections.map((s,i)=><section key={i}><h4>{s.title}</h4><p className="prose">{s.content}</p></section>)}</article>)}
        <details className="library-report"><summary>Codex 连接信息</summary><p>项目 ID：<code>{project.id}</code></p><p>空间 ID：<code>{project.workspace_id}</code></p></details>
        <h2 className="spaced">团队讨论</h2>{comments.map(c=><article key={c.id} className="library-comment"><small><Attribution id={c.author_id} name={c.author_name} agentId={c.agent_id}/> · {stamp(c.created_at)}</small><p className="prose">{c.body}</p></article>)}
        <form className="library-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;void write('comment_create',{project_id:project.id,body:String(new FormData(form).get('body')??'').trim()},project.revision,()=>form.reset());}}><fieldset disabled={locked} style={{display:"grid",gap:16,border:0,padding:0,margin:0,minWidth:0}}><label>添加评论<textarea name="body" required maxLength={12000} rows={3}/></label></fieldset><button className="primary" disabled={busy||(!!pendingWrite&&pendingWrite.operation!=='comment_create')}>发送评论</button></form>
        <details className="library-report"><summary>历史实验记录（{experiments.filter(e=>e.project_id===project.id).length}）</summary>{experiments.filter(e=>e.project_id===project.id).map(e=><button className="experiment-row" key={e.id} disabled={locked} onClick={()=>{if(!blocked())openExperiment(e.id);}}><span>{e.name} · v{e.version}</span><span>查看实验与证据 →</span></button>)}</details>
      </>}
    </>:page==='home'?<>
      <ProjectBoard projects={projects} reviewedIds={reviewedIds} locked={locked} open={id=>{if(!blocked())setSelected(id);}}/>
      <div className="section-heading spaced"><h2>最近经验</h2></div>{recent.map(r=><button className="experiment-row" key={r.id} disabled={locked} onClick={()=>{if(!blocked())setSelected(r.project_id);}}><span><strong>{r.title}</strong><small>{projects.find(p=>p.id===r.project_id)?.name} · <Attribution id={r.author_id} name={r.author_name} agentId={r.agent_id as string|null}/></small></span><span>{outcomeLabel(r.outcome)}</span><time>{stamp(r.created_at)}</time></button>)}{!recent.length&&<p className="empty compact">尚无项目经验报告。</p>}
    </>:<>
      <div className="filters project-search"><input aria-label="搜索项目库" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索名称、说明或标签…"/></div>
      <div className="library-tags"><button className={!tagFilter?'primary':'secondary'} onClick={()=>openTag?.('')}>所有标签</button>{[...new Set(projects.flatMap(p=>p.tags))].map(t=><button className={normalizeTag(t)===normalizeTag(tagFilter)?'primary':'secondary'} key={t} onClick={()=>openTag?.(t)}>{t}</button>)}</div>
      <div className="project-list">{filterProjects(projects,search,tagFilter).map(card)}</div>{!filterProjects(projects,search,tagFilter).length&&<p className="empty">没有符合条件的项目。</p>}
    </>}
  </div>;
}
