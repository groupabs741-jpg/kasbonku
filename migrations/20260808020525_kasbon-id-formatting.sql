-- Notification text was rendering "Rp 400,000" and "11 Aug 2026": to_char's G
-- separator follows the server's lc_numeric and TO_CHAR month names are English.
-- Emails go to Indonesian staff, so format explicitly instead of relying on
-- database locale.

CREATE OR REPLACE FUNCTION public.format_rupiah(p_amount NUMERIC)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 'Rp ' || translate(to_char(ROUND(p_amount), 'FM999,999,999,999'), ',', '.');
$$;

CREATE OR REPLACE FUNCTION public.format_tanggal(p_date DATE)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT EXTRACT(DAY FROM p_date)::INT || ' '
    || (ARRAY[
         'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
         'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
       ])[EXTRACT(MONTH FROM p_date)::INT]
    || ' ' || EXTRACT(YEAR FROM p_date)::INT;
$$;

CREATE OR REPLACE FUNCTION public.queue_installment_reminders(p_days_ahead INTEGER DEFAULT 3)
RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row   RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT i.id, i.user_id, i.month_no, i.due_date, i.amount, a.code, r.tenure_months
    FROM public.installments i
    JOIN public.receivables r ON r.id = i.receivable_id
    JOIN public.applications a ON a.id = r.application_id
    WHERE i.status = 'Belum Dipotong'
      AND i.reminder_sent_at IS NULL
      AND i.due_date = ((NOW() AT TIME ZONE 'Asia/Makassar')::DATE + p_days_ahead)
  LOOP
    PERFORM public.enqueue_notification(
      v_row.user_id, 'reminder_angsuran',
      'Angsuran kasbon ' || v_row.code || ' jatuh tempo '
        || public.format_tanggal(v_row.due_date),
      'Angsuran bulan ke-' || v_row.month_no || ' dari ' || v_row.tenure_months
        || ' sebesar ' || public.format_rupiah(v_row.amount)
        || ' akan dipotong dari gaji pada ' || public.format_tanggal(v_row.due_date) || '.',
      NULL, v_row.id
    );

    UPDATE public.installments SET reminder_sent_at = NOW() WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_installment_reminders(INTEGER)
  FROM PUBLIC, anon, authenticated;

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
