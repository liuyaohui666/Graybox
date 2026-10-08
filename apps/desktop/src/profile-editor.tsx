import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {request,sessionGeneration,ApiError} from './platform.ts';
import {writeSafety} from './write-safety.ts';

export function ProfileEditor({profile,initialName,locked,setBusy,refresh,close}:{profile:string;initialName:string;locked:boolean;setBusy:(value:boolean)=>void;refresh:()=>Promise<void>;close:()=>void}) {
  const [name,setName]=useState(initialName),[error,setError]=useState(''),[saved,setSaved]=useState(false),[observed,setObserved]=useState<string|null>(null),[checking,setChecking]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),writing=useRef(false),mounted=useRef(false);
  const pending=useSyncExternalStore(writeSafety.subscribe,writeSafety.snapshot,()=>null);
  const retryable=pending?.path==='/v1/profile/name'&&pending.profile===profile&&!pending.busy;
  useEffect(()=>{mounted.current=true;dialog.current?.showModal();return()=>{mounted.current=false;dialog.current?.close();};},[]);
  async function checkSaved() {
    if(writing.current||!retryable)return;
    writing.current=true;setChecking(true);setError('');const generation=sessionGeneration();
    try {
      const people=await request<{id:string;name:string}[]>(profile,'/v1/people');
      if(!mounted.current||generation!==sessionGeneration())return;
      const own=people.find(person=>person.id===profile);if(!own)throw new Error('账号资料不可用。');
      setObserved(own.name);
    }catch{if(mounted.current&&generation===sessionGeneration())setError('无法读取已保存的昵称，请恢复连接后重试。');}
    finally{writing.current=false;setChecking(false);}
  }
  async function save(e:React.FormEvent) {
    e.preventDefault();if(writing.current||(locked&&!retryable))return;
    writing.current=true;setBusy(true);setError('');const generation=sessionGeneration();
    const current=()=>mounted.current&&generation===sessionGeneration();
    try {
      if(!saved){await request(profile,'/v1/profile/name','POST',{name:name.trim()});if(!current())return;setSaved(true);}
      try{await refresh();if(current())close();}catch{if(current())setError('昵称已保存，但页面刷新失败。请点击“重新读取”。');}
    }catch(e){if(current())setError(e instanceof ApiError?e.message:'保存结果尚未确认，请点击“重试保存”。');}
    finally{writing.current=false;setBusy(false);}
  }
  return <dialog ref={dialog} aria-label="个人资料" onCancel={e=>{if(locked)e.preventDefault();else close();}}>
    <form onSubmit={save}>
      <div className="modal-heading"><h2>个人资料</h2><button type="button" aria-label="关闭个人资料" disabled={locked} onClick={close}>×</button></div>
      <label>昵称<input autoFocus required maxLength={100} value={name} disabled={locked||saved} onChange={e=>setName(e.target.value)} autoComplete="nickname"/></label>
      <p className="muted profile-hint">团队成员会看到这个名字。登录用户名保持不变。</p>
      {error&&<p className="modal-error" role="alert">{error}</p>}
      {retryable&&<div className="profile-recovery"><button type="button" className="secondary" disabled={checking} onClick={()=>void checkSaved()}>核对已保存的昵称</button>{observed!==null&&<><p>当前读取到的昵称：{observed}</p><button type="button" className="text-button" disabled={checking} onClick={()=>{if(window.confirm('已核对当前昵称。停止重试不会撤销可能已保存的修改；之后可再次编辑昵称。确认结束本次重试？')){writeSafety.acknowledge();close();void refresh().catch(()=>{});}}}>已核对，结束本次重试</button></>}</div>}
      <div className="modal-actions"><button className="secondary" type="button" disabled={locked} onClick={close}>取消</button><button className="primary" disabled={checking||(locked&&!retryable)||!name.trim()}>{saved?'重新读取':retryable?'重试保存':'保存昵称'}</button></div>
    </form>
  </dialog>;
}
