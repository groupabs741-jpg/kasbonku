-- Perbaikan biaya admin bulanan.
--
-- Sebelumnya monthly_admin_fee = 1% dari ANGSURAN bulanan (amount / tenor * 1%),
-- sehingga totalnya cuma 1% dari pokok. Aturan yang benar: admin 1% per bulan
-- dihitung dari POKOK pinjaman, ditagih tiap bulan angsuran.
--
--   monthly_admin_fee = 1% * pokok
--   total admin        = 1% * pokok * lama angsuran
--
-- net_disbursement ikut menyesuaikan (potongan admin jadi lebih besar).
--
-- Kolom generated STORED tidak bisa diubah ekspresinya langsung, jadi kita
-- drop lalu buat ulang. application_report bergantung pada kedua kolom ini,
-- jadi view di-drop dulu dan dibuat ulang setelahnya. receivables.monthly_admin_fee
-- adalah kolom biasa yang disalin saat pencairan, jadi kasbon yang sudah cair
-- tetap memakai nilai lamanya; hanya pencairan baru yang memakai nilai baru.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.application_report;

ALTER TABLE public.applications
  DROP COLUMN monthly_admin_fee,
  DROP COLUMN net_disbursement;

ALTER TABLE public.applications
  ADD COLUMN monthly_admin_fee NUMERIC(14, 2)
    GENERATED ALWAYS AS (ROUND(amount * 0.01, 2)) STORED,
  ADD COLUMN net_disbursement NUMERIC(14, 2)
    GENERATED ALWAYS AS (
      ROUND(amount - (amount * 0.015) - (amount * 0.01 * tenure_months), 2)
    ) STORED;

CREATE VIEW public.application_report
WITH (security_invoker = TRUE) AS
SELECT
  a.id,
  a.code,
  a.user_id,
  p.full_name,
  p.email,
  p.branch,
  a.jabatan,
  a.amount,
  a.tenure_months,
  a.monthly_installment,
  a.provisi_fee,
  a.monthly_admin_fee,
  a.net_disbursement,
  a.reason_category,
  a.reason_detail,
  a.status,
  a.admin_note,
  a.remaining_contract_days,
  a.submitted_at,
  a.reviewed_at,
  a.disbursed_at
FROM public.applications a
LEFT JOIN public.profiles p ON p.id = a.user_id;

GRANT SELECT ON public.application_report TO authenticated;
