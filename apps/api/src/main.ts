import { config } from 'dotenv';
import { Pool } from 'pg';
import { buildApp,parseServerPort } from './app.ts';
config({quiet:true});
const mode=process.env.GRAYBOX_MODE;
if(mode!=='local'&&mode!=='cloud')throw new Error('GRAYBOX_MODE must be local or cloud');
if(!process.env.GRAYBOX_DATABASE_URL) throw new Error('Database URL required');
if(mode==='cloud'&&!process.env.GRAYBOX_AUTH_DATABASE_URL)throw new Error('Separate auth database role URL required');
const port=parseServerPort(process.env.GRAYBOX_PORT);
const pool=new Pool({connectionString:process.env.GRAYBOX_DATABASE_URL,max:mode==='cloud'?3:4,connectionTimeoutMillis:5000});
const authPool=mode==='cloud'?new Pool({connectionString:process.env.GRAYBOX_AUTH_DATABASE_URL,max:1,connectionTimeoutMillis:5000}):undefined;
for(const [name,database] of [['domain',pool],['auth',authPool]] as const) {
  // pg-pool already removes failed idle clients. Handle its event so a database
  // restart does not terminate the API; later queries acquire fresh connections.
  database?.on('error',error=>{
    const raw=(error as Error&{code?:unknown}).code;
    const code=typeof raw==='string'&&/^[A-Z0-9_]{1,32}$/.test(raw)?raw:'UNKNOWN';
    // Never log the error/client object: pg attaches connection credentials to it.
    console.warn(JSON.stringify({event:'database_connection_lost',pool:name,code}));
  });
}
const app=await buildApp({pool,authPool,mode});
await app.listen({host:'127.0.0.1',port});
console.log(`Graybox ${mode} API listening on loopback port ${port}`);
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>void app.close().then(async()=>{await pool.end();await authPool?.end();}));
