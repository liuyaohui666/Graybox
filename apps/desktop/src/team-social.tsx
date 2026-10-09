import React,{createContext,useContext,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Attribution} from './avatars.tsx';
import {request,sessionGeneration} from './platform.ts';
import {LatestProfileRefresh} from './library-app-state.ts';
import {writeSafety} from './write-safety.ts';
import {AgreementAttempt,NotificationReadAttempt,type AgreementState,type InboxPage,type NotificationItem} from './team-social-model.ts';
interface SocialValue extends InboxPage {error:string;loading:boolean;writing:boolean;refresh:()=>Promise<void>;more:()=>Promise<void>;mark:(ids:string[])=>Promise<void>;retryRead:()=>Promise<void>;hasReadRetry:boolean}
export const SocialContext=createContext<SocialValue>({items:[],unread_count:0,error:'',loading:false,writing:false,refresh:async()=>{},more:async()=>{},mark:async()=>{},retryRead:async()=>{},hasReadRetry:false});
export function SocialProvider({profile,setBusy,children}:{profile:string;setBusy:(v:boolean)=>void;children:React.ReactNode}) {
 const [page,setPage]=useState<InboxPage>({items:[],unread_count:0}),[error,setError]=useState(''),[loading,setLoading]=useState(false),[writingState,setWriting]=useState(false),[hasReadRetry,setReadRetry]=useState(false);
 const active=useRef(profile),generation=useRef(0),sequence=useRef(0),pages=useRef(1),writing=useRef(false),attempt=useRef(new NotificationReadAttempt());active.current=profile;
 const pending=useSyncExternalStore(writeSafety.subscribe,writeSafety.snapshot,()=>null);
 async function refresh() {
  if(!profile)return;const identity=profile,g=generation.current,r=++sequence.current,s=sessionGeneration();
  const current=()=>active.current===identity&&generation.current===g&&sequence.current===r&&sessionGeneration()===s;
  if(current())setLoading(true);
  try {let data=await request<InboxPage>(identity,'/v1/notifications'),all=[...data.items];
   for(let i=1;i<pages.current&&data.next_cursor;i++){data=await request<InboxPage>(identity,`/v1/notifications?before=${data.next_cursor}`);all.push(...data.items);}
   if(current()){setPage({...data,items:all});if(!writeSafety.snapshot())setError('');}
  }catch(e){if(current())setError((e as Error).message);}
  finally{if(current())setLoading(false);}
 }
 useEffect(()=>{generation.current++;pages.current=1;setPage({items:[],unread_count:0});setError('');attempt.current.clear();setReadRetry(false);const update=()=>void refresh();update();const timer=setInterval(update,15000);window.addEventListener('focus',update);return()=>{generation.current++;clearInterval(timer);window.removeEventListener('focus',update);};},[profile]);
 useEffect(()=>{if(!pending&&!writing.current){attempt.current.clear();setReadRetry(false);}},[pending]);
 async function mark(ids:string[]) {
  if(writing.current||!profile)return;if(writeSafety.snapshot()&&!hasReadRetry)return;
  attempt.current.prepare(ids);writing.current=true;setWriting(true);setBusy(true);setError('');const identity=profile,g=generation.current,s=sessionGeneration();
  const current=()=>active.current===identity&&generation.current===g&&sessionGeneration()===s;
  try {while(attempt.current.chunk().length){await request(identity,'/v1/notifications/read','POST',{ids:attempt.current.chunk()});if(!current())return;attempt.current.success();}
   attempt.current.clear();if(current()){setReadRetry(false);await refresh();}
  }catch(e){if(current()){setReadRetry(!!writeSafety.snapshot());if(!writeSafety.snapshot())attempt.current.clear();setError((e as Error).message);}}
  finally{writing.current=false;setWriting(false);setBusy(false);}
 }
 return <SocialContext.Provider value={{...page,error,loading,writing:writingState,hasReadRetry,refresh,more:async()=>{pages.current++;await refresh();},mark,retryRead:()=>mark([])}}>{children}</SocialContext.Provider>;
}
export function NotificationEntry({locked,open}:{locked:boolean;open:()=>void}) {
 const {unread_count}=useContext(SocialContext);
 return <button className="notification-entry" disabled={locked} onClick={open} aria-label={`消息，${unread_count} 条未读`}>消息{unread_count>0&&<span className="unread-badge">{unread_count}</span>}</button>;
}
export function InboxList({items,locked,mark,openProject}:{items:NotificationItem[];locked:boolean;mark:(ids:string[])=>void;openProject:(id:string)=>void}) {
 return <div className="inbox-list">{items.map(n=><article className={'library-comment '+(!n.read_at?'unread':'')} key={n.id}><small><Attribution id={n.actor_id} name={n.actor_name} agentId={n.agent_id} detail/> · {new Date(n.created_at).toLocaleString('zh-CN')} · {n.read_at?'已读':'未读'}</small><p>{n.kind==='agreement'?'赞同了':'评论了'}“{n.project_name}”</p>{n.kind==='comment'&&<p className="prose">{n.comment_preview}</p>}<div className="library-tags">{n.project_available?<button disabled={locked} onClick={()=>openProject(n.project_id)}>查看项目</button>:<span className="muted">项目已移入回收状态，保留历史消息。</span>}{!n.read_at&&<button disabled={locked} onClick={()=>mark([n.id])}>标为已读</button>}</div></article>)}</div>;
}
export function Inbox({locked,openProject}:{locked:boolean;openProject:(id:string)=>void}) {
 const value=useContext(SocialContext),pending=useSyncExternalStore(writeSafety.subscribe,writeSafety.snapshot,()=>null);
 return <section aria-label="我的消息"><div className="section-heading"><h2>我的消息 · {value.unread_count} 条未读</h2><button className="secondary" disabled={locked||!value.items.some(n=>!n.read_at)} onClick={()=>void value.mark(value.items.filter(n=>!n.read_at).map(n=>n.id))}>将当前显示的消息标为已读</button></div><p className="muted">这里只显示发给你的赞同与评论。赞同取消后保留历史消息。</p>{value.error&&<div className="error" role="alert"><span>{value.error}</span><button disabled={value.writing} onClick={()=>void value.refresh()}>重新读取消息</button>{value.hasReadRetry&&<button disabled={value.writing} onClick={()=>void value.retryRead()}>重试原已读操作</button>}</div>}{!value.items.length&&<p className="empty">{value.loading?'正在读取消息…':'还没有消息。'}</p>}<InboxList items={value.items} locked={locked||!!pending} mark={ids=>void value.mark(ids)} openProject={openProject}/>{value.next_cursor&&<button className="secondary" disabled={locked||value.loading} onClick={()=>void value.more()}>加载更早的消息</button>}</section>;
}
export function AgreementButton({state,locked,pending,act}:{state:AgreementState;locked:boolean;pending:boolean;act:()=>void}) {
 return <button className="agreement-button" type="button" disabled={!state.can_agree||locked} aria-pressed={state.agreed} title={!state.can_agree?'自己的项目或尚无 owner 的项目无需赞同':state.agreed?'点击取消赞同':'赞同这个项目'} onClick={act}>{pending?'重试原赞同操作':state.agreed?'已赞同':'赞同'} <span>{state.count}</span></button>;
}
export function ProjectAgreement({profile,projectId,busy,setBusy}:{profile:string;projectId:string;busy:boolean;setBusy:(v:boolean)=>void}) {
 const [state,setState]=useState<AgreementState|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),pending=useSyncExternalStore(writeSafety.subscribe,writeSafety.snapshot,()=>null);
 const active=useRef({profile,projectId}),generation=useRef(0),reads=useRef(new LatestProfileRefresh()),writing=useRef(false),attempt=useRef(new AgreementAttempt());active.current={profile,projectId};
 const ownPending=pending?.profile===profile&&pending.path===`/v1/projects/${projectId}/agreement`;
 async function read() {
  const identity=profile,id=projectId,key=`${identity}:${id}:${sessionGeneration()}`;
  await reads.current.run(key,()=>`${active.current.profile}:${active.current.projectId}:${sessionGeneration()}`,()=>request<AgreementState>(identity,`/v1/projects/${id}/agreement`),next=>{setState(next);if(!writeSafety.snapshot())setError('');},e=>setError(e.message));
 }
 useEffect(()=>{generation.current++;reads.current.invalidate();setState(null);setError('');const update=()=>{if(!writing.current)void read();};update();const timer=setInterval(update,15000);window.addEventListener('focus',update);return()=>{generation.current++;reads.current.invalidate();clearInterval(timer);window.removeEventListener('focus',update);};},[profile,projectId]);
 useEffect(()=>{if(!pending&&!writing.current)attempt.current.clear();},[pending]);
 async function act() {
  if(!state||writing.current||busy||(!ownPending&&writeSafety.snapshot()))return;
  const target=attempt.current.prepare(profile,projectId,sessionGeneration(),state.agreed),g=generation.current;reads.current.invalidate();writing.current=true;setBusy(true);setLoading(true);setError('');
  const current=()=>active.current.profile===target.profile&&active.current.projectId===target.projectId&&generation.current===g&&sessionGeneration()===target.session;
  try {const next=await request<AgreementState>(target.profile,`/v1/projects/${target.projectId}/agreement`,'POST',{agreed:target.agreed});attempt.current.finish(true,false);if(current())setState(next);}
  catch(e){attempt.current.finish(false,!!writeSafety.snapshot());if(current())setError((e as Error).message);}
  finally{writing.current=false;setLoading(false);setBusy(false);}
 }
 return <div className="agreement-control">{state?<AgreementButton state={state} locked={busy||loading||!!pending&&!ownPending} pending={!!ownPending} act={()=>void act()}/>:<span className="muted">正在读取赞同…</span>}{error&&<div role="alert"><span>{error}</span><button className="text-button" disabled={loading} onClick={()=>void read()}>重新读取赞同</button></div>}</div>;
}
