import { invoke, isTauri } from "@tauri-apps/api/core";
export interface Profile { id: string; name: string; role: string }
export interface Connection { mode: "local" | "cloud"; endpoint: string; profile?: Profile }
let bearer: string | undefined;
let sessionRevision = 0;
let current: Connection | undefined;
export class ApiError extends Error {
  constructor(public code: string, message: string) { super(`${code} · ${message}`); }
}
export async function connection(): Promise<Connection> {
  if (isTauri()) return current = await invoke<Connection>("connection_info");
  return current = { mode: import.meta.env.VITE_GRAYBOX_MODE === "local" ? "local" : "cloud", endpoint: window.location.origin, profile: current?.profile };
}
export async function configure(endpoint: string): Promise<void> {
  if (!isTauri()) throw new Error("浏览器使用当前站点的云端服务。");
  current = await invoke("configure_endpoint", { endpoint }); sessionRevision++;
}
export async function authenticate(kind: "login" | "redeem", body: unknown): Promise<Profile> {
  if (isTauri()) {
    const result = await invoke<{profile: Profile}>("authenticate", { kind, body });
    current = { ...(await connection()), profile: result.profile };
    sessionRevision++; return result.profile;
  }
  const result = await request<{token: string; profile: Profile}>("", `/v1/auth/${kind}`, "POST", body);
  bearer = result.token;
  current = { ...(await connection()), profile: result.profile };
  sessionRevision++; return result.profile;
}
export async function logout(): Promise<void> {
  const revision = sessionRevision;
  try { await request("", "/v1/auth/logout", "POST", {}); } catch(e) { if (!(e instanceof ApiError && e.code === "UNAUTHORIZED")) throw e; }
  if (revision === sessionRevision) { bearer = undefined; if (current) current.profile = undefined; sessionRevision++; }
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
  const requestBearer = bearer;
  const revision = sessionRevision;
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
      window.dispatchEvent?.(new Event("graybox-session-ended"));
    }
    throw new ApiError(result.error.code, result.error.message);
  }
  return result.data as T;
}



