import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openLocalDatabase, withoutPriority } from '../../../packages/local-db/src/index.ts';

const root = process.env.GRAYBOX_DATA_ROOT || 'D:/Graybox';
const app = Fastify({ logger: false });
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
async function applyPendingImport() {
  const pending=join(root,'.pending-import');
  try { await readdir(pending); } catch { return; }
  const backup=join(root,'backups',`before-import-${Date.now()}`);
  await mkdir(backup,{recursive:true});
  for (const entry of await readdir(root,{withFileTypes:true})) {
    if (entry.name==='backups'||entry.name==='.pending-import'||entry.name.startsWith('.import-')||entry.name==='README.txt') continue;
    await cp(join(root,entry.name),join(backup,entry.name),{recursive:true,force:true});
  }
  for (const entry of await readdir(pending,{withFileTypes:true})) await cp(join(pending,entry.name),join(root,entry.name),{recursive:true,force:true});
  await rm(pending,{recursive:true,force:true});
}
await applyPendingImport();
const db = await openLocalDatabase(root);
const profileFile = join(root, 'profile.json');
const now = () => new Date().toISOString();
const wrap = (data: unknown) => ({ data });

function removeLegacyPriorities() {
  for (const table of ['projects', 'ideas', 'experiments']) {
    const rows = db.prepare(`SELECT id,data FROM ${table}`).all() as any[];
    for (const row of rows) {
      const original = json(row);
      const cleaned = withoutPriority(original);
      if (JSON.stringify(original) !== JSON.stringify(cleaned)) db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(cleaned), row.id);
    }
  }
}
removeLegacyPriorities();

type StoredProfile = { name: string; avatar_data: string | null };
async function profile(): Promise<StoredProfile> {
  try {
    return { name: '本地用户', avatar_data: null, ...JSON.parse(await readFile(profileFile, 'utf8')) };
  } catch { return { name: '本地用户', avatar_data: null }; }
}
async function saveProfile(next: StoredProfile) { await writeFile(profileFile, JSON.stringify(next, null, 2), 'utf8'); }
function json(row: any) { try { return JSON.parse(row.data); } catch { return {}; } }
function project(row: any) {
  const data = withoutPriority(json(row));
  return { ...data, id: row.id, name: row.name, description: data.description || '', revision: 1, created_at: row.created_at, updated_at: row.updated_at, workspace_id: 'local-workspace', creator_id: 'local-user', can_edit: true, owner_id: 'local-user', owner_name: '本地用户', lifecycle: data.lifecycle || (data.status === 'completed' ? 'completed' : 'in_progress'), status: data.status || 'active', tags: data.tags || [] };
}
function idea(row: any) {
  const data = withoutPriority(json(row));
  return { ...data, id: row.id, name: row.name, body: data.body || '', revision: 1, project_id: row.project_id, created_at: row.created_at, updated_at: row.updated_at, owner_id: 'local-user', owner_name: '本地用户', can_edit: true, status: data.status || 'idea', tags: data.tags || [] };
}
function experiment(row: any) {
  const data = withoutPriority(json(row));
  return { ...data, id: row.id, name: row.name, revision: 1, project_id: row.project_id, created_at: row.created_at, updated_at: row.updated_at, owner_id: 'local-user', owner_name: '本地用户', can_edit: true, progress: data.progress || 'in_progress', outcome: data.outcome || 'inconclusive', status: data.status || 'experimenting', series_id: data.series_id || row.id };
}
function activity(row: any) { return { ...json(row), id: row.id, entity_type: row.entity_type, entity_id: row.entity_id, project_id: null, human_id: 'local-user', created_at: row.created_at }; }

