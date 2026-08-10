-- The role guard blocked the only path to the FIRST admin: a project-admin
-- INSERT has no auth.uid(), so is_admin() was false and the role was silently
-- rewritten to 'pemohon'.
--
-- Treat a NULL auth.uid() as the trusted service context. Reaching this table
-- at all already requires privileges `anon` does not have (REVOKE ALL, and both
-- policies are TO authenticated), so the only caller with no auth.uid() here is
-- project_admin — the CLI, a migration, or the admin API key.

CREATE OR REPLACE FUNCTION public.guard_profile_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_is_service BOOLEAN := auth.uid() IS NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role <> 'pemohon' AND NOT v_is_service AND NOT public.is_admin() THEN
      NEW.role := 'pemohon';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profiles.id is immutable';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NOT v_is_service
     AND NOT public.is_admin()
  THEN
    RAISE EXCEPTION 'profiles.role can only be changed by an admin';
  END IF;
  RETURN NEW;
END;
$$;

-- Operator helper so provisioning an admin is one call instead of hand-written
-- SQL that has to know about auth.users. Callable only by project_admin.
CREATE OR REPLACE FUNCTION public.promote_to_admin(p_email TEXT)
RETURNS public.profiles
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user    auth.users%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM auth.users WHERE LOWER(email) = LOWER(p_email);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tidak ada akun dengan email %', p_email;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    v_user.id,
    v_user.email,
    COALESCE(NULLIF(v_user.profile->>'name', ''), split_part(v_user.email, '@', 1)),
    'admin'
  )
  ON CONFLICT (id) DO UPDATE SET role = 'admin', email = EXCLUDED.email
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_to_admin(TEXT) FROM PUBLIC, anon, authenticated;
