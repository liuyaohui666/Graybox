import {test,expect} from 'vitest';
import {config} from 'dotenv';
import {Pool} from 'pg';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {migrate} from '../../packages/db/src/migrate.ts';
import {seedDatabase} from '../../packages/db/src/seed.ts';
config({quiet:true});

test('production API survives lost idle database connection and saves a nickname after reconnecting',async()=>{
 const url=new URL(process.env.GRAYBOX_TEST_DATABASE_URL!),adminUrl=new URL(process.env.GRAYBOX_TEST_ADMIN_URL!);
 if(url.pathname!=='/graybox_test'||adminUrl.pathname!=='/graybox_test')throw Error('Isolated test DB required');
 const admin=new Pool({connectionString:adminUrl.href});
 const name='graybox-recovery-'+randomUUID();url.searchParams.set('application_name',name);
 const portServer=createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=(portServer.address() as {port:number}).port;await new Promise<void>(resolve=>portServer.close(()=>resolve()));
 let child:ReturnType<typeof spawn>|undefined;
 try {
  await admin.query('DROP SCHEMA IF EXISTS graybox CASCADE');await migrate(admin);const fixture=await seedDatabase(admin);
  child=spawn(process.execPath,['--import','tsx','apps/api/src/main.ts'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,GRAYBOX_MODE:'local',GRAYBOX_PORT:String(port),GRAYBOX_DATABASE_URL:url.href},stdio:['ignore','pipe','pipe']});
  let observedPoolError=false;child.stdout?.resume();child.stderr?.on('data',chunk=>{if(String(chunk).includes('database_connection_lost'))observedPoolError=true;});
  const base=`http://127.0.0.1:${port}`;
  let healthy=false;for(let i=0;i<60;i++){try{healthy=(await fetch(base+'/v1/health')).ok;}catch{}if(healthy)break;if(child.exitCode!==null)break;await delay(50);}
  expect(healthy).toBe(true);
  const idle=(await admin.query("SELECT pid FROM pg_stat_activity WHERE datname='graybox_test' AND application_name=$1 AND state='idle'",[name])).rows;
  expect(idle).toHaveLength(1);
  await admin.query('SELECT pg_terminate_backend($1)',[idle[0].pid]);
  for(let i=0;i<40&&!observedPoolError&&child.exitCode===null;i++)await delay(25);
  expect(child.exitCode,'API must survive a disconnected idle database client').toBeNull();
  expect(observedPoolError).toBe(true);
  expect((await fetch(base+'/v1/health')).status).toBe(200);
  const saved=await fetch(base+'/v1/profile/name',{method:'POST',headers:{authorization:'Bearer '+fixture.humans[0]!.token,'content-type':'application/json'},body:JSON.stringify({name:'连接恢复验证'})});
  expect(saved.status).toBe(200);expect((await saved.json()).data.name).toBe('连接恢复验证');
 }finally{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}await admin.end();}
},15000);
