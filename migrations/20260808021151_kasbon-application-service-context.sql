-- Deleting an employee failed with "not allowed to modify this application".
--
-- applications.revision_of is ON DELETE SET NULL, so removing a rejected
-- application makes PostgreSQL UPDATE the revision that points at it. That
-- UPDATE runs in the deleting session — project_admin, or an admin removing a
-- user — and applications_guard_update() saw no auth.uid(), so it was neither
-- "admin" nor "owner" and raised.
--
-- Allow the trusted service context, matching guard_profile_fields() and
-- guard_installment_update(). Runtime roles cannot reach it: `anon` has no
-- privileges on the table and every policy is TO authenticated, which always
-- carries an auth.uid().

CREATE OR REPLACE FUNCTION public.applications_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid        UUID    := auth.uid();
  v_is_service BOOLEAN := v_uid IS NULL;
  v_is_admin   BOOLEAN := public.is_admin();
  v_is_owner   BOOLEAN := COALESCE(OLD.user_id = v_uid, FALSE);
  v_is_system  BOOLEAN := pg_trigger_depth() > 1
    AND OLD.status IN ('Disetujui / Cair', 'Lunas')
    AND NEW.status IN ('Disetujui / Cair', 'Lunas');
BEGIN
  IF v_is_system OR v_is_service THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.remaining_contract_days IS DISTINCT FROM OLD.remaining_contract_days
  THEN
    RAISE EXCEPTION 'code, user_id and submission snapshot fields are immutable';
  END IF;

  IF NOT v_is_admin THEN
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'not allowed to modify this application';
    END IF;

    IF NEW.status = OLD.status THEN
      IF OLD.status <> 'Diajukan' THEN
        RAISE EXCEPTION 'application can only be edited while status is "Diajukan"';
      END IF;
    ELSIF OLD.status = 'Menunggu TTD' AND NEW.status = 'Menunggu Review' THEN
      NEW.signed_at := NOW();
    ELSE
      RAISE EXCEPTION 'transition % -> % is not allowed for an applicant',
        OLD.status, NEW.status;
    END IF;

    IF NEW.admin_note IS DISTINCT FROM OLD.admin_note
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.disbursed_at IS DISTINCT FROM OLD.disbursed_at
    THEN
      RAISE EXCEPTION 'review fields are admin-only';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'Diajukan'         AND NEW.status IN ('Diproses Admin', 'Ditolak'))
      OR (OLD.status = 'Diproses Admin'   AND NEW.status IN ('Menunggu TTD', 'Ditolak'))
      OR (OLD.status = 'Menunggu TTD'     AND NEW.status IN ('Menunggu Review', 'Ditolak'))
      OR (OLD.status = 'Menunggu Review'  AND NEW.status IN ('Disetujui / Cair', 'Ditolak', 'Menunggu TTD'))
      OR (OLD.status = 'Ditolak'          AND NEW.status IN ('Diproses Admin', 'Menunggu TTD'))
    ) THEN
      RAISE EXCEPTION 'transition % -> % is not allowed', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'Diproses Admin' AND NEW.processed_at IS NULL THEN
      NEW.processed_at := NOW();
    END IF;
    IF NEW.status = 'Menunggu TTD' THEN
      NEW.document_sent_at := NOW();
    END IF;
    IF NEW.status IN ('Disetujui / Cair', 'Ditolak') THEN
      NEW.reviewed_by := v_uid;
      NEW.reviewed_at := NOW();
    END IF;
    IF NEW.status = 'Disetujui / Cair' AND NEW.disbursed_at IS NULL THEN
      NEW.disbursed_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
