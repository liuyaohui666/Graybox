CREATE SCHEMA IF NOT EXISTS graybox;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE IF NOT EXISTS graybox.metadata(key text PRIMARY KEY, value jsonb NOT NULL);
INSERT INTO graybox.metadata VALUES ('environment_id',to_jsonb(gen_random_uuid()::text)) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS graybox.users(id uuid PRIMARY KEY, name text NOT NULL, role text NOT NULL CHECK(role IN ('owner','member')));
CREATE TABLE IF NOT EXISTS graybox.agents(id uuid PRIMARY KEY,human_id uuid NOT NULL REFERENCES graybox.users,name text NOT NULL);
CREATE TABLE IF NOT EXISTS graybox.credentials(id uuid PRIMARY KEY,human_id uuid NOT NULL REFERENCES graybox.users,agent_id uuid REFERENCES graybox.agents,kind text NOT NULL CHECK(kind IN ('human','agent')), token_hash text UNIQUE NOT NULL,label text UNIQUE NOT NULL,project_ids jsonb,revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS graybox.workspaces(id uuid PRIMARY KEY,name text NOT NULL);
CREATE TABLE IF NOT EXISTS graybox.projects(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES graybox.workspaces,revision integer NOT NULL CHECK(revision>0),data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz);
CREATE TABLE IF NOT EXISTS graybox.experiment_series(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES graybox.projects,name text NOT NULL,next_version integer NOT NULL DEFAULT 1,revision integer NOT NULL DEFAULT 1,deleted_at timestamptz);
CREATE TABLE IF NOT EXISTS graybox.experiments(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES graybox.projects,series_id uuid NOT NULL REFERENCES graybox.experiment_series,version integer NOT NULL,revision integer NOT NULL CHECK(revision>0),data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,UNIQUE(series_id,version));
CREATE TABLE IF NOT EXISTS graybox.batches(id uuid PRIMARY KEY,credential_id uuid NOT NULL REFERENCES graybox.credentials,revision integer NOT NULL DEFAULT 1,operation_count integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,undone_at timestamptz,compensates uuid REFERENCES graybox.batches);
CREATE TABLE IF NOT EXISTS graybox.evidence(id uuid PRIMARY KEY,experiment_id uuid NOT NULL REFERENCES graybox.experiments,project_id uuid NOT NULL REFERENCES graybox.projects,batch_id uuid NOT NULL REFERENCES graybox.batches,type text NOT NULL,source_kind text NOT NULL,result text NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS graybox.submissions(id uuid PRIMARY KEY,experiment_id uuid NOT NULL REFERENCES graybox.experiments,project_id uuid NOT NULL REFERENCES graybox.projects,batch_id uuid NOT NULL REFERENCES graybox.batches,reviewers jsonb NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS graybox.tombstones(id uuid PRIMARY KEY,batch_id uuid NOT NULL REFERENCES graybox.batches,entity_type text NOT NULL,entity_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(entity_type,entity_id));
CREATE TABLE IF NOT EXISTS graybox.activities(id uuid PRIMARY KEY,batch_id uuid NOT NULL REFERENCES graybox.batches,credential_id uuid NOT NULL REFERENCES graybox.credentials,human_id uuid NOT NULL REFERENCES graybox.users,agent_id uuid REFERENCES graybox.agents,session_id uuid,entity_type text NOT NULL,entity_id uuid NOT NULL,project_id uuid REFERENCES graybox.projects,type text NOT NULL,before jsonb,after jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS graybox.idempotency(credential_id uuid NOT NULL REFERENCES graybox.credentials,key uuid NOT NULL,payload_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(credential_id,key));
REVOKE ALL ON SCHEMA graybox FROM PUBLIC;
GRANT USAGE ON SCHEMA graybox TO graybox_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA graybox TO graybox_runtime;
GRANT INSERT,UPDATE ON graybox.projects,graybox.experiments,graybox.experiment_series,graybox.batches TO graybox_runtime;
GRANT INSERT ON graybox.activities,graybox.evidence,graybox.submissions,graybox.tombstones,graybox.idempotency TO graybox_runtime;
-- Row locking requires UPDATE privilege. Keep that authority out of the runtime role
-- and expose only a fixed, read-only credential lookup holding a share lock to commit.
CREATE OR REPLACE FUNCTION graybox.authoritative_credential(credential_id uuid)
RETURNS TABLE(id uuid,human_id uuid,agent_id uuid,kind text,project_ids jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $$ SELECT c.id,c.human_id,c.agent_id,c.kind,c.project_ids
      FROM graybox.credentials c WHERE c.id=credential_id AND c.revoked_at IS NULL FOR SHARE $$;
REVOKE ALL ON FUNCTION graybox.authoritative_credential(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION graybox.authoritative_credential(uuid) TO graybox_runtime;
