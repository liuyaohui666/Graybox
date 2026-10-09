ALTER TABLE graybox.users ADD COLUMN IF NOT EXISTS username text UNIQUE;
ALTER TABLE graybox.users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE graybox.users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE graybox.credentials ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE TABLE IF NOT EXISTS graybox.invitations(code_hash text PRIMARY KEY,role text NOT NULL CHECK(role IN ('owner','member')),expires_at timestamptz NOT NULL,used_at timestamptz);
CREATE TABLE IF NOT EXISTS graybox.pairs(device_hash text PRIMARY KEY,user_hash text UNIQUE NOT NULL,name text NOT NULL,expires_at timestamptz NOT NULL,human_id uuid REFERENCES graybox.users,project_ids jsonb,consumed_at timestamptz);
CREATE OR REPLACE FUNCTION graybox.authoritative_credential(credential_id uuid)
RETURNS TABLE(id uuid,human_id uuid,agent_id uuid,kind text,project_ids jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $$ SELECT c.id,c.human_id,c.agent_id,c.kind,c.project_ids FROM graybox.credentials c JOIN graybox.users u ON u.id=c.human_id WHERE c.id=credential_id AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>clock_timestamp()) AND u.disabled_at IS NULL FOR SHARE OF c,u $$;
REVOKE ALL ON FUNCTION graybox.authoritative_credential(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION graybox.authoritative_credential(uuid) TO graybox_runtime;
-- Auth role is provisioned offline, never by runtime. It has no domain write privileges.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='graybox_auth') THEN
GRANT USAGE ON SCHEMA graybox TO graybox_auth;
GRANT SELECT,INSERT,UPDATE ON graybox.users,graybox.agents,graybox.credentials,graybox.invitations,graybox.pairs TO graybox_auth;
GRANT SELECT ON graybox.metadata,graybox.workspaces,graybox.projects TO graybox_auth;
END IF; END $$;
REVOKE SELECT ON graybox.users FROM graybox_runtime;
GRANT SELECT(id,name,role,username,disabled_at) ON graybox.users TO graybox_runtime;
CREATE UNIQUE INDEX IF NOT EXISTS single_owner ON graybox.users(role) WHERE role='owner';
