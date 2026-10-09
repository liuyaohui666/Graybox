import pg from 'pg';
import dotenv from 'dotenv';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
dotenv.config({quiet:true});
const url=new URL(process.env.GRAYBOX_TEST_ADMIN_URL ?? '');
if (!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='55439'||url.pathname!=='/graybox_test') throw Error('Exact local test admin required');
const admin=new pg.Client({connectionString:url.toString()}); await admin.connect();
const found=await admin.query("SELECT 1 FROM pg_database WHERE datname='graybox_upgrade_check'");
if (!found.rowCount) await admin.query('CREATE DATABASE graybox_upgrade_check');
await admin.end(); url.pathname='/graybox_upgrade_check';
const client=new pg.Client({connectionString:url.toString()}); await client.connect();
const folder=mkdtempSync(join(tmpdir(),'graybox-guard-'));
try {
 const schema=await client.query("SELECT 1 FROM pg_namespace WHERE nspname='graybox'");
 if(schema.rowCount) {
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='graybox' ORDER BY tablename")).rows;
  if(JSON.stringify(tables)!==JSON.stringify([{tablename:'guard_fixture'}])) throw Error('Unexpected isolated schema; refusing changes');
 } else await client.query("CREATE SCHEMA graybox; CREATE TABLE graybox.guard_fixture (code_hash text PRIMARY KEY, data jsonb); INSERT INTO graybox.guard_fixture VALUES ('a', '{\"metadata\":{\"value\":1},\"array\":[1,2]}'),('b','{\"name\":\"original\"}'); GRANT USAGE ON SCHEMA graybox TO graybox_admin; GRANT SELECT, UPDATE, DELETE ON graybox.guard_fixture TO graybox_admin;");
 const baseline=(await client.query('SELECT * FROM graybox.guard_fixture ORDER BY code_hash')).rows;
 for(const [name,sql] of [['nested-change',"UPDATE graybox.guard_fixture SET data=jsonb_set(data,'{metadata,value}','2') WHERE code_hash='a';"], ['array-change',"UPDATE graybox.guard_fixture SET data=jsonb_set(data,'{array}','[2,1]') WHERE code_hash='a';"], ['delete',"DELETE FROM graybox.guard_fixture WHERE code_hash='b';"]]) {
  const file=join(folder,'001_fixture.sql'); writeFileSync(file,sql);
  const transaction=execFileSync('python',['-c',"import importlib.util,pathlib,sys; s=importlib.util.spec_from_file_location('upgrade','ops/cloud/upgrade.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.migration_transaction([pathlib.Path(sys.argv[1])]))",file],{encoding:'utf8'});
  let rejected=false; try {await client.query(transaction);} catch(e) { rejected=e.message==='Existing data preservation failed'; await client.query('ROLLBACK'); }
  if(!rejected || JSON.stringify((await client.query('SELECT * FROM graybox.guard_fixture ORDER BY code_hash')).rows)!==JSON.stringify(baseline)) throw Error('Guard rollback assertion failed');
  console.log(name+': rejected; original rows unchanged');
 }
 const file=join(folder,'001_fixture.sql'); writeFileSync(file,"UPDATE graybox.guard_fixture SET data=data || '{\"new\":true}';");
 const transaction=execFileSync('python',['-c',"import importlib.util,pathlib,sys; s=importlib.util.spec_from_file_location('upgrade','ops/cloud/upgrade.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.migration_transaction([pathlib.Path(sys.argv[1])]))",file],{encoding:'utf8'});
 await client.query(transaction); console.log('additive: committed');
} finally {await client.end(); rmSync(folder,{recursive:true,force:true});}
