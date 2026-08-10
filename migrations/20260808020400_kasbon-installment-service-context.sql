-- guard_installment_update() rejected project_admin as well, because is_admin()
-- is false when there is no auth.uid(). That blocked legitimate data repair and
-- any service-key job from touching installments at all.
--
-- Allow the trusted service context, exactly as guard_profile_fields() does.
-- `anon` and `authenticated` cannot reach this branch: both are REVOKEd from
-- the table except for the admin-only UPDATE policy and its column grants.

CREATE OR REPLACE FUNCTION public.guard_installment_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_is_service BOOLEAN := auth.uid() IS NULL;
BEGIN
  IF NOT v_is_service AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an admin can update installment rows';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.receivable_id IS DISTINCT FROM OLD.receivable_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.month_no IS DISTINCT FROM OLD.month_no
  THEN
    RAISE EXCEPTION 'installment identity fields are immutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.updated_by := auth.uid();
    NEW.paid_on := CASE
      WHEN NEW.status = 'Sudah Dipotong'
        THEN COALESCE(NEW.paid_on, (NOW() AT TIME ZONE 'Asia/Makassar')::DATE)
      ELSE NULL
    END;
  END IF;

  RETURN NEW;
END;
$$;
