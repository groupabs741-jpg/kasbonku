-- Karyawan ABS Group masuk dengan Gmail pribadi, jadi domain email tidak bisa
-- dipakai untuk memisahkan orang dalam dari orang luar. Gantinya: admin/HR
-- mendaftarkan alamat email karyawan lebih dulu, dan hanya alamat itu yang bisa
-- membuat profil.
--
-- Ini sekaligus memperbaiki hal yang lebih penting: sebelumnya karyawan memilih
-- jabatannya sendiri saat setup profil, padahal jabatan menentukan limit
-- pinjaman (PRD 4.2) — siapa pun bisa memilih "SPV/Manager" untuk mendapat
-- limit Rp 6 juta. Sekarang jabatan, cabang, dan masa kontrak berasal dari data
-- HR di tabel ini dan hanya admin yang bisa mengubahnya.

CREATE TABLE public.allowed_employees (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  jabatan        TEXT NOT NULL
                   CHECK (jabatan IN ('Staf/Pelaksana', 'Koordinator', 'SPV/Manager')),
  branch         TEXT,
  join_date      DATE,
  contract_start DATE NOT NULL,
  contract_end   DATE NOT NULL,
  note           TEXT,

  invited_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at     TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT allowed_employees_contract_range CHECK (contract_end >= contract_start)
);

-- Gmail treats addresses case-insensitively; match the same way.
CREATE UNIQUE INDEX allowed_employees_email_key
  ON public.allowed_employees (LOWER(email));
CREATE INDEX allowed_employees_claimed_by_idx ON public.allowed_employees (claimed_by);

CREATE TRIGGER allowed_employees_updated_at
  BEFORE UPDATE ON public.allowed_employees
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.allowed_employees ENABLE ROW LEVEL SECURITY;

-- HR data about every employee: admins only. An applicant never needs to read
-- this table — ensure_profile() copies what they need into their own profile.
CREATE POLICY "admin manages employee register" ON public.allowed_employees
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.allowed_employees FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowed_employees TO authenticated;

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
  ELSE
    -- claimed_* is set by ensure_profile(), never typed in by an admin.
    NEW.claimed_by := OLD.claimed_by;
    NEW.claimed_at := OLD.claimed_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER allowed_employees_stamp
  BEFORE INSERT OR UPDATE ON public.allowed_employees
  FOR EACH ROW EXECUTE FUNCTION public.stamp_allowed_employee();

-- ---------------------------------------------------------------------------
-- ensure_profile(): gate on the register, and seed the profile from HR data
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.profiles
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_user     auth.users%ROWTYPE;
  v_profile  public.profiles%ROWTYPE;
  v_employee public.allowed_employees%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_user FROM auth.users WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth user % not found', v_uid;
  END IF;

  -- Already onboarded (this includes every admin, created by promote_to_admin).
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF FOUND THEN
    IF v_profile.email IS DISTINCT FROM v_user.email THEN
      UPDATE public.profiles SET email = v_user.email
       WHERE id = v_uid RETURNING * INTO v_profile;
    END IF;
    RETURN v_profile;
  END IF;

  SELECT * INTO v_employee
  FROM public.allowed_employees
  WHERE LOWER(email) = LOWER(v_user.email);

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Email % belum terdaftar sebagai karyawan ABS Group. Hubungi admin Kasbonku untuk didaftarkan.',
      v_user.email
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.profiles (
    id, email, full_name, avatar_url, role,
    jabatan, branch, join_date, contract_start, contract_end
  )
  VALUES (
    v_uid,
    v_user.email,
    COALESCE(NULLIF(v_employee.full_name, ''), NULLIF(v_user.profile->>'name', ''),
             split_part(v_user.email, '@', 1)),
    NULLIF(v_user.profile->>'avatar_url', ''),
    'pemohon',
    v_employee.jabatan,
    v_employee.branch,
    v_employee.join_date,
    v_employee.contract_start,
    v_employee.contract_end
  )
  RETURNING * INTO v_profile;

  UPDATE public.allowed_employees
     SET claimed_by = v_uid, claimed_at = NOW()
   WHERE id = v_employee.id;

  RETURN v_profile;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

-- ---------------------------------------------------------------------------
-- Jabatan and the contract window now come from HR, not from the applicant.
-- They decide the borrowing limit, so an applicant must not be able to edit
-- them; phone numbers and display name stay self-service.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_profile_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_is_service BOOLEAN := auth.uid() IS NULL;
  v_is_admin   BOOLEAN := public.is_admin();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role <> 'pemohon' AND NOT v_is_service AND NOT v_is_admin THEN
      NEW.role := 'pemohon';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profiles.id is immutable';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT v_is_service AND NOT v_is_admin THEN
    RAISE EXCEPTION 'profiles.role can only be changed by an admin';
  END IF;

  IF NOT v_is_service AND NOT v_is_admin THEN
    IF NEW.jabatan IS DISTINCT FROM OLD.jabatan
       OR NEW.branch IS DISTINCT FROM OLD.branch
       OR NEW.join_date IS DISTINCT FROM OLD.join_date
       OR NEW.contract_start IS DISTINCT FROM OLD.contract_start
       OR NEW.contract_end IS DISTINCT FROM OLD.contract_end
    THEN
      RAISE EXCEPTION
        'jabatan, cabang, dan masa kontrak ditetapkan admin dari data kepegawaian';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Keep an application's snapshot honest: the jabatan it is filed under (and so
-- the limit it is checked against) must be the one on the profile.
CREATE OR REPLACE FUNCTION public.applications_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  NEW.code := 'KSB-'
    || to_char(NOW() AT TIME ZONE 'Asia/Makassar', 'YYMMDD')
    || '-'
    || lpad(nextval('public.application_code_seq')::TEXT, 3, '0');

  NEW.submitted_at := NOW();

  IF NOT public.is_admin() THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = NEW.user_id;
    IF FOUND THEN
      IF v_profile.jabatan IS NULL THEN
        RAISE EXCEPTION 'jabatan belum ditetapkan admin untuk karyawan ini';
      END IF;
      NEW.jabatan        := v_profile.jabatan;
      NEW.contract_start := COALESCE(v_profile.contract_start, NEW.contract_start);
      NEW.contract_end   := COALESCE(v_profile.contract_end, NEW.contract_end);
      NEW.join_date      := v_profile.join_date;
    END IF;

    NEW.status       := 'Diajukan';
    NEW.admin_note   := NULL;
    NEW.reviewed_by  := NULL;
    NEW.reviewed_at  := NULL;
    NEW.disbursed_at := NULL;
    NEW.processed_at := NULL;
    NEW.document_sent_at := NULL;
    NEW.signed_at    := NULL;
  END IF;

  NEW.remaining_contract_days := GREATEST(
    0,
    NEW.contract_end - (NOW() AT TIME ZONE 'Asia/Makassar')::DATE
  );

  RETURN NEW;
END;
$$;
