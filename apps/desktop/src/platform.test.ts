import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
beforeEach(() => { const saved=new Map<string,string>();vi.stubGlobal("localStorage",{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value),removeItem:(key:string)=>saved.delete(key)});vi.resetModules(); vi.stubGlobal("window", {location:{origin:"https://graybox.example.com"}}); vi.stubEnv("VITE_GRAYBOX_MODE", "cloud"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("cloud sessions use same-origin API, persist login without storing passwords, and clear it on logout", async () => {
 const calls: Array<[string, RequestInit]> = [];
 vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
  calls.push([url,init]);
  return {headers:new Headers({"content-type":"application/json"}),json:async()=>({data: url.endsWith("login") ? {expires_at:new Date(Date.now()+60000).toISOString(),token:"test-secret",profile:{id:"human",name:"User",role:"member"}} : {ok:true}})};
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
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>({headers:new Headers({"content-type":"application/json"}),json:async()=>url.endsWith("login") ? {data:{expires_at:new Date(Date.now()+60000).toISOString(),token:"test-secret",profile:{id:"human",name:"User",role:"member"}}} : {error:{code:"UNAUTHORIZED",message:"expired"}}})));
 const p=await import("./platform.ts");await p.authenticate("login",{});await expect(p.request("human","/v1/projects")).rejects.toThrow("expired");expect(await p.profiles()).toEqual([]);
});
it("a delayed rejection from an older session cannot clear a newer login",async()=>{
 let rejectOld: ((value: unknown)=>void)|undefined; let count=0;
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
  if(url.endsWith("projects")) return new Promise(resolve=>{rejectOld=resolve;});
  count++;return {headers:new Headers({"content-type":"application/json"}),json:async()=>({data:{expires_at:new Date(Date.now()+60000).toISOString(),token:`token-${count}`,profile:{id:`human-${count}`,name:"User",role:"member"}}})};
 }));
 const p=await import("./platform.ts");await p.authenticate("login",{});const old=p.request("human-1","/v1/projects");await p.authenticate("login",{});
 rejectOld?.({headers:new Headers({"content-type":"application/json"}),json:async()=>({error:{code:"UNAUTHORIZED",message:"old session revoked"}})});
 await expect(old).rejects.toThrow("old session revoked");expect((await p.profiles())[0].id).toBe("human-2");
});
it("cloud HTTP authentication is rejected before credentials are sent",async()=>{
 vi.stubGlobal("window",{location:{origin:"http://graybox.example.com"}});const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 const p=await import("./platform.ts");await expect(p.authenticate("login",{})).rejects.toThrow("HTTPS");expect(fetch).not.toHaveBeenCalled();
});
it("explicit local mode permits numeric loopback HTTP only",async()=>{
 vi.stubEnv("VITE_GRAYBOX_MODE","local");vi.stubGlobal("window",{location:{origin:"http://localhost:4317"}});
 const p=await import("./platform.ts");await expect(p.connection()).rejects.toThrow("数字回环");
});
it("explicit loopback testing never permits non-loopback HTTP cloud transport",async()=>{
 vi.stubEnv("VITE_GRAYBOX_ALLOW_LOOPBACK_TEST","1");vi.stubGlobal("window",{location:{origin:"http://127.0.0.1:4329"}});const p=await import("./platform.ts");expect((await p.connection()).mode).toBe("cloud");vi.stubGlobal("window",{location:{origin:"http://graybox.example.com"}});await expect(p.connection()).rejects.toThrow("HTTPS");
});
it("logout and new credentials cannot discard or replay an uncertain write",async()=>{
 let networkFailure=false;
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
  if(networkFailure && url.endsWith("commands"))throw new Error("connection lost");
  return {headers:new Headers({"content-type":"application/json"}),json:async()=>({data: url.endsWith("login") ? {expires_at:new Date(Date.now()+60000).toISOString(),token:crypto.randomUUID(),profile:{id:"human",name:"User",role:"member"}} : {ok:true}})};
 }));
 const p=await import("./platform.ts");await p.authenticate("login",{});networkFailure=true;
 await expect(p.request("human","/v1/commands","POST",{idempotency_key:"key"})).rejects.toThrow("connection lost");
 await expect(p.logout()).rejects.toThrow("未确认");await p.authenticate("login",{});networkFailure=false;
 await expect(p.request("human","/v1/commands","POST",{idempotency_key:"key"})).rejects.toThrow("重新登录");
 const {writeSafety}=await import("./write-safety.ts");expect(writeSafety.snapshot()?.ambiguous).toBe(true);writeSafety.acknowledge();await p.logout();
});
it("a delayed successful login cannot overwrite a newer session",async()=>{
 let resolveOld: ((value: unknown)=>void)|undefined;let calls=0;
 const response=(id:string)=>({headers:new Headers({"content-type":"application/json"}),json:async()=>({data:{expires_at:new Date(Date.now()+60000).toISOString(),token:`token-${id}`,profile:{id,name:"User",role:"member"}}})});
 vi.stubGlobal("fetch",vi.fn(async()=>{calls++;if(calls===1)return new Promise(resolve=>{resolveOld=resolve;});return response("new");}));
 const p=await import("./platform.ts");const old=p.authenticate("login",{});await vi.waitFor(()=>expect(resolveOld).toBeDefined());await p.authenticate("login",{});resolveOld?.(response("old"));await expect(old).rejects.toThrow("会话已变更");expect((await p.profiles())[0].id).toBe("new");
});
it.each(['/v1/projects/idea/agreement','/v1/notifications/read'])('social write %s retains original body on unknown outcome and blocks navigation/logout/new targets',async path=>{
 let result:'offline'|'ok'|'forbidden'='offline';const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{calls.push(String(init.body));if(result==='offline')throw Error('connection lost');return {headers:new Headers({'content-type':'application/json'}),json:async()=>result==='ok'?{data:{ok:true}}:{error:{code:'FORBIDDEN',message:'denied'}}};}));
 const p=await import('./platform.ts'),{writeSafety}=await import('./write-safety.ts');
 const body=path.endsWith('agreement')?{agreed:true}:{ids:['visible']};
 await expect(p.request('a',path,'POST',body)).rejects.toThrow('connection lost');expect(writeSafety.snapshot()?.path).toBe(path);
 await expect(p.logout()).rejects.toThrow('未确认');
 await expect(p.request('b',path,'POST',body)).rejects.toThrow('未确认');expect(calls).toHaveLength(1);
 result='forbidden';await expect(p.request('a',path,'POST',body)).rejects.toThrow('denied');expect(writeSafety.snapshot()?.ambiguous).toBe(true);
 result='ok';await p.request('a',path,'POST',body);expect(writeSafety.snapshot()).toBeNull();expect(new Set(calls).size).toBe(1);
});
it('first definitive social rejection allows recovery while expired session increments its generation',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({headers:new Headers({'content-type':'application/json'}),json:async()=>({error:{code:'UNAUTHORIZED',message:'expired'}})})));
 const p=await import('./platform.ts'),{writeSafety}=await import('./write-safety.ts');const before=p.sessionGeneration();
 await expect(p.request('a','/v1/projects/idea/agreement','POST',{agreed:true})).rejects.toThrow('expired');expect(writeSafety.snapshot()).toBeNull();expect(p.sessionGeneration()).toBeGreaterThan(before);
});

it("nickname retry freezes its original payload and keeps logout blocked until confirmed",async()=>{
 let offline=true;
 vi.stubGlobal('fetch',vi.fn(async()=>{if(offline)throw new Error('offline');return {headers:new Headers({'content-type':'application/json'}),json:async()=>({data:{id:'a',name:'New name'}})};}));
 const p=await import('./platform.ts');const {writeSafety}=await import('./write-safety.ts');
 await expect(p.request('a','/v1/profile/name','POST',{name:'New name'})).rejects.toThrow('offline');
 expect(writeSafety.snapshot()?.operation).toBe('昵称修改');
 await expect(p.request('a','/v1/profile/name','POST',{name:'Different name'})).rejects.toThrow('结果尚未确认');
 await expect(p.logout()).rejects.toThrow('结果未确认');
 offline=false;await p.request('a','/v1/profile/name','POST',{name:'New name'});expect(writeSafety.snapshot()).toBeNull();
});
