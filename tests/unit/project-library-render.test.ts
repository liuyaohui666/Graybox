import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {ProjectLibrary} from '../../apps/desktop/src/project-library.tsx';
import type {Project} from '../../apps/desktop/src/model.ts';
const projects:Project[]=[{id:'a',name:'先做创意',description:'团队说明',lifecycle:'todo',priority:'high',tags:['中文标签'],can_edit:true,creator_name:'江微雪',workspace_id:'w',revision:1,status:'active',updated_at:'2026-10-08'}, {id:'b',name:'已完成项目',description:'',lifecycle:'completed',priority:'low',tags:[],can_edit:false,workspace_id:'w',revision:1,status:'archived',updated_at:'2026-10-08'}];
const render=(page:'home'|'projects')=>renderToStaticMarkup(React.createElement(ProjectLibrary,{profile:'human',page,projects,experiments:[],createdId:'',busy:false,setBusy:()=>{},send:async()=>{},refresh:async()=>{},openExperiment:()=>{}}));
describe('library entry rendering',()=>{
  it('home shows every project stage and distinct recent report area',()=>{const html=render('home');expect(html).toContain('先做创意');expect(html).toContain('已完成项目');expect(html).toContain('完成与复盘');expect(html).toContain('最近经验');expect(html).toContain('江微雪');expect(html).not.toContain('已复盘');});
  it('library shows all projects, search and clickable Chinese tag filtering',()=>{const html=render('projects');expect(html).toContain('已完成项目');expect(html).toContain('aria-label="搜索项目库"');expect(html).toContain('中文标签</button>');});
});