app.get('/v1/health', async () => wrap({ environment_id: 'local-sqlite', mode: 'local' }));
app.get('/v1/me', async () => { const p = await profile(); return wrap({ id: 'local-user', name: p.name, role: 'owner', kind: 'human', avatar_data: p.avatar_data }); });
app.get('/v1/people', async () => { const p = await profile(); return wrap([{ id: 'local-user', name: p.name, role: 'owner', avatar_data: p.avatar_data }]); });
app.get('/v1/workspaces', async () => wrap([{ id: 'local-workspace', name: '我的 Graybox' }]));
app.get('/v1/projects', async () => wrap(db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map(project)));
app.get('/v1/projects/:id', async (req: any, reply) => { const row = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id); return row ? wrap(project(row)) : reply.code(404).send({ error: { code: 'NOT_FOUND', message: '项目不存在。' } }); });
app.get('/v1/experiments', async () => wrap(db.prepare('SELECT * FROM experiments ORDER BY updated_at DESC').all().map(experiment)));
app.get('/v1/experiments/:id', async (req: any, reply) => { const row = db.prepare('SELECT * FROM experiments WHERE id=?').get(req.params.id); return row ? wrap(experiment(row)) : reply.code(404).send({ error: { code: 'NOT_FOUND', message: '实验不存在。' } }); });
app.get('/v1/ideas', async () => wrap(db.prepare('SELECT * FROM ideas ORDER BY updated_at DESC').all().map(idea)));
app.get('/v1/ideas/:id', async (req: any, reply) => { const row = db.prepare('SELECT * FROM ideas WHERE id=?').get(req.params.id); return row ? wrap(idea(row)) : reply.code(404).send({ error: { code: 'NOT_FOUND', message: '想法不存在。' } }); });
app.get('/v1/projects/:id/retrospectives', async () => wrap([]));
app.get('/v1/projects/:id/comments', async () => wrap([]));
app.get('/v1/projects/:id/agreement', async () => wrap(null));
app.get('/v1/tags', async () => wrap(db.prepare('SELECT name FROM tags ORDER BY name').all().map((row: any) => ({ id: row.name, name: row.name, workspace_id: 'local-workspace' }))));
app.get('/v1/activity', async () => wrap(db.prepare('SELECT * FROM activities ORDER BY created_at DESC LIMIT 100').all().map(activity)));
app.get('/v1/notifications', async () => wrap([]));
app.get('/v1/collaboration/notifications', async () => wrap({ items: [], unread_count: 0 }));
app.get('/v1/attachments', async (req: any) => {
  const entityType = String(req.query?.entity_type || '');
  const entityId = String(req.query?.entity_id || '');
  const rows = db.prepare('SELECT * FROM attachments WHERE entity_type=? AND entity_id=? ORDER BY rowid').all(entityType, entityId) as any[];
  return wrap(rows.map(row => ({ ...json(row), id: row.id, entity_type: row.entity_type, entity_id: row.entity_id, relative_path: row.relative_path, sha256: row.sha256, uploader_id: 'local-user', created_at: json(row).created_at || '' })));
});
app.post('/v1/attachments/upload', async (req: any, reply) => {
  try {
    const encoded = String(req.headers['x-graybox-metadata'] || '').replace(/-/g, '+').replace(/_/g, '/');
    const metadata = JSON.parse(Buffer.from(encoded + '='.repeat((4 - encoded.length % 4) % 4), 'base64').toString('utf8')) as any;
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!metadata.entity_type || !metadata.entity_id || !metadata.name || !metadata.kind || bytes.length === 0 || bytes.length > 50 * 1024 * 1024) throw new Error('附件为空或超限。');
    const previous = (db.prepare('SELECT * FROM attachments WHERE entity_type=? AND entity_id=?').all(metadata.entity_type, metadata.entity_id) as any[]).map(row => json(row)).find(item => item.idempotency_key === metadata.idempotency_key);
    if (previous) return wrap(previous);
    const id = randomUUID();
    const relativePath = `attachments/${id}`;
    await mkdir(join(root, 'attachments'), { recursive: true });
    await writeFile(join(root, relativePath), bytes);
    const created = now();
    const record = { id, entity_type: metadata.entity_type, entity_id: metadata.entity_id, name: metadata.name, caption: metadata.caption || '', kind: metadata.kind, mime_type: String(req.headers['content-type'] || 'application/octet-stream'), byte_size: bytes.length, sha256: metadata.sha256 || '', url: null, uploader_id: 'local-user', created_at: created, idempotency_key: metadata.idempotency_key };
    db.prepare('INSERT INTO attachments(id,entity_type,entity_id,relative_path,sha256,data) VALUES(?,?,?,?,?,?)').run(id, record.entity_type, record.entity_id, relativePath, record.sha256, JSON.stringify(record));
    return wrap(record);
  } catch (error) { return reply.code(400).send({ error: { code: 'LOCAL_ATTACHMENT_FAILED', message: error instanceof Error ? error.message : String(error) } }); }
});
app.post('/v1/attachments/link', async (req: any, reply) => {
  try {
    const body = req.body as any;
    const url = new URL(String(body?.url || ''));
    if (url.protocol !== 'https:') throw new Error('链接必须使用 HTTPS。');
    const previous = (db.prepare('SELECT * FROM attachments WHERE entity_type=? AND entity_id=?').all(body.entity_type, body.entity_id) as any[]).map(row => json(row)).find(item => item.idempotency_key === body.idempotency_key);
    if (previous) return wrap(previous);
    const id = randomUUID();
    const record = { id, entity_type: body.entity_type, entity_id: body.entity_id, name: body.name || url.hostname, caption: body.caption || '', kind: body.kind || 'repository', mime_type: null, byte_size: 0, sha256: null, url: url.href, uploader_id: 'local-user', created_at: now(), idempotency_key: body.idempotency_key };
    db.prepare('INSERT INTO attachments(id,entity_type,entity_id,relative_path,sha256,data) VALUES(?,?,?,?,?,?)').run(id, record.entity_type, record.entity_id, '', '', JSON.stringify(record));
    return wrap(record);
  } catch (error) { return reply.code(400).send({ error: { code: 'LOCAL_LINK_FAILED', message: error instanceof Error ? error.message : String(error) } }); }
});
app.get('/v1/attachments/:id/content', async (req: any, reply) => {
  const row = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id) as any;
  if (!row || !row.relative_path) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '附件不存在。' } });
  try { const bytes = await readFile(join(root, row.relative_path)); return reply.type(json(row).mime_type || 'application/octet-stream').send(bytes); }
  catch { return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '附件文件不存在。' } }); }
});
app.post('/v1/profile/name', async (req: any) => { const current = await profile(); const next = { ...current, name: String(req.body?.name || '本地用户').trim() || '本地用户' }; await saveProfile(next); return wrap({ id: 'local-user', name: next.name, role: 'owner', avatar_data: next.avatar_data }); });
app.post('/v1/profile/avatar', async (req: any) => { const current = await profile(); const next = { ...current, avatar_data: typeof req.body?.avatar_data === 'string' ? req.body.avatar_data : null }; await saveProfile(next); return wrap({ id: 'local-user', name: next.name, role: 'owner', avatar_data: next.avatar_data }); });

