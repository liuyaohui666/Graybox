import { invoke, isTauri } from "@tauri-apps/api/core";
import { writeSafety } from "./write-safety.ts";
export interface Profile { id: string; name: string; role: string }
export const sessionGeneration=()=>sessionRevision;
export interface Connection { mode: "local" | "cloud"; endpoint: string; profile?: Profile }
let bearer: string | undefined;
let sessionRevision = 0;
let current: Connection | undefined;
const savedSessionKey='graybox-session-v1';
function forgetBrowserSession(){try{localStorage.removeItem(savedSessionKey);}catch{}}
function restoreBrowserSession(endpoint:string){if(bearer)return;try{const saved=JSON.parse(localStorage.getItem(savedSessionKey)??'null');if(saved?.endpoint===endpoint&&typeof saved.token==='string'&&typeof saved.profile?.id==='string'&&Date.parse(saved.expires_at)>Date.now()){bearer=saved.token;current={mode:'cloud',endpoint,profile:saved.profile};}else forgetBrowserSession();}catch{forgetBrowserSession();}}
export class ApiError extends Error {
  constructor(public code: string, message: string) { super(`${code} · ${message}`); }
}
function browserOrigin(mode: "local" | "cloud") {
  const url = new URL(window.location.origin);
  const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
  const testLoopback = import.meta.env.VITE_GRAYBOX_ALLOW_LOOPBACK_TEST === "1" && url.protocol === "http:" && loopback;
  if (mode === "cloud" && url.protocol !== "https:" && !testLoopback) throw new Error("云端登录必须通过 HTTPS 访问。");
  if (mode === "local" && url.protocol === "http:" && !["127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("本地 HTTP 模式仅允许数字回环地址。");
  return url.origin;
}
export async function connection(): Promise<Connection> {
  if (isTauri()) return current = await invoke<Connection>("connection_info");
  const mode = import.meta.env.VITE_GRAYBOX_MODE === "local" ? "local" : "cloud";
  if(mode==='cloud')restoreBrowserSession(browserOrigin(mode));
  return current = { mode, endpoint: browserOrigin(mode), profile: current?.profile };
}
export async function configure(endpoint: string): Promise<void> {
  if (!isTauri()) throw new Error("浏览器使用当前站点的云端服务。");
  current = await invoke("configure_endpoint", { endpoint }); sessionRevision++;
}
export async function authenticate(kind: "login" | "redeem", body: unknown): Promise<Profile> {
  const revision = sessionRevision;
  if (isTauri()) {
    const result = await invoke<{profile: Profile}>("authenticate", { kind, body });
    if (sessionRevision !== revision) throw new Error("会话已变更，请重新登录。");
    const c = await connection();
    if (sessionRevision !== revision) throw new Error("会话已变更，请重新登录。");
    current = { ...c, profile: result.profile };
    sessionRevision++; return result.profile;
  }
  const c = await connection();
  const result = await request<{token: string; profile: Profile;expires_at:string}>("", `/v1/auth/${kind}`, "POST", body);
  if (sessionRevision !== revision) throw new Error("会话已变更，请重新登录。");
  bearer = result.token;
  current = { ...c, profile: result.profile };
  try{localStorage.setItem(savedSessionKey,JSON.stringify({endpoint:c.endpoint,token:result.token,profile:result.profile,expires_at:result.expires_at}));}catch{throw new Error('登录成功，但无法保存登录状态，请检查浏览器存储权限。');}
  sessionRevision++; return result.profile;
}
export async function logout(): Promise<void> {
  if (writeSafety.snapshot()) throw new Error("写入仍在进行或结果未确认，请先完成恢复处理再退出登录。");
  const revision = sessionRevision;
  try { await request("", "/v1/auth/logout", "POST", {}); } catch(e) { if (!(e instanceof ApiError && e.code === "UNAUTHORIZED")) throw e; }
  if (revision === sessionRevision) { bearer = undefined; forgetBrowserSession(); if (current) current.profile = undefined; sessionRevision++; }
}
export async function profiles(): Promise<Profile[]> {
  const c = await connection();
  if (c.mode === "cloud") return c.profile ? [c.profile] : [];
  if (isTauri()) return invoke("local_profiles");
  const response = await fetch("/__graybox/profiles", { redirect: "error" });
  if (!response.ok) throw new Error("本地服务尚未就绪，请运行启动脚本。");
  return response.json();
}
export async function request<T>(profileId: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const c = current ?? await connection();
  if (!isTauri()) browserOrigin(c.mode);
  const requestBearer = bearer;
  const revision = sessionRevision;
  const write = method === "POST" && (path === "/v1/commands" || path === "/v1/profile/name" || path === "/v1/notifications/read" || path === "/v1/collaboration/notifications/read" || /^\/v1\/projects\/[^/]+\/agreement$/.test(path) || /^\/v1\/batches\/[^/]+\/undo$/.test(path)) ? writeSafety.begin(profileId,path,body,revision) : null;
  try {
  let result: { data?: T; error?: {code: string; message: string} };
  if (isTauri()) result = await invoke("api_request", { profileId, path, method, body: body ?? null });
  else {
    const local = c.mode === "local";
    const response = await fetch(local ? "/__graybox/request" : path, {
      method: local ? "POST" : method,
      redirect: "error",
      credentials: "omit",
      headers: { "Content-Type": "application/json", ...(!local && bearer ? {Authorization: `Bearer ${bearer}`} : {}) },
      body: local ? JSON.stringify({profileId, path, method, body}) : method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("服务端未返回 API 数据，请检查服务地址。");
    result = await response.json();
  }
  if (result.error) {
    if (result.error.code === "UNAUTHORIZED" && c.mode === "cloud" && requestBearer === bearer && revision === sessionRevision) {
      bearer = undefined; if (current) current.profile = undefined;
      forgetBrowserSession();
      sessionRevision++;
      window.dispatchEvent?.(new Event("graybox-session-ended"));
    }
    throw new ApiError(result.error.code, result.error.message);
  }
  if (!Object.prototype.hasOwnProperty.call(result,"data")) throw new Error("API 未返回结果，操作状态未确认。");
  if (write) writeSafety.finish(write,true);
  return result.data as T;
  } catch (e) {
    if (write) writeSafety.finish(write,false,e instanceof ApiError && ["VALIDATION","REVISION_CONFLICT","FORBIDDEN","UNAUTHORIZED","NOT_FOUND","INVALID_TRANSITION","BATCH_CLOSED","IDEMPOTENCY_MISMATCH"].includes(e.code));
    throw e;
  }
}

function bytes64(bytes:Uint8Array){let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);}
export async function attachmentTransfer(profileId:string,path:string,bytes?:Uint8Array,metadata?:unknown):Promise<unknown> {
 const c=current??await connection(),revision=sessionRevision,requestBearer=bearer;
 const fail=(code:string,message:string)=>{if(code==='UNAUTHORIZED'&&c.mode==='cloud'&&requestBearer===bearer&&revision===sessionRevision){bearer=undefined;if(current)current.profile=undefined;forgetBrowserSession();sessionRevision++;window.dispatchEvent?.(new Event('graybox-session-ended'));}throw new ApiError(code,message);};
 if(!/^\/v1\/attachments\/(upload|[a-f0-9-]{36}\/content)$/.test(path))throw new Error('附件路径不正确。');
 if(isTauri()) {
  const result=await invoke<{data?:unknown;error?:{code:string;message:string}}>('attachment_transfer',{profileId,path,metadata:metadata??null,dataBase64:bytes?bytes64(bytes):null});
  if(revision!==sessionRevision)throw new Error('会话已变更，请重新读取附件。');
  if(result.error)fail(result.error.code,result.error.message);
  return result.data;
 }
 if(c.mode!=='cloud')throw new Error('附件预览请使用云端网页或桌面客户端。');
 const metadata64=metadata?bytes64(new TextEncoder().encode(JSON.stringify(metadata))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):'';
 const response=await fetch(path,{method:bytes?'POST':'GET',credentials:'omit',redirect:'error',headers:{...(bearer?{Authorization:`Bearer ${bearer}`} : {}),...(bytes?{'Content-Type':'application/octet-stream','x-graybox-metadata':metadata64}:{})},...(bytes?{body:bytes as BodyInit}:{}),signal:AbortSignal.timeout(90000)});
 if(revision!==sessionRevision)throw new Error('会话已变更，请重新读取附件。');
 if(!response.ok){let message='附件传输失败，请重试原操作。',code='UPLOAD_FAILED';try{const error=(await response.json()).error;message=error?.message??message;code=error?.code??code;}catch{}fail(code,message);}
 if(bytes)return (await response.json()).data;
 return {base64:bytes64(new Uint8Array(await response.arrayBuffer())),mime_type:response.headers.get('content-type')??'application/octet-stream'};
}






