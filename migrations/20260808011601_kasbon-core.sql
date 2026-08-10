-- Kasbonku core schema: profiles, applications, status history, documents.
-- Business rules from PRD sections 4, 5 and 6.

-- ---------------------------------------------------------------------------
-- Reference data used by CHECK constraints
-- ---------------------------------------------------------------------------

-- Nominal ceiling per jabatan (PRD 4.2)
CREATE OR REPLACE FUNCTION public.kasbon_limit(p_jabatan TEXT)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_jabatan
    WHEN 'Staf/Pelaksana' THEN 3000000::NUMERIC
    WHEN 'Koordinator'    THEN 4000000::NUMERIC
    WHEN 'SPV/Manager'    THEN 6000000::NUMERIC
    ELSE 0::NUMERIC
  END;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  full_name      TEXT NOT NULL DEFAULT '',
  avatar_url     TEXT,
  role           TEXT NOT NULL DEFAULT 'pemohon'
                   CHECK (role IN ('pemohon', 'admin')),
  jabatan        TEXT CHECK (jabatan IN ('Staf/Pelaksana', 'Koordinator', 'SPV/Manager')),
  branch         TEXT,
  join_date      DATE,
  contract_start DATE,
  contract_end   DATE,
  phone          TEXT,
  family_phone   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_contract_range CHECK (
    contract_start IS NULL OR contract_end IS NULL OR contract_end >= contract_start
  )
);

CREATE INDEX profiles_role_idx ON public.profiles (role);
CREATE INDEX profiles_email_idx ON public.profiles (LOWER(email));

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Recursion-safe admin check: SECURITY DEFINER so RLS on profiles is not
-- re-entered when this is called from another table's policy.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  );
$$;

-- `role` is a privilege field: never writable by the account it belongs to.
CREATE OR REPLACE FUNCTION public.guard_profile_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role <> 'pemohon' AND NOT public.is_admin() THEN
      NEW.role := 'pemohon';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profiles.id is immutable';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'profiles.role can only be changed by an admin';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_guard_fields
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_fields();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own profile or any as admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "create own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "update own profile or any as admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) OR public.is_admin())
  WITH CHECK (id = (SELECT auth.uid()) OR public.is_admin());

-- No client deletes: profiles disappear only with the auth user (cascade).
REVOKE DELETE ON public.profiles FROM anon, authenticated;
REVOKE ALL ON public.profiles FROM anon;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- Called by the client right after sign-in so a Google OAuth user always has a
-- profile row. SECURITY DEFINER: reads auth.users, which clients cannot select.
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.profiles
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_user    auth.users%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_user FROM auth.users WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth user % not found', v_uid;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    v_uid,
    v_user.email,
    COALESCE(NULLIF(v_user.profile->>'name', ''), split_part(v_user.email, '@', 1)),
    NULLIF(v_user.profile->>'avatar_url', '')
  )
  ON CONFLICT (id) DO UPDATE
    SET email      = EXCLUDED.email,
        avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url)
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------

CREATE SEQUENCE public.application_code_seq;

CREATE TABLE public.applications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Snapshot of the applicant at submission time; the profile may change later.
  jabatan          TEXT NOT NULL
                     CHECK (jabatan IN ('Staf/Pelaksana', 'Koordinator', 'SPV/Manager')),
  join_date        DATE,
  contract_start   DATE NOT NULL,
  contract_end     DATE NOT NULL,
  remaining_contract_days INTEGER NOT NULL DEFAULT 0,

  amount           NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  tenure_months    INTEGER NOT NULL CHECK (tenure_months BETWEEN 1 AND 6),
  phone            TEXT NOT NULL,
  family_phone     TEXT NOT NULL,
  reason_category  TEXT NOT NULL CHECK (reason_category IN (
                     'Kesehatan / Medis Darurat',
                     'Pendidikan / Sekolah',
                     'Kebutuhan Domestik Mendesak',
                     'Kebutuhan Keluarga / Persalinan',
                     'Kedukaan / Musibah'
                   )),
  reason_detail    TEXT,

  status           TEXT NOT NULL DEFAULT 'Diajukan' CHECK (status IN (
                     'Diajukan',
                     'Diproses Admin',
                     'Menunggu TTD',
                     'Menunggu Review',
                     'Ditolak',
                     'Disetujui / Cair',
                     'Lunas'
                   )),
  admin_note       TEXT,
  revision_of      UUID REFERENCES public.applications(id) ON DELETE SET NULL,

  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ,
  document_sent_at TIMESTAMPTZ,
  signed_at        TIMESTAMPTZ,
  reviewed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  disbursed_at     TIMESTAMPTZ,

  -- Biaya administrasi (PRD 4.4), derived so client and server never disagree.
  provisi_fee         NUMERIC(14, 2)
    GENERATED ALWAYS AS (ROUND(amount * 0.015, 2)) STORED,
  monthly_installment NUMERIC(14, 2)
    GENERATED ALWAYS AS (ROUND(amount / tenure_months, 2)) STORED,
  monthly_admin_fee   NUMERIC(14, 2)
    GENERATED ALWAYS AS (ROUND(amount / tenure_months * 0.01, 2)) STORED,
  net_disbursement    NUMERIC(14, 2)
    GENERATED ALWAYS AS (
      ROUND(amount - (amount * 0.015) - (amount / tenure_months * 0.01 * tenure_months), 2)
    ) STORED,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT applications_contract_range CHECK (contract_end >= contract_start),
  -- Nominal never exceeds the ceiling for the jabatan it was filed under.
  CONSTRAINT applications_amount_within_limit
    CHECK (amount <= public.kasbon_limit(jabatan))
);