app.post('/v1/commands', async (req: any, reply) => {
  const command = req.body as any;
  const payload = command.payload || {};
  const id = randomUUID();
  const timestamp = now();
  db.exec('BEGIN');
  try {
    if (command.type === 'project_create') {
      const data = { name: String(payload.name || '').trim(), description: payload.description || '', status: payload.status || 'active', lifecycle: payload.lifecycle || 'in_progress', tags: Array.isArray(payload.tags) ? payload.tags : [] };
      if (!data.name) throw new Error('项目名称不能为空。');
      db.prepare('INSERT INTO projects(id,name,data,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, data.name, JSON.stringify(data), timestamp, timestamp);
      for (const tag of data.tags) db.prepare('INSERT OR IGNORE INTO tags(name) VALUES(?)').run(String(tag));
      db.prepare('INSERT INTO activities(id,entity_type,entity_id,data,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), 'project', id, JSON.stringify({ type: 'project_create', name: data.name }), timestamp);
      db.exec('COMMIT');
      return wrap(project({ id, name: data.name, data: JSON.stringify(data), created_at: timestamp, updated_at: timestamp }));
    }
    if (command.type === 'idea_create') {
      const data = { name: String(payload.name || '').trim(), body: payload.body || '', status: payload.status || 'idea', tags: Array.isArray(payload.tags) ? payload.tags : [] };
      if (!data.name) throw new Error('想法名称不能为空。');
      db.prepare('INSERT INTO ideas(id,project_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, payload.project_id ?? null, data.name, JSON.stringify(data), timestamp, timestamp);
      for (const tag of data.tags) db.prepare('INSERT OR IGNORE INTO tags(name) VALUES(?)').run(String(tag));
      db.exec('COMMIT');
      return wrap(idea({ id, project_id: payload.project_id ?? null, name: data.name, data: JSON.stringify(data), created_at: timestamp, updated_at: timestamp }));
    }
    if (command.type === 'experiment_create') {
      const projectId = String(payload.project_id || '');
      if (!db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)) throw new Error('实验必须关联已有项目。');
      const data = { name: String(payload.name || '').trim(), goal: payload.goal || '', summary: '', change_summary: '', series_id: randomUUID(), status: 'experimenting', progress: 'in_progress', tags: Array.isArray(payload.tags) ? payload.tags : [] };
      if (!data.name) throw new Error('实验名称不能为空。');
      db.prepare('INSERT INTO experiments(id,project_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, projectId, data.name, JSON.stringify(data), timestamp, timestamp);
      for (const tag of data.tags) db.prepare('INSERT OR IGNORE INTO tags(name) VALUES(?)').run(String(tag));
      db.exec('COMMIT');
      return wrap(experiment({ id, project_id: projectId, name: data.name, data: JSON.stringify(data), created_at: timestamp, updated_at: timestamp }));
    }
    const table = command.type === 'project_update' ? 'projects' : command.type === 'idea_update' ? 'ideas' : command.type === 'experiment_update' ? 'experiments' : '';
    if (table) {
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(payload.id) as any;
      if (!row) { db.exec('ROLLBACK'); return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '记录不存在。' } }); }
      const data = withoutPriority({ ...json(row), ...payload });
      const name = String(data.name || row.name).trim();
      db.prepare(`UPDATE ${table} SET name=?,data=?,updated_at=? WHERE id=?`).run(name, JSON.stringify({ ...data, name }), timestamp, payload.id);
      for (const tag of Array.isArray(data.tags) ? data.tags : []) db.prepare('INSERT OR IGNORE INTO tags(name) VALUES(?)').run(String(tag));
      db.exec('COMMIT');
      const updated = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(payload.id);
      return wrap(table === 'projects' ? project(updated) : table === 'ideas' ? idea(updated) : experiment(updated));
    }
    db.exec('ROLLBACK');
    return reply.code(400).send({ error: { code: 'NOT_SUPPORTED', message: '本地版暂未支持此命令。' } });
  } catch (error) {
    db.exec('ROLLBACK');
    return reply.code(400).send({ error: { code: 'LOCAL_WRITE_FAILED', message: error instanceof Error ? error.message : String(error) } });
  }
});
app.get('/__graybox/profiles', async () => { const p = await profile(); return [{ id: 'local-user', name: p.name, role: 'owner' }]; });
await app.listen({ host: '127.0.0.1', port: 4318 });
console.log('Graybox standalone SQLite API listening on http://127.0.0.1:4318');
