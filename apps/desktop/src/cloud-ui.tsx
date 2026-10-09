import React, { useEffect, useState, useSyncExternalStore, createContext } from "react";
import { connection, configure, authenticate, logout, request, type Connection } from "./platform.ts";
import { writeSafety, type PendingWrite } from "./write-safety.ts";
import {Avatar} from "./avatars.tsx";
import { commandRetry } from "./retry.ts";
import {AccountActionsContext} from './account-actions.tsx';
export const ConnectionModeContext = createContext<"local" | "cloud">("cloud");
export function SessionContent({mode,pendingWrite,children}: {mode: "local" | "cloud"; pendingWrite: PendingWrite | null; children: React.ReactNode}) {
  return <ConnectionModeContext.Provider value={mode}>{pendingWrite && <section className="session"><p role="alert">{pendingWrite.busy ? "写入正在进行，暂不能退出登录。" : `上次 ${pendingWrite.operation} 结果未确认，请在当前会话使用原操作重试。重新登录后请先核对最新记录，避免重复写入。`}</p>{!pendingWrite.busy && <button onClick={() => { if (window.confirm("请确认已核对最新记录。解除标记后再次提交将视为新操作，可能产生重复记录。")) { writeSafety.acknowledge(); commandRetry.clear(); } }}>已核对记录，解除未确认标记</button>}</section>}{children}</ConnectionModeContext.Provider>;
}
export function SessionGate({children}: {children: React.ReactNode}) {
  const pendingWrite = useSyncExternalStore(writeSafety.subscribe, writeSafety.snapshot);
  const [state, setState] = useState<Connection>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [redeem, setRedeem] = useState(false);
  const [manage, setManage] = useState(false);
  useEffect(() => { void connection().then(setState).catch(e => { setError(e.message); setState({mode:"cloud",endpoint:""}); }); }, []);
  useEffect(() => { const ended = () => { setState(s => s ? {...s,profile:undefined} : s); setManage(false); setError("会话已过期或已撤销，请重新登录。"); }; window.addEventListener("graybox-session-ended", ended); return () => window.removeEventListener("graybox-session-ended", ended); }, []);
  useEffect(()=>{const update=(event:Event)=>{const person=(event as CustomEvent<{id:string;name:string}>).detail;setState(s=>s?.profile?.id===person.id?{...s,profile:{...s.profile,name:person.name}}:s);};window.addEventListener("graybox-profile-updated",update);return()=>window.removeEventListener("graybox-profile-updated",update);},[]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const f = new FormData(e.currentTarget);
    try {
      if (f.has("endpoint")) await configure(String(f.get("endpoint")));
      const profile = await authenticate(redeem ? "redeem" : "login", Object.fromEntries(Array.from(f.entries()).filter(([k]) => k !== "endpoint")));
      setState({...await connection(), profile});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!state || (state.mode === "cloud" && !state.profile)) return <main className="session"><h1>登录 Graybox</h1>{pendingWrite && <p role="alert">上次 {pendingWrite.operation} 结果未确认。重新登录会产生新凭据，不能沿用原凭据的重试保证。登录后先核对最新记录，避免重复写入。</p>}<p>使用团队账号。邀请或初始化码只能使用一次。</p><form onSubmit={submit}>
    {state?.endpoint !== window.location.origin && <label>云端 HTTPS 地址<input name="endpoint" type="url" defaultValue={state?.endpoint} required placeholder="https://graybox.example.com" /></label>}
    {redeem && <><label>邀请 / 初始化码<input name="code" required autoComplete="off" /></label><label>显示名称<input name="name" required maxLength={100} /></label></>}
    <label>用户名<input name="username" required pattern="[A-Za-z0-9._-]{3,40}" autoComplete="username" /></label>
    <label>密码<input name="password" type="password" required minLength={redeem ? 15 : undefined} maxLength={128} autoComplete={redeem ? "new-password" : "current-password"} /></label>
    <button disabled={busy || !state}>{busy ? "连接中…" : redeem ? "激活账号" : "登录"}</button><button type="button" onClick={() => setRedeem(!redeem)}>{redeem ? "已有账号" : "使用邀请 / 初始化码"}</button>
  </form>{error && <p role="alert">{error}</p>}</main>;
  if (state.mode === "local") return <SessionContent mode="local" pendingWrite={pendingWrite}>{children}</SessionContent>;
  return <SessionContent mode="cloud" pendingWrite={pendingWrite}><AccountActionsContext.Provider value={{busy:busy||!!pendingWrite,error,manage:()=>setManage(true),logout:()=>{if(busy||pendingWrite)return;setBusy(true);void logout().then(()=>{setState({...state,profile:undefined});setManage(false);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}}>{children}{manage&&<ManagementDialog owner={state.profile?.role==='owner'} close={()=>setManage(false)}/>}</AccountActionsContext.Provider></SessionContent>;
}
function ManagementDialog({owner,close}:{owner:boolean;close:()=>void}) {
 const dialog=React.useRef<HTMLDialogElement>(null);
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 return <dialog ref={dialog} className="collaboration-account-dialog" aria-labelledby="team-dialog-title" onCancel={close}><header><h2 id="team-dialog-title">团队管理</h2><button aria-label="关闭团队管理" onClick={close}>关闭</button></header><Management owner={owner}/></dialog>;
}
interface Member {id:string; name:string; role:string; disabled_at: string|null;avatar_data?:string|null}
interface Agent {id:string; name:string; revoked_at:string|null; expires_at:string}
function Management({owner}: {owner:boolean}) {
  const [members,setMembers]=useState<Member[]>([]), [agents,setAgents]=useState<Agent[]>([]), [message,setMessage]=useState(""), [busy,setBusy]=useState(false);
  async function refresh() { const [m,a]=await Promise.all([request<Member[]>("","/v1/members"),request<Agent[]>("","/v1/agents")]); setMembers(m);setAgents(a); }
  useEffect(() => {void refresh().catch(e=>setMessage(e.message));},[]);
  async function action(path:string, body:unknown={}) {setBusy(true);setMessage("");try { const result=await request<{code?:string;expires_at?:string}>("",path,"POST",body); if(result.code) setMessage(`邀请码：${result.code}（有效至 ${result.expires_at}，请安全转交）`); else setMessage("操作已完成。"); await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <section className="session management"><h2>团队成员</h2>{members.map(m=><p key={m.id}><Avatar person={m}/>{m.name}{m.role === "owner" && " · 团队管理"} {m.disabled_at ? "已停用" : owner && m.role!=="owner" && <button disabled={busy} onClick={()=>void action(`/v1/members/${m.id}/disable`)}>停用成员</button>}</p>)}{owner && <button disabled={busy} onClick={()=>void action("/v1/members/invite")}>生成成员邀请码</button>}<h2>Codex 配对</h2><p>输入命令行显示的配对码，授权 Codex 访问你的项目。当前授权全部项目；批准后返回命令行完成领取。</p><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void action("/v1/agents/pair/approve",{user_code:String(f.get("user_code")).trim(),project_ids:null});}}><input name="user_code" aria-label="Agent 配对码" required autoComplete="off"/><button disabled={busy}>批准配对</button></form>{agents.map(a=><p key={a.id}>{a.name} · {a.revoked_at ? "已撤销" : `有效至 ${a.expires_at}`} {!a.revoked_at && <button disabled={busy} onClick={()=>void action(`/v1/agents/${a.id}/revoke`)}>撤销授权</button>}</p>)}{message && <p role="status">{message}</p>}</section>;
}