CREATE INDEX applications_user_id_idx ON public.applications (user_id);
CREATE INDEX applications_status_idx ON public.applications (status);
CREATE INDEX applications_submitted_at_idx ON public.applications (submitted_at DESC);
CREATE INDEX applications_revision_of_idx ON public.applications (revision_of);

-- Maks 1 kasbon aktif per karyawan (PRD 4.5). "Ditolak" and "Lunas" are
-- terminal, so they do not block a new submission.
CREATE UNIQUE INDEX applications_one_active_per_user
  ON public.applications (user_id)
  WHERE status IN (
    'Diajukan', 'Diproses Admin', 'Menunggu TTD', 'Menunggu Review', 'Disetujui / Cair'
  );

CREATE TRIGGER applications_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Server-assigned code + sisa kontrak snapshot (PRD 4.1 field 5).
CREATE OR REPLACE FUNCTION public.applications_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.code := 'KSB-'
    || to_char(NOW() AT TIME ZONE 'Asia/Makassar', 'YYMMDD')
    || '-'
    || lpad(nextval('public.application_code_seq')::TEXT, 3, '0');

  NEW.submitted_at := NOW();
  NEW.remaining_contract_days := GREATEST(
    0,
    NEW.contract_end - (NOW() AT TIME ZONE 'Asia/Makassar')::DATE
  );

  -- Applicants always start at "Diajukan"; only admins may seed another state.
  IF NOT public.is_admin() THEN
    NEW.status       := 'Diajukan';
    NEW.admin_note   := NULL;
    NEW.reviewed_by  := NULL;
    NEW.reviewed_at  := NULL;
    NEW.disbursed_at := NULL;
    NEW.processed_at := NULL;
    NEW.document_sent_at := NULL;
    NEW.signed_at    := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER applications_before_insert
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_before_insert();

-- Status machine (PRD 5). Applicants may only hand a signed document back;
-- every other transition belongs to an admin. `kasbon.system_write` lets the
-- trusted installment trigger close an application as "Lunas".
CREATE OR REPLACE FUNCTION public.applications_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_is_admin   BOOLEAN := public.is_admin();
  v_is_system  BOOLEAN := COALESCE(current_setting('kasbon.system_write', TRUE), '') = 'on';
  v_is_owner   BOOLEAN := OLD.user_id = auth.uid();
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

    -- Applicant edits: only while still untouched by an admin.
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

  -- Admin transitions.
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

CREATE TRIGGER applications_guard_update
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_guard_update();

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own applications or all as admin" ON public.applications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "submit own application" ON public.applications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "update own application or any as admin" ON public.applications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin())
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_admin());

REVOKE ALL ON public.applications FROM anon;
REVOKE DELETE ON public.applications FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.applications TO authenticated;

-- ---------------------------------------------------------------------------
-- application_events (append-only status history)
-- ---------------------------------------------------------------------------

CREATE TABLE public.application_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  actor_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX application_events_application_id_idx
  ON public.application_events (application_id, created_at DESC);
CREATE INDEX application_events_user_id_idx ON public.application_events (user_id);

CREATE OR REPLACE FUNCTION public.log_application_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.application_events
      (application_id, user_id, actor_id, from_status, to_status, note)
    VALUES (NEW.id, NEW.user_id, auth.uid(), NULL, NEW.status, 'Pengajuan dibuat');
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.application_events
      (application_id, user_id, actor_id, from_status, to_status, note)
    VALUES (NEW.id, NEW.user_id, auth.uid(), OLD.status, NEW.status, NEW.admin_note);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER applications_log_event
  AFTER INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.log_application_event();

ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own history or all as admin" ON public.application_events
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

-- Written by the trigger only; clients get no write surface at all.
REVOKE ALL ON public.application_events FROM anon, authenticated;
GRANT SELECT ON public.application_events TO authenticated;

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

CREATE TABLE public.documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN (
                   'permohonan',   -- Lembar Permohonan (generated by admin)
                   'persetujuan',  -- Lembar Persetujuan (generated by admin)
                   'penyerahan',   -- Lembar Penyerahan (generated by admin)
                   'ttd_scan',     -- scan/foto dokumen bertanda tangan basah
                   'ttd_digital'   -- hasil signature pad
                 )),
  bucket         TEXT NOT NULL,
  object_key     TEXT NOT NULL,
  file_name      TEXT,
  mime_type      TEXT,
  size_bytes     BIGINT,
  uploaded_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bucket, object_key)
);

CREATE INDEX documents_application_id_idx ON public.documents (application_id);
CREATE INDEX documents_user_id_idx ON public.documents (user_id);

-- The applicant may only attach their own signature artefacts; the three
-- official lembar are produced by admins.
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
    IF v_owner <> auth.uid() THEN
      RAISE EXCEPTION 'not allowed to attach documents to this application';
    END IF;
    IF NEW.kind NOT IN ('ttd_scan', 'ttd_digital') THEN
      RAISE EXCEPTION 'applicants may only upload signed documents';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_guard_insert
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_insert();

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own documents or all as admin" ON public.documents
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "attach documents" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "admin manages documents" ON public.documents
  FOR DELETE TO authenticated
  USING (public.is_admin());

REVOKE ALL ON public.documents FROM anon;
REVOKE UPDATE ON public.documents FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.documents TO authenticated;
