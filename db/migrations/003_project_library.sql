ALTER TABLE graybox.projects ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES graybox.users;
UPDATE graybox.projects p SET creator_id=(SELECT a.human_id FROM graybox.activities a WHERE a.entity_type='project' AND a.entity_id=p.id AND a.type='project_create' AND a.before IS NULL ORDER BY a.created_at,a.id LIMIT 1) WHERE creator_id IS NULL;
-- Unknown historical creators remain NULL and read-only; team management grants no project ownership.
UPDATE graybox.projects SET data=data || jsonb_build_object('lifecycle',CASE data->>'status' WHEN 'paused' THEN 'paused' WHEN 'archived' THEN 'completed' ELSE 'in_progress' END) WHERE NOT data ? 'lifecycle';
UPDATE graybox.projects SET data=data || '{"priority":"medium","tags":[]}'::jsonb || data WHERE NOT data ? 'priority' OR NOT data ? 'tags';
CREATE TABLE IF NOT EXISTS graybox.tags(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES graybox.workspaces,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),normalized_name text NOT NULL,UNIQUE(workspace_id,normalized_name));
CREATE TABLE IF NOT EXISTS graybox.retrospectives(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES graybox.projects,batch_id uuid NOT NULL REFERENCES graybox.batches,author_id uuid NOT NULL REFERENCES graybox.users,agent_id uuid REFERENCES graybox.agents,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS graybox.comments(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES graybox.projects,batch_id uuid NOT NULL REFERENCES graybox.batches,author_id uuid NOT NULL REFERENCES graybox.users,agent_id uuid REFERENCES graybox.agents,body text NOT NULL CHECK(length(body) BETWEEN 1 AND 12000),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS retrospectives_project ON graybox.retrospectives(project_id,created_at,id);
CREATE INDEX IF NOT EXISTS comments_project ON graybox.comments(project_id,created_at,id);
GRANT SELECT,INSERT ON graybox.tags,graybox.retrospectives,graybox.comments TO graybox_runtime;
