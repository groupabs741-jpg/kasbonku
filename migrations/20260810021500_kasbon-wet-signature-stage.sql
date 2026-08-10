-- Tahap TTD basah antara review dokumen dan pencairan.
--
-- Alur nyata di ABS Group: setelah pemohon menandatangani dokumen secara
-- digital dan admin mereview, admin mencetak dokumen itu dan mengedarkannya
-- untuk tanda tangan basah (atasan langsung, wakil ketua, ketua, sekretaris,
-- bendahara). Dokumen lengkap discan dan diunggah kembali; baru setelah itu
-- dana boleh cair.
--
-- Bukti fisik dijaga di database, bukan hanya di UI: 'Disetujui / Cair'
-- ditolak selama belum ada dokumen `ttd_scan`.

-- ---------------------------------------------------------------------------
-- Status baru
-- ---------------------------------------------------------------------------

ALTER TABLE public.applications DROP CONSTRAINT applications_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IN (
    'Diajukan',
    'Diproses Admin',
    'Menunggu TTD',
    'Menunggu Review',
    'Menunggu TTD Basah',
    'Ditolak',
    'Disetujui / Cair',
    'Lunas'
  ));

-- Kapan dokumen mulai diedarkan untuk tanda tangan basah.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS wet_signature_at TIMESTAMPTZ;

-- Tahap baru juga menahan pengajuan kedua (PRD 4.5).
DROP INDEX IF EXISTS public.applications_one_active_per_user;
CREATE UNIQUE INDEX applications_one_active_per_user
  ON public.applications (user_id)
  WHERE status IN (
    'Diajukan',
    'Diproses Admin',
    'Menunggu TTD',
    'Menunggu Review',
    'Menunggu TTD Basah',
    'Disetujui / Cair'
  );

-- ---------------------------------------------------------------------------
-- Guard transisi
-- ---------------------------------------------------------------------------

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
  v_has_scan   BOOLEAN;
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
         (OLD.status = 'Diajukan'           AND NEW.status IN ('Diproses Admin', 'Ditolak'))
      OR (OLD.status = 'Diproses Admin'     AND NEW.status IN ('Menunggu TTD', 'Ditolak'))
      OR (OLD.status = 'Menunggu TTD'       AND NEW.status IN ('Menunggu Review', 'Ditolak'))
      OR (OLD.status = 'Menunggu Review'    AND NEW.status IN ('Menunggu TTD Basah', 'Ditolak', 'Menunggu TTD'))
      OR (OLD.status = 'Menunggu TTD Basah' AND NEW.status IN ('Disetujui / Cair', 'Ditolak', 'Menunggu Review'))
      OR (OLD.status = 'Ditolak'            AND NEW.status IN ('Diproses Admin', 'Menunggu TTD'))
    ) THEN
      RAISE EXCEPTION 'transition % -> % is not allowed', OLD.status, NEW.status;
    END IF;

    -- Uang hanya keluar kalau dokumen bertanda tangan lengkap sudah diarsipkan.
    IF NEW.status = 'Disetujui / Cair' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.application_id = NEW.id AND d.kind = 'ttd_scan'
      ) INTO v_has_scan;

      IF NOT v_has_scan THEN
        RAISE EXCEPTION
          'scan dokumen bertanda tangan lengkap harus diunggah sebelum pencairan';
      END IF;
    END IF;

    IF NEW.status = 'Diproses Admin' AND NEW.processed_at IS NULL THEN
      NEW.processed_at := NOW();
    END IF;
    IF NEW.status = 'Menunggu TTD' THEN
      NEW.document_sent_at := NOW();
    END IF;
    IF NEW.status = 'Menunggu TTD Basah' THEN
      NEW.wet_signature_at := NOW();
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
-- Notifikasi tahap baru
-- ---------------------------------------------------------------------------

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'pengajuan_baru',       -- ke admin
    'ttd_diterima',         -- ke admin
    'dokumen_siap_ttd',     -- ke pemohon
    'ttd_basah_proses',     -- ke pemohon
    'dokumen_lengkap',      -- ke pemohon
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
  v_admin      RECORD;
  v_name       TEXT;
  v_amount     TEXT;
BEGIN
  SELECT COALESCE(NULLIF(p.full_name, ''), p.email) INTO v_name
  FROM public.profiles p WHERE p.id = NEW.user_id;
  v_name   := COALESCE(v_name, 'Pemohon');
  v_amount := 'Rp ' || to_char(NEW.amount, 'FM999G999G999G999');

  IF TG_OP = 'INSERT' THEN
    FOR v_admin IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
      PERFORM public.enqueue_notification(
        v_admin.id, 'pengajuan_baru',
        'Pengajuan kasbon baru: ' || NEW.code,
        v_name || ' mengajukan kasbon ' || v_amount || ' (' || NEW.reason_category || ').',
        NEW.id
      );
    END LOOP;
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
        'Dokumen permohonan kasbon kamu sudah disiapkan admin. Silakan tanda tangan '
          || 'dan kirim kembali melalui dashboard Kasbonku.',
        NEW.id
      );

    WHEN 'Menunggu Review' THEN
      FOR v_admin IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
        PERFORM public.enqueue_notification(
          v_admin.id, 'ttd_diterima',
          'Dokumen TTD diterima: ' || NEW.code,
          v_name || ' sudah mengirim dokumen bertanda tangan. Menunggu review admin.',
          NEW.id
        );
      END LOOP;

    WHEN 'Menunggu TTD Basah' THEN
      PERFORM public.enqueue_notification(
        NEW.user_id, 'ttd_basah_proses',
        'Kasbon ' || NEW.code || ' sedang dikumpulkan tanda tangannya',
        'Dokumen kamu sudah lolos review admin dan sekarang dicetak untuk tanda '
          || 'tangan atasan langsung, wakil ketua, dan ketua. Kamu akan diberi kabar '
          || 'lagi setelah dokumen lengkap dan dana siap dicairkan.',
        NEW.id
      );

    WHEN 'Disetujui / Cair' THEN
      PERFORM public.enqueue_notification(
        NEW.user_id, 'review_disetujui',
        'Kasbon ' || NEW.code || ' disetujui',
        'Pengajuan kasbon ' || v_amount || ' sudah disetujui dan dana dicairkan. '
          || 'Angsuran akan dipotong dari gaji selama ' || NEW.tenure_months || ' bulan.',
        NEW.id
      );

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
      PERFORM public.enqueue_notification(
        NEW.user_id, 'kasbon_lunas',
        'Kasbon ' || NEW.code || ' lunas',
        'Seluruh angsuran kasbon ' || v_amount || ' sudah selesai dipotong. Terima kasih.',
        NEW.id
      );

    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Scan dokumen lengkap memberi kabar ke pemohon
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_signed_scan_uploaded()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF NEW.kind <> 'ttd_scan' THEN
    RETURN NEW;
  END IF;

  SELECT a.code INTO v_code
  FROM public.applications a WHERE a.id = NEW.application_id;

  PERFORM public.enqueue_notification(
    NEW.user_id, 'dokumen_lengkap',
    'Dokumen kasbon ' || COALESCE(v_code, '') || ' sudah lengkap',
    'Dokumen kasbon kamu sudah ditandatangani lengkap dan diarsipkan admin. '
      || 'Pencairan dana diproses setelah ini.',
    NEW.application_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_notify_signed_scan ON public.documents;
CREATE TRIGGER documents_notify_signed_scan
  AFTER INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.notify_signed_scan_uploaded();
