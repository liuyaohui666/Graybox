import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
beforeEach(() => { vi.resetModules(); vi.stubGlobal("window", {location:{origin:"https://graybox.example.com"}}); vi.stubEnv("VITE_GRAYBOX_MODE", "cloud"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("cloud sessions use same-origin API, hold bearer only in memory, and clear it on logout", async () => {
 const calls: Array<[string, RequestInit]> = [];
 vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
  calls.push([url,init]);
  return {headers:new Headers({"content-type":"application/json"}),json:async()=>({data: url.endsWith("login") ? {token:"test-secret",profile:{id:"human",name:"User",role:"member"}} : {ok:true}})};
 }));
 const p=await import("./platform.ts");
 await p.authenticate("login",{username:"user",password:"not-a-real-password"});
 expect((await p.profiles())[0].id).toBe("human");
 await p.request("human","/v1/projects");
 expect(calls[1][0]).toBe("/v1/projects");
 expect(calls[1][1].headers).toMatchObject({Authorization:"Bearer test-secret"});
 expect(calls[1][1].redirect).toBe("error");
 await p.logout(); expect(await p.profiles()).toEqual([]);
 await p.request("","/v1/health"); expect(calls.at(-1)?.[1].headers).not.toHaveProperty("Authorization");
});
it("cloud connection failures never fall back to local profile credentials", async () => {
 const fetch=vi.fn(async(_url: string, _init: RequestInit)=>{throw new Error("offline");}); vi.stubGlobal("fetch",fetch);
 const p=await import("./platform.ts"); expect(await p.profiles()).toEqual([]);
 await expect(p.request("","/v1/projects")).rejects.toThrow("offline");
 expect(fetch.mock.calls[0]?.[0]).toBe("/v1/projects");
});

it("expired credentials clear the session so login can recover", async()=>{
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>({headers:new Headers({"content-type":"application/json"}),json:async()=>url.endsWith("login") ? {data:{token:"test-secret",profile:{id:"human",name:"User",role:"member"}}} : {error:{code:"UNAUTHORIZED",message:"expired"}}})));
 const p=await import("./platform.ts");await p.authenticate("login",{});await expect(p.request("human","/v1/projects")).rejects.toThrow("expired");expect(await p.profiles()).toEqual([]);
});
it("a delayed rejection from an older session cannot clear a newer login",async()=>{
 let rejectOld: ((value: unknown)=>void)|undefined; let count=0;
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
  if(url.endsWith("projects")) return new Promise(resolve=>{rejectOld=resolve;});
  count++;return {headers:new Headers({"content-type":"application/json"}),json:async()=>({data:{token:`token-${count}`,profile:{id:`human-${count}`,name:"User",role:"member"}}})};
 }));
 const p=await import("./platform.ts");await p.authenticate("login",{});const old=p.request("human-1","/v1/projects");await p.authenticate("login",{});
 rejectOld?.({headers:new Headers({"content-type":"application/json"}),json:async()=>({error:{code:"UNAUTHORIZED",message:"old session revoked"}})});
 await expect(old).rejects.toThrow("old session revoked");expect((await p.profiles())[0].id).toBe("human-2");
});
