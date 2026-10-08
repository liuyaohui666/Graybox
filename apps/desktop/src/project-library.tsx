import React, {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {writeSafety} from './write-safety.ts';
import {request} from './platform.ts';
import type {Project,Experiment} from './model.ts';
import {addTag,filterProjects,prioritizedIdeas,lifecycleNames,lifecycleLabel,priorityNames,outcomeNames,outcomeLabel,reportSections,reportPayload,normalizeTag} from './project-library-model.ts';
interface Report {id:string;project_id:string;title:string;outcome:string;author_name:string;created_at:string;custom_sections:{title:string;content:string}[];[key:string]:unknown}
interface Comment {id:string;body:string;author_name:string;created_at:string;agent_id?:string|null}
interface Draft {name:string;description:string;lifecycle:string;priority:string;tags:string[];revision:number}
interface Props {profile:string;page:'home'|'projects';projects:Project[];experiments:Experiment[];createdId:string;busy:boolean;setBusy:(value:boolean)=>void;send:(type:string,payload:object,revision?:number)=>Promise<unknown>;refresh:()=>Promise<void>;openExperiment:(id:string)=>void}
export function ProjectLibrary({profile,page,projects,experiments,createdId,busy,setBusy,send,refresh,openExperiment}:Props) {
  const pendingWrite=useSyncExternalStore(writeSafety.subscribe,writeSafety.snapshot,()=>null);
  const [selected,setSelected]=useState(''), [project,setProject]=useState<Project|null>(null), [draft,setDraft]=useState<Draft|null>(null);
  const [reports,setReports]=useState<Report[]>([]),[comments,setComments]=useState<Comment[]>([]),[recent,setRecent]=useState<Report[]>([]);
  const [catalog,setCatalog]=useState<{id:string;name:string;workspace_id:string}[]>([]),[search,setSearch]=useState(''),[tagFilter,setTagFilter]=useState(''),[tagQuery,setTagQuery]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[reportOpen,setReportOpen]=useState(false),[custom,setCustom]=useState<{title:string;content:string}[]>([]);
  const generation=useRef(0), active=useRef({profile,id:''}), dirty=useRef(false), writing=useRef(false), reads=useRef(0);
  const stamp=(s:string)=>new Date(s).toLocaleString('zh-CN');
  async function load(id:string,replaceDraft=false) {
    const token=++reads.current, identity=profile;
    const [p,r,c]=await Promise.all([request<Project>(identity,`/v1/projects/${id}`),request<Report[]>(identity,`/v1/projects/${id}/retrospectives`),request<Comment[]>(identity,`/v1/projects/${id}/comments`)]);
    if(active.current.profile!==identity || active.current.id!==id || token!==reads.current) return;
    setProject(p); setReports(r); setComments(c);
    if(replaceDraft || !dirty.current) {setDraft({name:p.name,description:p.description,lifecycle:p.lifecycle,priority:p.priority,tags:p.tags,revision:p.revision});dirty.current=false;}
  }
  useEffect(()=>{generation.current++;active.current={profile,id:selected};setProject(null);setDraft(null);setReports([]);setComments([]);setError('');setNotice('');setReportOpen(false);setCustom([]);setTagQuery('');dirty.current=false;
    if(!selected)return;
    setLoading(true); const g=generation.current;
    void load(selected,true).catch(e=>{if(g===generation.current)setError(e.message);}).finally(()=>{if(g===generation.current)setLoading(false);});
    const timer=setInterval(()=>{if(!writing.current)void load(selected).catch(e=>{if(g===generation.current)setError(e.message);});},15000);
    return()=>{generation.current++;clearInterval(timer);};
  },[selected,profile]);
  useEffect(()=>{setSelected('');setSearch('');setTagFilter('');setRecent([]);},[profile]);
  useEffect(()=>{if(createdId)setSelected(createdId);},[createdId]);
  useEffect(()=>{const identity=profile,g=generation.current;let cancelled=false;
    const workspaces=[...new Set(projects.map(p=>p.workspace_id))];
    void Promise.all(workspaces.map(id=>request<{id:string;name:string;workspace_id:string}[]>(identity,`/v1/tags?workspace_id=${encodeURIComponent(id)}&q=${encodeURIComponent(tagQuery)}`))).then(v=>{if(!cancelled && active.current.profile===identity)setCatalog(v.flat());}).catch(e=>{if(!cancelled)setError(e.message);});
    if(page==='home') void Promise.all(projects.map(p=>request<Report[]>(identity,`/v1/projects/${p.id}/retrospectives`))).then(v=>{if(!cancelled && active.current.profile===identity)setRecent(v.flat().sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,6));}).catch(e=>{if(!cancelled && g===generation.current)setError(e.message);});
    return()=>{cancelled=true;};
  },[projects,profile,tagQuery,page]);
  function change(values:Partial<Draft>) {dirty.current=true;setDraft(d=>d?{...d,...values}:d);}
  async function write(type:string,payload:object,revision:number,onSuccess?:()=>void) {
    if(writing.current)return false;
    writing.current=true;setBusy(true);setError('');setNotice(''); const identity=profile,id=selected;
    try { await send(type,payload,revision);
      if(active.current.profile!==identity || active.current.id!==id)return true;
      onSuccess?.();setNotice('记录已保存。');
      try {await load(id);await refresh();}catch {setError('记录已保存，但刷新失败。请重新读取，无需重复保存。');}
      return true;
    }catch(e){if(active.current.profile===identity && active.current.id===id)setError((e as Error).message);return false;}
    finally {writing.current=false;setBusy(false);}
  }
  const card=(p:Project)=><button className="project-card" key={p.id} onClick={()=>setSelected(p.id)}><h3>{p.name}</h3><p>{p.description||'尚未填写说明'}</p><span>{lifecycleLabel(p.lifecycle)} · 优先级{priorityNames[p.priority]}</span><div className="library-tags">{p.tags.map(t=><span key={t} className="status">{t}</span>)}</div><small>创建者：{p.creator_name||'历史记录未注明'}</small></button>;
  return <div className="project-library">
    {error&&<div className="error" role="alert"><span>{error}</span><button disabled={busy} onClick={()=>{if(selected)void load(selected).catch(e=>setError(e.message));else void refresh().catch(e=>setError(e.message));}}>重新读取最新数据</button></div>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    {selected?<>
      <button className="text-button" disabled={busy||!!pendingWrite} onClick={()=>setSelected('')}>← 返回{page==='home'?'首页':'项目库'}</button>
      {loading&&<p className="empty">正在读取项目…</p>}
      {project&&draft&&<>
        <div className="section-heading"><h2>{project.name}</h2><span>创建者：{project.creator_name||'历史记录未注明'} · 修订 {project.revision}</span></div>
        <p>项目进度：{lifecycleLabel(project.lifecycle)} · 优先级：{priorityNames[project.priority]}</p>
        {project.can_edit?<form className="library-form" onSubmit={e=>{e.preventDefault();void write('project_update',{id:project.id,name:draft.name.trim(),description:draft.description,lifecycle:draft.lifecycle,priority:draft.priority,tags:draft.tags},draft.revision,()=>{dirty.current=false;});}}>
          <label>项目名称<input required maxLength={120} value={draft.name} onChange={e=>change({name:e.target.value})}/></label>
          <label>项目说明<textarea rows={3} value={draft.description} onChange={e=>change({description:e.target.value})}/></label>
          <div className="form-row"><label>项目进度<select value={draft.lifecycle} onChange={e=>change({lifecycle:e.target.value})}>{Object.entries(lifecycleNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>优先级<select value={draft.priority} onChange={e=>change({priority:e.target.value})}>{Object.entries(priorityNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>
          <label>搜索或创建标签<input value={tagQuery} maxLength={80} onChange={e=>setTagQuery(e.target.value)} placeholder="搜索团队已有标签"/></label>
          <div className="library-tags">{catalog.filter(t=>t.workspace_id===project.workspace_id && normalizeTag(t.name).includes(normalizeTag(tagQuery))).map(t=><button type="button" key={t.id} disabled={draft.tags.some(v=>normalizeTag(v)===normalizeTag(t.name))} onClick={()=>change({tags:addTag(draft.tags,t.name,catalog)})}>＋ {t.name}</button>)}{tagQuery.trim()&&!catalog.some(t=>normalizeTag(t.name)===normalizeTag(tagQuery))&&<button type="button" onClick={()=>change({tags:addTag(draft.tags,tagQuery,catalog)})}>创建标签“{tagQuery.trim()}”</button>}</div>
          <div className="library-tags">{draft.tags.map(t=><button type="button" key={t} aria-label={`移除标签 ${t}`} onClick={()=>change({tags:draft.tags.filter(v=>v!==t)})}>{t} ×</button>)}</div>
          {draft.revision!==project.revision&&<p className="modal-error">项目已有新修订。草稿仍保留原修订，保存时服务器会检查冲突；请核对最新内容后重新编辑。</p>}
          <div className="library-tags"><button className="primary" disabled={busy}>保存项目</button><button className="secondary" type="button" disabled={busy} onClick={()=>void load(project.id,true).catch(e=>setError(e.message))}>放弃元数据草稿，载入最新内容</button></div>
        </form>:<><p className="prose">{project.description||'尚未填写说明'}</p><div className="library-tags">{project.tags.map(t=><span key={t} className="status">{t}</span>)}</div><p className="muted">项目创建者或团队 Owner 可以编辑项目和添加经验报告。</p></>}
        <div className="section-heading spaced"><h2>项目经验报告</h2>{project.can_edit&&<button className="secondary" disabled={busy} onClick={()=>setReportOpen(v=>!v)}>{reportOpen?'收起草稿':'＋ 添加经验报告'}</button>}</div>
        {project.can_edit&&<form className="library-form" hidden={!reportOpen} onSubmit={e=>{e.preventDefault();const form=e.currentTarget;void write('retrospective_create',reportPayload(project.id,new FormData(form),custom),project.revision,()=>{form.reset();setCustom([]);setReportOpen(false);});}}>
          <label>报告标题<input name="title" required maxLength={200}/></label><label>报告结论<select name="outcome" defaultValue="inconclusive">{Object.entries(outcomeNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          {Object.entries(reportSections).map(([key,label])=><label key={key}>{label}<textarea name={key} rows={3} maxLength={12000}/></label>)}
          {custom.map((s,i)=><fieldset key={i}><label>自定义章节标题<input required maxLength={200} value={s.title} onChange={e=>setCustom(v=>v.map((s,j)=>j===i?{...s,title:e.target.value}:s))}/></label><label>章节内容<textarea maxLength={12000} value={s.content} onChange={e=>setCustom(v=>v.map((s,j)=>j===i?{...s,content:e.target.value}:s))}/></label><button type="button" onClick={()=>setCustom(v=>v.filter((_,j)=>i!==j))}>移除章节</button></fieldset>)}
          <div className="library-tags"><button type="button" disabled={custom.length>=20||busy} onClick={()=>setCustom(v=>[...v,{title:'',content:''}])}>＋ 自定义章节</button><button className="primary" disabled={busy}>保存经验报告</button></div>
        </form>}
        {reports.length===0&&<p className="empty compact">尚无经验报告。</p>}
        {reports.map(r=><article key={r.id} className="library-report"><h3>{r.title} <span className="status">{outcomeLabel(r.outcome)}</span></h3><small>{r.author_name}{r.agent_id ? " · Agent 提交" : " · 人类提交"} · {stamp(r.created_at)}</small>{Object.entries(reportSections).map(([key,label])=><section key={key}><h4>{label}</h4><p className="prose">{String(r[key]||'尚未填写')}</p></section>)}{r.custom_sections.map((s,i)=><section key={i}><h4>{s.title}</h4><p className="prose">{s.content}</p></section>)}</article>)}
        <details className="library-report"><summary>Codex 连接信息</summary><p>项目 ID：<code>{project.id}</code></p><p>空间 ID：<code>{project.workspace_id}</code></p></details>
        <div className="library-tags">{project.tags.map(t=><button key={t} disabled={busy||!!pendingWrite} onClick={()=>{setTagFilter(t);setSelected('');}}>查看标签“{t}”的项目</button>)}</div>
        <h2 className="spaced">团队讨论</h2>{comments.map(c=><article key={c.id} className="library-comment"><small>{c.author_name}{c.agent_id ? " · Agent 提交" : " · 人类提交"} · {stamp(c.created_at)}</small><p className="prose">{c.body}</p></article>)}
        <form className="library-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;void write('comment_create',{project_id:project.id,body:String(new FormData(form).get('body')??'').trim()},project.revision,()=>form.reset());}}><label>添加评论<textarea name="body" required maxLength={12000} rows={3}/></label><button className="primary" disabled={busy}>发送评论</button></form>
        <details className="library-report"><summary>历史实验记录（{experiments.filter(e=>e.project_id===project.id).length}）</summary>{experiments.filter(e=>e.project_id===project.id).map(e=><button className="experiment-row" key={e.id} onClick={()=>openExperiment(e.id)}><span>{e.name} · v{e.version}</span><span>查看实验与证据 →</span></button>)}</details>
      </>}
    </>:page==='home'?<>
      <div className="section-heading"><h2>按优先级推进创意</h2><span className="muted">待做与进行中的项目</span></div><div className="project-grid">{prioritizedIdeas(projects).map(card)}</div>{!prioritizedIdeas(projects).length&&<p className="empty">还没有待推进的创意。</p>}
      <h2 className="spaced">最近项目经验</h2>{recent.map(r=><button className="experiment-row" key={r.id} onClick={()=>setSelected(r.project_id)}><span><strong>{r.title}</strong><small>{projects.find(p=>p.id===r.project_id)?.name} · {r.author_name}</small></span><span>{outcomeLabel(r.outcome)}</span><time>{stamp(r.created_at)}</time></button>)}{!recent.length&&<p className="empty compact">尚无项目经验报告。</p>}
    </>:<>
      <div className="filters"><input aria-label="搜索项目库" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索名称、说明或标签…"/></div>
      <div className="library-tags"><button className={!tagFilter?'primary':'secondary'} onClick={()=>setTagFilter('')}>所有标签</button>{[...new Set(projects.flatMap(p=>p.tags))].map(t=><button className={normalizeTag(t)===normalizeTag(tagFilter)?'primary':'secondary'} key={t} onClick={()=>setTagFilter(t)}>{t}</button>)}</div>
      <div className="project-grid large">{filterProjects(projects,search,tagFilter).map(card)}</div>{!filterProjects(projects,search,tagFilter).length&&<p className="empty">没有符合条件的项目。</p>}
    </>}
  </div>;
}
