import {test,expect} from 'vitest';
import {validateFile,safeAttachmentUrl,parseAttachmentMetadata} from '../../packages/core/src/attachments.ts';
import {png} from '../fixtures/avatar.ts';
import {buildApp} from '../../apps/api/src/app.ts';
import {Pool} from 'pg';
test('accepts actual raster bytes but rejects renamed executables, SVG and kind mismatch',()=>{
 const bytes=Buffer.from(png(128).split(',')[1]!,'base64');
 expect(validateFile('image',bytes)).toBe('image/png');
 for(const [kind,body] of [['image',Buffer.from('<svg/>')],['image',Buffer.from('MZ')],['video',bytes]] as const)expect(()=>validateFile(kind,body)).toThrow();
});
test('API starts before the additive migration and rejects unauthenticated bytes before buffering',async()=>{
 const pool=new Pool({connectionString:'postgres://unused:unused@127.0.0.1:1/never_connect'}),app=await buildApp({pool,mode:'local'});
 try{await app.ready();const response=await app.inject({method:'POST',url:'/v1/attachments/upload',headers:{'content-type':'application/octet-stream'},payload:Buffer.alloc(300000)});expect(response.statusCode).toBe(401);expect(response.json().error.code).toBe('UNAUTHORIZED');}finally{await app.close();await pool.end();}
});
test('bounded HTML requires recognizable self-contained document',()=>{
 expect(validateFile('demo',Buffer.from('<!doctype html><html><button>click</button></html>'))).toBe('text/html');
 expect(()=>validateFile('demo',Buffer.from('MZ executable'))).toThrow();
 expect(()=>validateFile('demo',Buffer.alloc(5*1024*1024+1))).toThrow();
});
test('links require HTTPS without credentials or local addresses',()=>{
 expect(safeAttachmentUrl('https://github.com/example/repo')).toBe('https://github.com/example/repo');
 for(const url of ['http://github.com/x','javascript:alert(1)','https://u:p@github.com/x','https://localhost/x','https://127.0.0.1/x'])expect(()=>safeAttachmentUrl(url)).toThrow();
});
test('metadata refuses path separators, unknown fields and malformed hashes',()=>{
 const good={idempotency_key:crypto.randomUUID(),entity_type:'project',entity_id:crypto.randomUUID(),kind:'image',name:'a.png',caption:'',sha256:'a'.repeat(64)};
 expect(parseAttachmentMetadata(good).name).toBe('a.png');
 for(const bad of [{...good,name:'../a.png'},{...good,name:'a\\b'},{...good,sha256:'xx'},{...good,extra:1}])expect(()=>parseAttachmentMetadata(bad)).toThrow();
});
