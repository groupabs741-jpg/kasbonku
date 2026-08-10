-- stamp_allowed_employee() copied claimed_by/claimed_at back from OLD on every
-- UPDATE to stop an admin from typing them. That also silently reverted the
-- legitimate write from ensure_profile(), so a claimed register row still read
-- as unclaimed — the guard was blocking its own maintenance path.
--
-- Restrict the client's column surface instead, and let the trigger stop
-- managing those fields. ensure_profile() is SECURITY DEFINER and runs as the
-- owner, so it keeps write access to them.

REVOKE UPDATE ON public.allowed_employees FROM anon, authenticated;
GRANT UPDATE (
  email, full_name, jabatan, branch, join_date, contract_start, contract_end, note
) ON public.allowed_employees TO authenticated;

CREATE OR REPLACE FUNCTION public.stamp_allowed_employee()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.email := LOWER(TRIM(NEW.email));
  IF TG_OP = 'INSERT' THEN
    NEW.invited_by := COALESCE(auth.uid(), NEW.invited_by);
    NEW.claimed_by := NULL;
    NEW.claimed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
