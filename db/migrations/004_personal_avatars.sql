ALTER TABLE graybox.users ADD COLUMN IF NOT EXISTS avatar_data text;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='graybox.users'::regclass AND conname='users_avatar_bounded') THEN
  ALTER TABLE graybox.users ADD CONSTRAINT users_avatar_bounded CHECK(avatar_data IS NULL OR (octet_length(avatar_data)<=180000 AND avatar_data ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'));
 END IF;
END $$;
GRANT SELECT(avatar_data),UPDATE(avatar_data) ON graybox.users TO graybox_runtime;
