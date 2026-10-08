import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {request,sessionGeneration,type Profile} from './platform.ts';
import {AvatarGeneration,displayName,personLabel,prepareAvatar} from './avatar-model.ts';
export interface Person extends Profile {avatar_data?:string|null}
export const PeopleContext=createContext<{people:Person[];mode:'local'|'cloud';refresh:()=>Promise<void>}>({people:[],mode:'cloud',refresh:async()=>{}});
export function PeopleProvider({profile,mode,children}:{profile:string;mode:'local'|'cloud';children:React.ReactNode}) {
 const [people,setPeople]=useState<Person[]>([]),generation=useRef(0),active=useRef(profile),reads=useRef(0);active.current=profile;
 async function refresh(){const id=profile,g=generation.current,r=++reads.current;if(!id)return;const value=await request<Person[]>(id,'/v1/people');if(active.current===id&&generation.current===g&&reads.current===r)setPeople(value);}
 useEffect(()=>{generation.current++;setPeople([]);void refresh().catch(()=>{});const timer=setInterval(()=>void refresh().catch(()=>{}),15000);return()=>{generation.current++;clearInterval(timer);};},[profile]);
 return <PeopleContext.Provider value={{people,mode,refresh}}>{children}</PeopleContext.Provider>;
}
export function Avatar({person,mode='cloud'}:{person?:Person;mode?:'local'|'cloud'}) {
 const [broken,setBroken]=useState<string|null>(null),name=person?displayName(person,mode):'历史记录未注明',label=person?personLabel(person,mode):name;
 const source=person?.avatar_data,valid=source&&source.length<=180000&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(source);
 let hash=0;for(const c of person?.id??name)hash=(hash*31+c.charCodeAt(0))>>>0;
 return <span className="person-avatar" role="img" aria-label={label} title={label} style={{backgroundColor:`hsl(${hash%360} 32% 38%)`}}>{valid&&broken!==source?<img src={source} alt="" onError={()=>setBroken(source)}/>:name.slice(0,1).toUpperCase()}</span>;
}
export function Attribution({id,name,agentId,detail=false}:{id?:string|null;name?:string|null;agentId?:string|null;detail?:boolean}) {
 const {people,mode}=useContext(PeopleContext),person=people.find(p=>p.id===id),fallback=person??(name?{id:id??name,name,role:''}:undefined);
 return <span className="attribution"><Avatar person={fallback} mode={mode}/>{detail&&<span>{fallback?personLabel(fallback,mode):'历史记录未注明'}</span>}{agentId&&<span className="agent-indicator">Agent</span>}</span>;
}
export function AvatarEditor({profile,person,locked,setBusy}:{profile:string;person?:Person;locked:boolean;setBusy:(busy:boolean)=>void}) {
 const {people,mode,refresh}=useContext(PeopleContext),guard=useRef(new AvatarGeneration()),active=useRef(profile),writing=useRef(false),[message,setMessage]=useState('');active.current=profile;
 const current=people.find(p=>p.id===profile)??person,input=useRef<HTMLInputElement>(null),menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{guard.current.cancel();setMessage('');if(menu.current)menu.current.open=false;return()=>guard.current.cancel();},[profile]);
 useEffect(()=>{const close=(event:PointerEvent)=>{if(menu.current&&!menu.current.contains(event.target as Node))menu.current.open=false;};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 async function save(file:File|null) {
  if(!profile||locked||writing.current)return;writing.current=true;setBusy(true);setMessage('');
  const token=guard.current.begin(profile,sessionGeneration());
  try {const avatar_data=file?await prepareAvatar(file):null;
   if(!guard.current.current(token,active.current,sessionGeneration()))return;
   await request<Person>(token.profile,'/v1/profile/avatar','POST',{avatar_data});
   if(!guard.current.current(token,active.current,sessionGeneration()))return;
   setMessage('头像已保存。');try{await refresh();}catch{setMessage('头像已保存，刷新失败。请重新读取。');}
  }catch(e){if(guard.current.current(token,active.current,sessionGeneration()))setMessage((e as Error).message);}
  finally{writing.current=false;setBusy(false);}
 }
 return <details ref={menu} className="avatar-editor" onKeyDown={e=>{if(e.key==='Escape'&&menu.current){menu.current.open=false;menu.current.querySelector('summary')?.focus();}}}><summary role="button" aria-label="头像选项" title="更换头像"><Avatar person={current} mode={mode}/></summary><div className="avatar-menu"><button type="button" disabled={locked} onClick={()=>input.current?.click()}>更换头像</button><input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void save(file);}}/><button type="button" disabled={locked||!current?.avatar_data} onClick={()=>void save(null)}>恢复默认头像</button>{message&&<p role="status">{message}</p>}</div></details>;
}
