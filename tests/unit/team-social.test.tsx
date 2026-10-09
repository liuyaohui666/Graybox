import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect} from 'vitest';
import {memberWork,AgreementAttempt,NotificationReadAttempt} from '../../apps/desktop/src/team-social-model.ts';
import {TeamSpace,MemberDetails,MemberHome} from '../../apps/desktop/src/team-space.tsx';
import {InboxList,NotificationEntry,AgreementButton,SocialContext} from '../../apps/desktop/src/team-social.tsx';
import {PeopleContext} from '../../apps/desktop/src/avatars.tsx';
import {allowedLocalRequest} from '../../apps/desktop/src/request-path.ts';
import {WriteSafety} from '../../apps/desktop/src/write-safety.ts';
import type {Project} from '../../apps/desktop/src/model.ts';
const person={id:'a',name:'江微雪',role:'owner'};
const projects=[{id:'idea',name:'未开始创意',creator_id:'a',lifecycle:'todo'},{id:'led',name:'主导项目A',creator_id:'a',lifecycle:'paused'},{id:'other',name:'其他人项目',creator_id:'b',lifecycle:'todo'},{id:'unknown',name:'历史无owner',lifecycle:'completed'}] as Project[];
const wrap=(child:React.ReactNode)=>renderToStaticMarkup(<PeopleContext.Provider value={{people:[person],mode:'cloud',refresh:async()=>{}}}>{child}</PeopleContext.Provider>);
test('member home filters actual creator only and splits ideas from led projects with empty states',()=>{
 expect(memberWork(projects,'a').ideas.map(p=>p.id)).toEqual(['idea']);expect(memberWork(projects,'a').led.map(p=>p.id)).toEqual(['led']);
 const html=wrap(<MemberHome person={person} projects={projects} locked={false} openProject={()=>{}} back={()=>{}}/>);expect(html).toContain('未开始创意');expect(html).toContain('主导项目A');expect(html).not.toContain('其他人项目');expect(html).not.toContain('历史无owner');
 const empty=wrap(<MemberHome person={{...person,id:'empty'}} projects={projects} locked={false} openProject={()=>{}} back={()=>{}}/>);expect(empty).toContain('还没有想法');expect(empty).toContain('还没有主导项目');
});
test('team entry renders named avatar, details render public stats and explicit home action without global roles',()=>{
 const strip=wrap(<TeamSpace projects={projects} locked={false} openMember={()=>{}}/>);expect(strip).toContain('aria-label="查看江微雪的资料"');expect(strip).toContain('<span class="member-name">江微雪</span>');
 const card=wrap(<MemberDetails person={person} projects={projects} locked={false} enter={()=>{}} close={()=>{}}/>);expect(card).toContain('进入主页');expect(card).toContain('1 个想法');expect(card).toContain('1 个主导项目');expect(card).not.toContain('owner');
});
test('inbox renders private unread controls, agent attribution, project navigation and deleted project history',()=>{
 const message={id:'n',project_id:'idea',project_name:'Idea',actor_id:'a',actor_name:'江微雪',agent_id:'agent',kind:'comment' as const,created_at:'2026-10-08T00:00:00Z',read_at:null,project_available:true,comment_preview:'Observed'};
 const html=wrap(<InboxList items={[message,{...message,id:'gone',project_available:false}]} locked={false} mark={()=>{}} openProject={()=>{}}/>);expect(html).toContain('标为已读');expect(html).toContain('查看项目');expect(html).toContain('项目已移入回收状态');expect(html).toContain('Agent');expect(html).toContain('Observed');
 const entry=renderToStaticMarkup(<SocialContext.Provider value={{unread_count:3} as any}><NotificationEntry locked={false} open={()=>{}}/></SocialContext.Provider>);expect(entry).toContain('aria-label="消息，3 条未读"');
});
test('agreement UI exposes count and pressed state and denies self action',()=>{
 const html=renderToStaticMarkup(<AgreementButton state={{count:2,agreed:true,can_agree:true}} locked={false} pending={false} act={()=>{}}/>);expect(html).toContain('aria-pressed="true"');expect(html).toContain('已赞同');expect(html).toContain('2');
 const self=renderToStaticMarkup(<AgreementButton state={{count:0,agreed:false,can_agree:false}} locked={false} pending={false} act={()=>{}}/>);expect(self).toContain('disabled');expect(self).toContain('自己的项目');
});
test('unknown agreement result retries the identical intended state and cannot move to another project, account or session',()=>{
 const attempt=new AgreementAttempt(),guard=new WriteSafety();const target=attempt.prepare('a','idea',1,false);
 const first=guard.begin('a','/v1/projects/idea/agreement',{agreed:target.agreed},1);guard.finish(first,false);attempt.finish(false,true);
 expect(attempt.prepare('a','idea',1,true)).toEqual(target);
 for(const [p,id,s] of [['a','other',1],['b','idea',1],['a','idea',2]] as const)expect(()=>attempt.prepare(p,id,s,true)).toThrow();
 const retry=guard.begin('a','/v1/projects/idea/agreement',{agreed:target.agreed},1);guard.finish(retry,true);attempt.finish(true,false);expect(attempt.prepare('a','idea',1,true).agreed).toBe(false);
});
test('visible read snapshot excludes incoming ids and chunk retries resume exact unconfirmed target',()=>{
 const attempt=new NotificationReadAttempt();attempt.prepare(Array.from({length:120},(_,i)=>String(i)));expect(attempt.chunk()).toHaveLength(100);attempt.success();expect(attempt.chunk()).toHaveLength(20);attempt.prepare(['new']);expect(attempt.chunk()).not.toContain('new');attempt.success();expect(attempt.chunk()).toEqual([]);attempt.clear();attempt.prepare(['new']);expect(attempt.chunk()).toEqual(['new']);
});
test('new browser bridge allows precise social methods and rejects neighboring routes',()=>{
 for(const path of ['/v1/notifications','/v1/projects/abc/agreement','/v1/notifications?before=abc-123'])expect(allowedLocalRequest(path,'GET')).toBe(true);
 for(const path of ['/v1/notifications/read','/v1/projects/abc/agreement'])expect(allowedLocalRequest(path,'POST')).toBe(true);
 for(const [path,method] of [['/v1/notifications/read','GET'],['/v1/notifications','POST'],['/v1/projects/abc/agreement/other','POST'],['/v1/projects/abc','POST']])expect(allowedLocalRequest(path,method)).toBe(false);
});
import {readFileSync} from 'node:fs';
import {LibraryNavigation} from '../../apps/desktop/src/library-app-state.ts';
test('every project entry including member/message origins wires tag navigation and respects pending writes',()=>{
 const source=readFileSync(new URL('../../apps/desktop/src/main.tsx',import.meta.url),'utf8');
 const entries=source.split('\n').filter(line=>line.includes('<ProjectLibrary'));expect(entries).toHaveLength(2);for(const entry of entries)expect(entry).toContain('openTag={openLibraryTag}');
 const nav=new LibraryNavigation();let selected='member project',tag='';
 const openTag=(value:string,pending:unknown)=>{if(nav.accept(false,false,pending)!==null){selected='projects';tag=value;}};
 openTag('Art',{ambiguous:true});expect(selected).toBe('member project');expect(tag).toBe('');openTag('Art',null);expect(selected).toBe('projects');expect(tag).toBe('Art');
});
