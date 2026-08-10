-- Un-marking a deduction on a settled kasbon flips the application back from
-- "Lunas" to "Disetujui / Cair", which was firing a second "Kasbon disetujui,
-- dana dicairkan" email — wrong and confusing for the applicant. Re-marking it
-- then fired a duplicate "lunas" email.
--
-- Gate both on the transition they actually describe: an approval only comes
-- from review, and a settlement only from an active card. Every other case is
-- a bookkeeping correction and stays silent.

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

    WHEN 'Disetujui / Cair' THEN
      -- Only a real approval, never a reopened card.
      IF OLD.status = 'Menunggu Review' THEN
        PERFORM public.enqueue_notification(
          NEW.user_id, 'review_disetujui',
          'Kasbon ' || NEW.code || ' disetujui',
          'Pengajuan kasbon ' || v_amount || ' sudah disetujui dan dana dicairkan. '
            || 'Angsuran akan dipotong dari gaji selama ' || NEW.tenure_months || ' bulan.',
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
