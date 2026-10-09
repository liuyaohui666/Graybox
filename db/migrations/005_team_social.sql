CREATE TABLE IF NOT EXISTS graybox.project_agreements (
 project_id uuid NOT NULL REFERENCES graybox.projects,
 user_id uuid NOT NULL REFERENCES graybox.users,
 active boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,user_id)
);
CREATE TABLE IF NOT EXISTS graybox.notifications (
 id uuid PRIMARY KEY,
 recipient_id uuid NOT NULL REFERENCES graybox.users,
 actor_id uuid NOT NULL REFERENCES graybox.users,
 agent_id uuid REFERENCES graybox.agents,
 project_id uuid NOT NULL REFERENCES graybox.projects,
 kind text NOT NULL CHECK(kind IN ('agreement','comment')),
 comment_id uuid REFERENCES graybox.comments,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 CHECK(recipient_id<>actor_id),
 CHECK((kind='agreement' AND comment_id IS NULL AND agent_id IS NULL) OR (kind='comment' AND comment_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS notifications_recipient_time ON graybox.notifications(recipient_id,created_at DESC,id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_agreement_source ON graybox.notifications(project_id,actor_id) WHERE kind='agreement';
CREATE UNIQUE INDEX IF NOT EXISTS notifications_comment_source ON graybox.notifications(comment_id) WHERE kind='comment';
GRANT SELECT,INSERT ON graybox.project_agreements,graybox.notifications TO graybox_runtime;
GRANT UPDATE(active,updated_at) ON graybox.project_agreements TO graybox_runtime;
GRANT UPDATE(read_at) ON graybox.notifications TO graybox_runtime;
