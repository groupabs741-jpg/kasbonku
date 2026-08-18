-- Penyederhanaan alur (keputusan pemilik, 11 Agustus 2026).
--
-- Dua perubahan besar:
--   1. Dokumen resmi kini dibuat OTOMATIS saat pemohon submit (edge function
--      dipanggil sebagai pemilik pengajuan), bukan langkah manual admin. Karena
--      itu status 'Diproses Admin' tidak dipakai lagi — begitu masuk, pengajuan
--      langsung 'Diajukan' dengan dokumen sudah tersedia, dan admin cukup
--      menekan "Kirim Dokumen ke Pemohon" (pindah ke 'Menunggu TTD').
--   2. Tahap 'Menunggu TTD Basah' (admin mengedarkan cetakan ke wakil ketua,
--      ketua, sekretaris, bendahara) dihapus. Alur berakhir:
--        Diajukan → Menunggu TTD → Menunggu Review → Disetujui / Cair (→ Lunas)
--      dengan cabang Ditolak dari tiap tahap sebelum pencairan.
--
-- Juga: RPC submit_application() menulis profil + pengajuan dalam satu
-- transaksi, supaya form "Isi Data Diri" pertama kali menghasilkan dua record
-- sekaligus tanpa kondisi setengah jadi.

-- ---------------------------------------------------------------------------
-- 0. Lepas trigger yang punya efek samping selama remap data lama
--    (notify mengirim email; log menulis riwayat). Dipasang ulang di akhir.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS applications_notify ON public.applications;
DROP TRIGGER IF EXISTS applications_log_event ON public.applications;

-- Pindahkan baris yang masih memakai status lama ke padanan terdekat.
--   'Diproses Admin'      → 'Diajukan'        (dokumen kini otomatis)
--   'Menunggu TTD Basah'  → 'Menunggu Review' (kembali ke meja admin untuk ACC)
UPDATE public.applications SET status = 'Diajukan'       WHERE status = 'Diproses Admin';
UPDATE public.applications SET status = 'Menunggu Review' WHERE status = 'Menunggu TTD Basah';

-- ---------------------------------------------------------------------------
-- 1. Status set baru
-- ---------------------------------------------------------------------------

ALTER TABLE public.applications DROP CONSTRAINT applications_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IN (
    'Diajukan',
    'Menunggu TTD',
    'Menunggu Review',
    'Ditolak',
    'Disetujui / Cair',
    'Lunas'
  ));

-- Maks 1 kasbon aktif per karyawan (PRD 4.5) tanpa status yang dihapus.
DROP INDEX IF EXISTS public.applications_one_active_per_user;
CREATE UNIQUE INDEX applications_one_active_per_user
  ON public.applications (user_id)
  WHERE status IN (
    'Diajukan',
    'Menunggu TTD',
    'Menunggu Review',
    'Disetujui / Cair'
  );

-- ---------------------------------------------------------------------------
-- 2. Guard transisi
--    Admin: Diajukan → Menunggu TTD | Ditolak
--           Menunggu TTD → Ditolak            (pemohon yang membawa ke Review)
--           Menunggu Review → Disetujui / Cair | Ditolak | Menunggu TTD
--    Pemohon: Menunggu TTD → Menunggu Review  (wajib scan ttd_pemohon segar)
--    Gerbang ttd_scan manajemen sebelum pencairan DIHAPUS bersama TTD basah.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.applications_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid          UUID    := auth.uid();
  v_is_service   BOOLEAN := v_uid IS NULL;
  v_is_admin     BOOLEAN := public.is_admin();
  v_is_owner     BOOLEAN := COALESCE(OLD.user_id = v_uid, FALSE);
  v_is_system    BOOLEAN := pg_trigger_depth() > 1
    AND OLD.status IN ('Disetujui / Cair', 'Lunas')
    AND NEW.status IN ('Disetujui / Cair', 'Lunas');
  v_has_own_scan BOOLEAN;
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
      -- Scan harus lebih baru dari saat dokumen dikirim, supaya pengajuan yang
      -- dikembalikan admin tidak lolos memakai scan lama.
      SELECT EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.application_id = NEW.id
          AND d.kind = 'ttd_pemohon'
          AND d.created_at >= COALESCE(OLD.document_sent_at, OLD.submitted_at)
      ) INTO v_has_own_scan;

      IF NOT v_has_own_scan THEN
        RAISE EXCEPTION
          'scan dokumen bertanda tangan pemohon dan atasan langsung harus diunggah dulu';
      END IF;

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
         (OLD.status = 'Diajukan'         AND NEW.status IN ('Menunggu TTD', 'Ditolak'))
      OR (OLD.status = 'Menunggu TTD'     AND NEW.status IN ('Ditolak'))
      OR (OLD.status = 'Menunggu Review'  AND NEW.status IN ('Disetujui / Cair', 'Ditolak', 'Menunggu TTD'))
    ) THEN
      RAISE EXCEPTION 'transition % -> % is not allowed', OLD.status, NEW.status;
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

