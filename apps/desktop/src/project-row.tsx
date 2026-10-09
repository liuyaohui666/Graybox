import React from 'react';
import {Attribution} from './avatars.tsx';
import {lifecycleLabel,priorityNames} from './project-library-model.ts';
import type {Project} from './model.ts';

/** Shared project entry for the workspace and a member's home. */
export function ProjectRow({project:p,locked,open}:{project:Project;locked:boolean;open:()=>void}) {
  return <button className="project-row" disabled={locked} onClick={open}>
    <span className={`project-state state-${p.lifecycle}`}>{lifecycleLabel(p.lifecycle)}</span>
    <span className="project-row-content"><strong>{p.name}</strong><span className="project-description">{p.description||'暂无说明'}</span></span>
    <span className="project-row-tags">{(p.tags??[]).map(t=><span key={t}>{t}</span>)}</span>
    <span className={`project-priority priority-${p.priority}`}><span aria-hidden="true">▥</span> {priorityNames[p.priority]??'中'}</span>
    <span className="project-owner" title="项目 owner"><Attribution id={p.owner_id??p.creator_id} name={p.owner_name??p.creator_name}/></span>
  </button>;
}
