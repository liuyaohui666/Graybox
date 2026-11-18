import React from 'react';
import {Attribution} from './avatars.tsx';
import {boardStages,groupProjects} from './project-board-model.ts';
import {lifecycleLabel,priorityNames} from './project-library-model.ts';
import type {Project} from './model.ts';

export function ProjectBoard({projects,reviewedIds,locked,open}:{projects:Project[];reviewedIds:Set<string>;locked:boolean;open:(id:string)=>void}) {
  const groups=groupProjects(projects);
  return <div className="project-board">{boardStages.map(stage=><section className="board-column" key={stage.id} aria-label={stage.label}>
    <h2 className="board-heading">{stage.label} <span className="board-count">{groups[stage.id].length}</span></h2>
    {groups[stage.id].map(p=><button type="button" className="board-card" key={p.id} disabled={locked} onClick={()=>open(p.id)}>
      <span className="board-card-meta"><span className={`project-state state-${p.lifecycle}`}>{lifecycleLabel(p.lifecycle)}</span><span className={`project-priority priority-${p.priority}`}>优先级 {priorityNames[p.priority]??p.priority}</span></span>
      <strong className="board-card-title">{p.name}</strong>
      <span className="board-card-description">{p.description||'暂无说明'}</span>
      <span className="board-card-tags">{(p.tags??[]).map(t=><span key={t}>{t}</span>)}</span>
      <span className="board-card-footer"><span title="项目 owner"><Attribution id={p.owner_id??p.creator_id} name={p.owner_name??p.creator_name}/></span>{reviewedIds.has(p.id)&&<span className="board-reviewed">已复盘</span>}</span>
    </button>)}
    {!groups[stage.id].length&&<p className="board-empty">暂无项目</p>}
  </section>)}</div>;
}
