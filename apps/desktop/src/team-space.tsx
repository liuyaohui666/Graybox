import React,{useContext,useEffect,useRef,useState} from 'react';
import {Avatar,PeopleContext,type Person} from './avatars.tsx';
import {displayName} from './avatar-model.ts';
import {memberWork} from './team-social-model.ts';
import {ProjectRow} from './project-row.tsx';
import type {Project} from './model.ts';
interface MemberProps {person:Person;projects:Project[];locked:boolean}
export function MemberDetails({person,projects,locked,enter,close}:MemberProps&{enter:()=>void;close:()=>void}) {
 const {mode}=useContext(PeopleContext),work=memberWork(projects,person.id);
 return <><div className="modal-heading"><h2>成员资料</h2><button aria-label="关闭成员资料" onClick={close} disabled={locked}>×</button></div><div className="member-identity"><Avatar person={person} mode={mode}/><h3>{displayName(person,mode)}</h3></div><p>{work.ideas.length} 个想法 · {work.led.length} 个主导项目</p><div className="modal-actions"><button className="primary" disabled={locked} onClick={enter}>进入主页</button></div></>;
}
export function TeamSpace({projects,locked,openMember}:{projects:Project[];locked:boolean;openMember:(id:string)=>void}) {
 const {people,mode,error,refresh}=useContext(PeopleContext),[selected,setSelected]=useState(''),modal=useRef<HTMLDialogElement>(null),person=people.find(p=>p.id===selected);
 useEffect(()=>{if(person)modal.current?.showModal();else modal.current?.close();},[person]);
 return <section className="team-space" aria-label="团队成员"><div className="section-heading"><h2>成员 <span>{people.length}</span></h2><button className="text-button" disabled={locked} onClick={()=>void refresh().catch(()=>{})}>刷新成员</button></div>{error&&<p role="alert">{error} · 请点击刷新成员重试。</p>}<div className="member-strip">{people.map(p=><button className="member-entry" key={p.id} disabled={locked} aria-label={`查看${displayName(p,mode)}的资料`} onClick={()=>setSelected(p.id)}><Avatar person={p} mode={mode}/><span className="member-name">{displayName(p,mode)}</span></button>)}</div>{!people.length&&<p className="muted">正在读取团队成员…</p>}<dialog aria-label="成员资料" ref={modal} onCancel={e=>{if(locked)e.preventDefault();else setSelected('');}}>{person&&<MemberDetails person={person} projects={projects} locked={locked} close={()=>setSelected('')} enter={()=>{if(!locked){setSelected('');openMember(person.id);}}}/>}</dialog></section>;
}
export function MemberHome({person,projects,locked,openProject,back}:MemberProps&{openProject:(id:string)=>void;back:()=>void}) {
 const {mode}=useContext(PeopleContext),work=memberWork(projects,person.id);
 const cards=(rows:Project[])=>rows.map(p=><ProjectRow key={p.id} project={p} locked={locked} open={()=>openProject(p.id)}/>);
 return <section className="member-home"><button className="secondary back-button" disabled={locked} onClick={back}>← 返回团队空间</button><div className="member-identity"><Avatar person={person} mode={mode}/><h2>{displayName(person,mode)}的主页</h2></div><p>{work.ideas.length} 个想法 · {work.led.length} 个主导项目</p><h2>想法</h2><div className="project-list">{cards(work.ideas)}</div>{!work.ideas.length&&<p className="empty compact">还没有想法。</p>}<h2 className="spaced">主导项目</h2><div className="project-list">{cards(work.led)}</div>{!work.led.length&&<p className="empty compact">还没有主导项目。</p>}</section>;
}
export function MemberPage({id,...props}:Omit<MemberProps,'person'>&{id:string;openProject:(id:string)=>void;back:()=>void}) {
 const {people}=useContext(PeopleContext),person=people.find(p=>p.id===id);
 return person?<MemberHome person={person} {...props}/>:<p className="empty">成员当前不可用。<button className="text-button" disabled={props.locked} onClick={props.back}>返回团队空间</button></p>;
}
