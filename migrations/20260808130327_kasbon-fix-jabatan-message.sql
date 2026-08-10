-- Pesan errornya masih dari era whitelist ("ditetapkan admin"), padahal
-- sekarang pemohon mengisi jabatannya sendiri di profil. Backstop ini hanya
-- terpicu kalau UI dilewati, tapi pesannya tetap harus mengarahkan ke tempat
-- yang benar.

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
      IF v_profile.jabatan IS NULL
         OR v_profile.contract_start IS NULL
         OR v_profile.contract_end IS NULL
      THEN
        RAISE EXCEPTION
          'Lengkapi jabatan dan masa kontrak di Pengaturan profil sebelum mengajukan kasbon.';
      END IF;

      -- Snapshot selalu dari profil, bukan dari payload: limit yang diperiksa
      -- CHECK constraint harus cocok dengan jabatan yang tersimpan.
      NEW.jabatan        := v_profile.jabatan;
      NEW.contract_start := v_profile.contract_start;
      NEW.contract_end   := v_profile.contract_end;
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
