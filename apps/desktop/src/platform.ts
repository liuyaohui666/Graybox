import { invoke, isTauri } from "@tauri-apps/api/core";
export interface Profile {
  id: string;
  name: string;
  role: string;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(`${code} · ${message}`);
  }
}
export async function profiles(): Promise<Profile[]> {
  if (isTauri()) return invoke("local_profiles");
  const response = await fetch("/__graybox/profiles");
  if (!response.ok) throw new Error("本地服务尚未就绪，请运行启动脚本。");
  return response.json();
}
export async function request<T>(
  profileId: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let result: { data?: T; error?: { code: string; message: string } };
  if (isTauri())
    result = await invoke("api_request", {
      profileId,
      path,
      method,
      body: body ?? null,
    });
  else {
    const response = await fetch("/__graybox/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, path, method, body }),
    });
    result = await response.json();
  }
  if (result.error) throw new ApiError(result.error.code, result.error.message);
  return result.data as T;
}