-- ---------------------------------------------------------------------------
-- 3. Jenis notifikasi baru: konfirmasi ke pemohon saat submit
-- ---------------------------------------------------------------------------

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'pengajuan_baru',       -- ke admin
    'pengajuan_terkirim',   -- ke pemohon (konfirmasi + dokumen otomatis)
    'ttd_diterima',         -- ke admin
    'dokumen_siap_ttd',     -- ke pemohon
    'ttd_basah_proses',     -- ke pemohon (legacy, dipertahankan untuk histori)
    'dokumen_lengkap',      -- ke pemohon (legacy)
    'review_disetujui',     -- ke pemohon
    'review_ditolak',       -- ke pemohon
    'kasbon_lunas',         -- ke pemohon
    'reminder_angsuran'     -- ke pemohon
  ));

CREATE OR REPLACE FUNCTION public.notify_application_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin  RECORD;
  v_name   TEXT;
  v_amount TEXT;
BEGIN
  SELECT COALESCE(NULLIF(p.full_name, ''), p.email) INTO v_name
  FROM public.profiles p WHERE p.id = NEW.user_id;
  v_name   := COALESCE(v_name, 'Pemohon');
  v_amount := public.format_rupiah(NEW.amount);

  IF TG_OP = 'INSERT' THEN
    -- Ke admin: ada pengajuan baru untuk ditinjau.
    FOR v_admin IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
      PERFORM public.enqueue_notification(
        v_admin.id, 'pengajuan_baru',
        'Pengajuan kasbon baru: ' || NEW.code,
        v_name || ' mengajukan kasbon ' || v_amount || ' (' || NEW.reason_category || ').',
        NEW.id
      );
    END LOOP;

    -- Ke pemohon: konfirmasi otomatis. Email berisi detail pengajuan + LAMPIRAN
    -- dokumen permohonan resmi (dipasang oleh notifications-dispatch), bukan
    -- sekadar ajakan buka dashboard. Dokumen sudah di tangan pemohon, jadi
    -- pengajuan langsung 'Menunggu TTD' dan pemohon bisa mulai tanda tangan.
    PERFORM public.enqueue_notification(
      NEW.user_id, 'pengajuan_terkirim',
      'Pengajuan kasbon ' || NEW.code || ' sudah diterima',
      'Pengajuan kasbon ' || v_amount || ' (' || NEW.reason_category || ') sudah kami '
        || 'terima. Dokumen permohonan resmi terlampir di email ini. Cetak '
        || 'dokumennya, tandatangani secara manual (Pemohon & Atasan Langsung), '
        || 'lalu unggah hasil scan-nya melalui dashboard Kasbonku.',
      NEW.id
    );

    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'Menunggu TTD' THEN
      PERFORM public.enqueue_notification(
        NEW.user_id, 'dokumen_siap_ttd',
        'Dokumen kasbon ' || NEW.code || ' siap ditandatangani',
        'Dokumen sudah dikirim ke email kamu. Buka dashboard Kasbonku untuk '
          || 'membuka dokumennya, cetak, tandatangani secara manual, lalu unggah '
          || 'kembali hasil scan-nya.',
        NEW.id
      );

    WHEN 'Menunggu Review' THEN
      FOR v_admin IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
        PERFORM public.enqueue_notification(
          v_admin.id, 'ttd_diterima',
          'Dokumen TTD diterima: ' || NEW.code,
          v_name || ' sudah mengunggah scan dokumen bertanda tangan pemohon dan '
            || 'atasan langsung. Menunggu review admin.',
          NEW.id
        );
      END LOOP;

    WHEN 'Disetujui / Cair' THEN
      IF OLD.status = 'Menunggu Review' THEN
        PERFORM public.enqueue_notification(
          NEW.user_id, 'review_disetujui',
          'Kasbon ' || NEW.code || ' disetujui',
          'Pengajuan kasbon ' || v_amount || ' sudah disetujui dan dana dicairkan. '
            || 'Angsuran ' || public.format_rupiah(NEW.monthly_installment)
            || ' akan dipotong dari gaji selama ' || NEW.tenure_months || ' bulan.',
          NEW.id
        );
      END IF;

    WHEN 'Ditolak' THEN
      PERFORM public.enqueue_notification(
        NEW.user_id, 'review_ditolak',
        'Kasbon ' || NEW.code || ' perlu revisi',
        COALESCE(
          NULLIF(NEW.admin_note, ''),
          'Pengajuan kamu ditolak. Silakan revisi data dan ajukan ulang.'
        ),
        NEW.id
      );

    WHEN 'Lunas' THEN
      IF OLD.status = 'Disetujui / Cair' THEN
        PERFORM public.enqueue_notification(
          NEW.user_id, 'kasbon_lunas',
          'Kasbon ' || NEW.code || ' lunas',
          'Seluruh angsuran kasbon ' || v_amount || ' sudah selesai dipotong. Terima kasih.',
          NEW.id
        );
      END IF;

    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Pasang ulang trigger yang dilepas di langkah 0
