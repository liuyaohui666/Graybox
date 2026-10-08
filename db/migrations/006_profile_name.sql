-- Keep direct runtime writes to account names forbidden. The narrow function
-- derives the target from a live human credential, never a caller-supplied user.
CREATE OR REPLACE FUNCTION graybox.set_profile_name(credential_id uuid, new_name text)
RETURNS TABLE(id uuid,name text,role text,avatar_data text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE target_id uuid;
BEGIN
 SELECT a.human_id INTO target_id FROM graybox.authoritative_credential(credential_id) a WHERE a.kind='human';
 IF target_id IS NULL THEN RAISE EXCEPTION 'Human credential required' USING ERRCODE='42501'; END IF;
 IF new_name IS NULL OR length(btrim(new_name)) NOT BETWEEN 1 AND 100 OR new_name ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Invalid name' USING ERRCODE='22023';
 END IF;
 RETURN QUERY UPDATE graybox.users u SET name=btrim(new_name) WHERE u.id=target_id RETURNING u.id,u.name,u.role,u.avatar_data;
END $$;
REVOKE ALL ON FUNCTION graybox.set_profile_name(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION graybox.set_profile_name(uuid,text) TO graybox_runtime;
