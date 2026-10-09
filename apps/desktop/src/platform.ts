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






