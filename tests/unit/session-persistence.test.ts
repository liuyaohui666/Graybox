import {afterEach,test,expect,vi} from 'vitest';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
function setup(){const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});vi.stubGlobal('window',{location:{origin:'https://graybox.example'},dispatchEvent:vi.fn()});return values;}
test('browser restart restores login without storing password; logout clears it',async()=>{
 const values=setup(),profile={id:'human',name:'Member',role:'member'};
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(JSON.stringify({data:path==='/v1/auth/login'?{token:'fixture-session',profile,expires_at:new Date(Date.now()+60000).toISOString()}:{}}),{headers:{'content-type':'application/json'}})));
 const first=await import('../../apps/desktop/src/platform.ts');await first.authenticate('login',{username:'user',password:'fixture-password'});
 expect([...values.values()].join()).not.toContain('fixture-password');
 vi.resetModules();const restarted=await import('../../apps/desktop/src/platform.ts');expect((await restarted.connection()).profile).toEqual(profile);
 await restarted.logout();expect(values.size).toBe(0);
});
test.each(['expired','origin','revoked'])('saved %s session is cleared',async(reason)=>{
 const values=setup();values.set('graybox-session-v1',JSON.stringify({endpoint:reason==='origin'?'https://other.example':'https://graybox.example',token:'fixture',profile:{id:'human'},expires_at:new Date(Date.now()+(reason==='expired'?-1000:60000)).toISOString()}));
 const api=await import('../../apps/desktop/src/platform.ts');const c=await api.connection();
 if(reason==='revoked'){expect(c.profile?.id).toBe('human');vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({error:{code:'UNAUTHORIZED',message:'Revoked'}}),{headers:{'content-type':'application/json'}}));await expect(api.request('human','/v1/me')).rejects.toMatchObject({code:'UNAUTHORIZED'});}else expect(c.profile).toBeUndefined();
 expect(values.size).toBe(0);
});
