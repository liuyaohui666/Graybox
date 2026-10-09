import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
export async function migrate(pool:Pool) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(77321)');
    for (const file of ['001_m1.sql', '002_cloud_auth.sql','003_project_library.sql','004_personal_avatars.sql','005_team_social.sql','006_profile_name.sql','007_collaboration.sql','008_attachments.sql'])
      await client.query(await readFile(new URL(`../../../db/migrations/${file}`,import.meta.url),'utf8'));
    await client.query('COMMIT');
  }
  catch(e) { await client.query('ROLLBACK'); throw e; } finally {client.release();}
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  config({quiet:true}); if(!process.env.GRAYBOX_MIGRATION_DATABASE_URL) throw new Error('Migration URL required');
  const pool=new Pool({connectionString:process.env.GRAYBOX_MIGRATION_DATABASE_URL});
  try {await migrate(pool); console.log('Graybox schema migration completed');} finally {await pool.end();}
}
