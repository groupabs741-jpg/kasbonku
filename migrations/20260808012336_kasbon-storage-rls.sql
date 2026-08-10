-- Storage RLS + hardening of two ownership checks.
--
-- Object keys are laid out as `<user_id>/<application_id>/<file>`, so the first
-- folder segment is the ownership claim. Applicants reach only their own
-- folder; admins reach every folder because they generate the official lembar
-- into the applicant's tree and review signed documents.

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storage_objects_owner_select ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_insert ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_update ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_delete ON storage.objects;

CREATE POLICY kasbon_objects_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket IN ('kasbon-documents', 'kasbon-signatures')
    AND (
      (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
      OR public.is_admin()
    )
  );

CREATE POLICY kasbon_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket IN ('kasbon-documents', 'kasbon-signatures')
    AND (
      (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
      OR public.is_admin()
    )
  );

CREATE POLICY kasbon_objects_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket IN ('kasbon-documents', 'kasbon-signatures')
    AND (
      (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
      OR public.is_admin()
    )
  )
  WITH CHECK (
    bucket IN ('kasbon-documents', 'kasbon-signatures')
    AND (
      (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
      OR public.is_admin()
    )
  );

-- Signed documents are evidence: applicants cannot remove them once submitted.
CREATE POLICY kasbon_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket IN ('kasbon-documents', 'kasbon-signatures')
    AND public.is_admin()
  );

GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- ---------------------------------------------------------------------------
-- Hardening: `x = auth.uid()` is NULL, not FALSE, when there is no session, and
-- `IF NULL THEN RAISE` never fires. Make both ownership checks fail closed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.applications_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_is_admin  BOOLEAN := public.is_admin();
  v_is_owner  BOOLEAN := COALESCE(OLD.user_id = auth.uid(), FALSE);
  v_is_system BOOLEAN := pg_trigger_depth() > 1
    AND OLD.status IN ('Disetujui / Cair', 'Lunas')
    AND NEW.status IN ('Disetujui / Cair', 'Lunas');
BEGIN
  IF v_is_system THEN
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
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := NOW();
    END IF;
    IF NEW.status = 'Disetujui / Cair' AND NEW.disbursed_at IS NULL THEN
      NEW.disbursed_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_document_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT a.user_id INTO v_owner FROM public.applications a WHERE a.id = NEW.application_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'application % not found', NEW.application_id;
  END IF;

  NEW.user_id     := v_owner;
  NEW.uploaded_by := auth.uid();

  IF NOT public.is_admin() THEN
    IF v_owner IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'not allowed to attach documents to this application';
    END IF;
    IF NEW.kind NOT IN ('ttd_scan', 'ttd_digital') THEN
      RAISE EXCEPTION 'applicants may only upload signed documents';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
