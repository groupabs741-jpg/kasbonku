-- Menambahkan field bank_name dan bank_account ke profiles dan applications.

ALTER TABLE public.profiles
ADD COLUMN bank_name TEXT,
ADD COLUMN bank_account TEXT;

ALTER TABLE public.applications
ADD COLUMN bank_name TEXT,
ADD COLUMN bank_account TEXT;

-- Perbarui RPC submit_application agar menerima argumen bank_name dan bank_account.
CREATE OR REPLACE FUNCTION public.submit_application(
  p_full_name       TEXT,
  p_jabatan         TEXT,
  p_branch          TEXT,
  p_join_date       DATE,
  p_contract_start  DATE,
  p_contract_end    DATE,
  p_phone           TEXT,
  p_family_phone    TEXT,
  p_amount          NUMERIC,
  p_tenure_months   INTEGER,
  p_reason_category TEXT,
  p_bank_name       TEXT,
  p_bank_account    TEXT,
  p_reason_detail   TEXT DEFAULT NULL,
  p_revision_of     UUID DEFAULT NULL
)
RETURNS public.applications
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_app public.applications%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Profil selalu disegarkan dari form: pengajuan pertama mengisi data kosong,
  -- pengajuan berikutnya boleh memutakhirkan (mis. kontrak diperpanjang).
  UPDATE public.profiles SET
    full_name      = p_full_name,
    jabatan        = p_jabatan,
    branch         = p_branch,
    join_date      = p_join_date,
    contract_start = p_contract_start,
    contract_end   = p_contract_end,
    phone          = p_phone,
    family_phone   = p_family_phone,
    bank_name      = p_bank_name,
    bank_account   = p_bank_account
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profil pengguna tidak ditemukan';
  END IF;

  -- Pengajuan langsung mendarat di 'Menunggu TTD': dokumen resmi otomatis dibuat
  -- sesaat setelah commit dan email konfirmasi (detail pengajuan + LAMPIRAN
  -- dokumen) dikirim ke pemohon, jadi admin tidak perlu mengirim dokumen manual.
  -- document_sent_at dicatat saat itu juga sebagai acuan keaslian scan nanti.
  INSERT INTO public.applications (
    user_id, jabatan, join_date, contract_start, contract_end,
    amount, tenure_months, phone, family_phone,
    reason_category, reason_detail, revision_of,
    status, document_sent_at, bank_name, bank_account
  ) VALUES (
    v_uid, p_jabatan, p_join_date, p_contract_start, p_contract_end,
    p_amount, p_tenure_months, p_phone, p_family_phone,
    p_reason_category, p_reason_detail, p_revision_of,
    'Menunggu TTD', NOW(), p_bank_name, p_bank_account
  )
  RETURNING * INTO v_app;

  RETURN v_app;
END;
$$;

-- Sesuaikan previleges
REVOKE EXECUTE ON FUNCTION public.submit_application(
  TEXT, TEXT, TEXT, DATE, DATE, DATE, TEXT, TEXT, NUMERIC, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_application(
  TEXT, TEXT, TEXT, DATE, DATE, DATE, TEXT, TEXT, NUMERIC, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID
) TO authenticated;
