-- Keputusan pemilik sistem: admin tidak perlu mendaftarkan karyawan lebih dulu.
-- Siapa pun yang login Google langsung masuk sebagai pemohon, lalu melengkapi
-- jabatan dan masa kontraknya sendiri di profil sebelum bisa mengajukan.
--
-- Konsekuensinya jabatan menjadi data yang diisi sendiri, padahal jabatan
-- menentukan limit pinjaman (PRD 4.2). Kendalinya berpindah ke tahap review:
-- tidak ada kasbon yang cair tanpa admin menyetujui, dan panel review
-- menonjolkan jabatan yang diklaim supaya admin mencocokkannya dengan data
-- kepegawaian. Batas nominal per jabatan tetap dijaga CHECK constraint, jadi
-- angkanya tidak bisa dilewati — yang bisa keliru hanya jabatannya.

-- ---------------------------------------------------------------------------
-- 1. ensure_profile(): buat profil untuk setiap akun yang berhasil login
-- ---------------------------------------------------------------------------

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

REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Pemohon boleh mengisi data kepegawaiannya sendiri lagi.
--    `role` tetap tidak bisa disentuh pemiliknya — itu hak akses, bukan data.
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

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Daftar karyawan tidak dipakai lagi.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.allowed_employees CASCADE;
DROP FUNCTION IF EXISTS public.stamp_allowed_employee() CASCADE;