-- ---------------------------------------------------------------------------

CREATE TRIGGER applications_notify
  AFTER INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_application_change();

CREATE TRIGGER applications_log_event
  AFTER INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.log_application_event();

-- ---------------------------------------------------------------------------
-- 5. submit_application(): profil + pengajuan dalam satu transaksi
--
-- SECURITY INVOKER: berjalan sebagai pemanggil, jadi RLS, auth.uid(), dan semua
-- trigger (before_insert code/sisa kontrak, notify, log) tetap berlaku persis
-- seperti insert langsung. Dipakai untuk pengajuan pertama (form gabungan),
-- pengajuan berikutnya (data diri boleh diedit), dan revisi.
-- ---------------------------------------------------------------------------

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
    family_phone   = p_family_phone
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
    status, document_sent_at
  ) VALUES (
    v_uid, p_jabatan, p_join_date, p_contract_start, p_contract_end,
    p_amount, p_tenure_months, p_phone, p_family_phone,
    p_reason_category, p_reason_detail, p_revision_of,
    'Menunggu TTD', NOW()
  )
  RETURNING * INTO v_app;

  RETURN v_app;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_application(
  TEXT, TEXT, TEXT, DATE, DATE, DATE, TEXT, TEXT, NUMERIC, INTEGER, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_application(
  TEXT, TEXT, TEXT, DATE, DATE, DATE, TEXT, TEXT, NUMERIC, INTEGER, TEXT, TEXT, UUID
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Statistik dashboard mengikuti status baru
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dashboard_stats()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'applications_total',    (SELECT COUNT(*) FROM public.applications),
    'applications_pending',  (SELECT COUNT(*) FROM public.applications
                               WHERE status IN ('Diajukan', 'Menunggu TTD')),
    'applications_review',   (SELECT COUNT(*) FROM public.applications
                               WHERE status = 'Menunggu Review'),
    'applications_active',   (SELECT COUNT(*) FROM public.applications
                               WHERE status = 'Disetujui / Cair'),
    'applications_settled',  (SELECT COUNT(*) FROM public.applications
                               WHERE status = 'Lunas'),
    'receivables_active',    (SELECT COUNT(*) FROM public.receivables WHERE status = 'Aktif'),
    'outstanding_total',     (SELECT COALESCE(SUM(remaining), 0) FROM public.receivables
                               WHERE status = 'Aktif'),
    'disbursed_total',       (SELECT COALESCE(SUM(principal), 0) FROM public.receivables),
    'admin_fee_total',       (SELECT COALESCE(SUM(provisi_fee + monthly_admin_fee * tenure_months), 0)
                               FROM public.receivables),
    'unread_notifications',  (SELECT COUNT(*) FROM public.notifications WHERE read_at IS NULL)
  );
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_stats() TO authenticated;
