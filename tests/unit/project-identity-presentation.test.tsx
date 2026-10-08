import React from 'react';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect} from 'vitest';
import {ProjectLibrary} from '../../apps/desktop/src/project-library.tsx';
import {PeopleContext,SidebarAccount} from '../../apps/desktop/src/avatars.tsx';
import type {Project} from '../../apps/desktop/src/model.ts';
const source=(name:string)=>readFileSync(new URL(`../../apps/desktop/src/${name}`,import.meta.url),'utf8');
test('sidebar keeps the avatar menu and nickname without persistent identity selector',()=>{
 const main=source('main.tsx'),sidebar=main.slice(main.indexOf('<aside className="sidebar">'),main.indexOf('</aside>'));
 expect(sidebar).toContain('<SidebarAccount');
 expect(sidebar).not.toContain('当前身份');expect(sidebar).not.toContain('<select');expect(sidebar).not.toContain('setProfile(');
 const person={id:'a',name:'Owner demonstration',role:'owner'};
 const html=renderToStaticMarkup(<PeopleContext.Provider value={{mode:'local',people:[person],refresh:async()=>{}}}><SidebarAccount profile="a" person={person} locked={false} setBusy={()=>{}}/></PeopleContext.Provider>);
 expect(html).toContain('本地用户1');expect(html).toContain('头像选项');expect(html).toContain('更换头像');expect(html).toContain('恢复默认头像');
 expect(html).not.toContain('<select');expect(html).not.toContain('owner');expect(html).not.toContain('当前身份');
});
test('same account sees its actual role per project and named owner in project cards',()=>{
 const base={description:'',lifecycle:'todo',priority:'medium',tags:[],workspace_id:'w',revision:1,status:'active',updated_at:'2026-10-08'};
 const projects=[{...base,id:'a',name:'A project',creator_name:'江微雪',creator_id:'a',owner_name:'江微雪',owner_id:'a',project_role:'owner',can_edit:true},{...base,id:'b',name:'B project',creator_name:'朋友',creator_id:'b',owner_name:'朋友',owner_id:'b',project_role:'member',can_edit:false}] as Project[];
 const html=renderToStaticMarkup(<ProjectLibrary profile="a" page="projects" projects={projects} experiments={[]} createdId="" busy={false} setBusy={()=>{}} send={async()=>{}} refresh={async()=>{}} openExperiment={()=>{}}/>);
 expect(html).toContain('项目 owner');expect(html).toContain('你在此项目：owner');expect(html).toContain('你在此项目：member');
 expect(html).toContain('江微雪');expect(html).toContain('朋友');expect(html).not.toContain('团队 owner');
});
test('legacy experiment UI gates writes and creation using project edit authority',()=>{
 const main=source('main.tsx');expect(main).toContain('editableProjects');expect(main).toContain('!detailCanEdit');
 expect(main).toContain('!canPreviewUndo(a)');expect(source('cloud-ui.tsx')).not.toContain('{m.role}');
 expect(source('cloud-ui.tsx')).toContain('团队管理');
});
