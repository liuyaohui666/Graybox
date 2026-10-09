import {afterEach,expect,test,vi} from 'vitest';
import {ApiClient} from '../../packages/client/src/client.ts';
afterEach(()=>vi.unstubAllGlobals());
test('binary attachment sends exact bytes with private auth and rejects redirects',async()=>{
 const fetch=vi.fn(async(_url:string,_options:RequestInit)=>new Response('',{status:302}));vi.stubGlobal('fetch',fetch);
 const api=new ApiClient({endpoint:'http://127.0.0.1:4318',token:'private'});
 await expect(api.uploadAttachment({entity_type:'project',entity_id:'00000000-0000-4000-8000-000000000001',name:'x.png',caption:'',kind:'image',sha256:'a'.repeat(64),idempotency_key:'00000000-0000-4000-8000-000000000002'},Buffer.from([1,2]))).rejects.toMatchObject({code:'REDIRECT_REJECTED'});
 expect(fetch.mock.calls[0]?.[1]).toMatchObject({redirect:'manual',body:new Uint8Array([1,2])});expect(JSON.stringify(api)).not.toContain('private');
});
