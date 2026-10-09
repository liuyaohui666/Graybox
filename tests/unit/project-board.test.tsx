import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {groupProjects} from '../../apps/desktop/src/project-board-model.ts';
import {ProjectBoard} from '../../apps/desktop/src/project-board.tsx';
import type {Project} from '../../apps/desktop/src/model.ts';

const project=(id:string,lifecycle:string,priority='medium'):Project=>({id,name:`项目 ${id}`,description:'实际说明',lifecycle,priority,tags:['中文标签'],can_edit:false,workspace_id:'w',revision:1,status:'active',updated_at:'2026-10-09',owner_id:'owner',owner_name:'负责人',creator_name:'创建者'});
describe('project board',()=>{
  it('keeps paused and unfamiliar lifecycles reachable and sorts stably without mutation',()=>{
    const projects=[project('low','todo','low'),project('medium','todo'),project('high','todo','high'),project('tie','todo','high'),project('working','in_progress'),project('paused','paused'),project('unknown','future'),project('done','completed')];
    const original=[...projects],groups=groupProjects(projects);
    expect(groups.ideas.map(p=>p.id)).toEqual(['high','tie','medium','low']);
    expect(groups.active.map(p=>p.id)).toEqual(['working','paused','unknown']);
    expect(groups.done.map(p=>p.id)).toEqual(['done']);expect(projects).toEqual(original);
    expect(Object.values(groups).flat()).toHaveLength(projects.length);
  });
  it('renders genuine counts, preserved labels and only confirmed report markers on disabled native cards',()=>{
    const projects=[project('paused','paused'),project('unknown','future'),project('reviewed','completed'),project('no-report','completed')];
    const html=renderToStaticMarkup(<ProjectBoard projects={projects} reviewedIds={new Set(['reviewed'])} locked open={()=>{}}/>);
    expect(html).toContain('暂停');expect(html).toContain('future');expect(html.match(/已复盘/g)).toHaveLength(1);
    expect(html).toContain('项目 no-report');expect(html.match(/class="board-count">2/g)).toHaveLength(2);
    expect(html.match(/type="button" class="board-card" disabled=""/g)).toHaveLength(4);
    expect(html).toContain('负责人');expect(html).not.toContain('创建者');expect(html).toContain('中文标签');
  });
  it('renders empty stage messages and enabled cards when unlocked',()=>{
    const html=renderToStaticMarkup(<ProjectBoard projects={[project('idea','todo')]} reviewedIds={new Set()} locked={false} open={()=>{}}/>);
    expect(html.match(/暂无项目/g)).toHaveLength(2);expect(html).not.toContain('disabled');expect(html).not.toContain('已复盘');
  });
});
