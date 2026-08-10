-- Notifikasi (PRD 8) + reporting surface for Laporan & Export (PRD 7.2).
--
-- Notifications are a durable outbox: triggers enqueue rows, the send-email
-- edge function drains anything still `pending`. Nothing is lost if SendGrid is
-- down, and the dashboard can render the same rows as an in-app inbox.

CREATE TABLE public.notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.applications(id) ON DELETE CASCADE,
  installment_id UUID REFERENCES public.installments(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN (
                   'pengajuan_baru',      -- ke admin
                   'ttd_diterima',        -- ke admin
                   'dokumen_siap_ttd',    -- ke pemohon
                   'review_disetujui',    -- ke pemohon
                   'review_ditolak',      -- ke pemohon
                   'kasbon_lunas',        -- ke pemohon
                   'reminder_angsuran'    -- ke pemohon
                 )),
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  email_to       TEXT NOT NULL,
  email_status   TEXT NOT NULL DEFAULT 'pending'
                   CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
  email_error    TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  sent_at        TIMESTAMPTZ,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX notifications_user_id_idx ON public.notifications (user_id, created_at DESC);
CREATE INDEX notifications_pending_idx ON public.notifications (created_at)
  WHERE email_status = 'pending';
CREATE INDEX notifications_unread_idx ON public.notifications (user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "mark own notifications read" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

-- ---------------------------------------------------------------------------
-- Enqueue helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id        UUID,
  p_type           TEXT,
  p_title          TEXT,
  p_body           TEXT,
  p_application_id UUID DEFAULT NULL,
  p_installment_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_email TEXT;
  v_id    UUID;
BEGIN
  SELECT COALESCE(p.email, u.email) INTO v_email
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = p_user_id;

  IF v_email IS NULL OR v_email = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications
    (user_id, application_id, installment_id, type, title, body, email_to)
  VALUES
    (p_user_id, p_application_id, p_installment_id, p_type, p_title, p_body, v_email)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

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

CREATE TRIGGER applications_notify
  AFTER INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_application_change();

-- ---------------------------------------------------------------------------
-- Reminder angsuran (PRD 8.1) - called by the scheduled edge function.
-- Enqueues one notification per unpaid installment falling due in p_days_ahead.
-- ---------------------------------------------------------------------------

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
      'Angsuran kasbon ' || v_row.code || ' jatuh tempo ' || to_char(v_row.due_date, 'DD Mon YYYY'),
      'Angsuran bulan ke-' || v_row.month_no || ' dari ' || v_row.tenure_months
        || ' sebesar Rp ' || to_char(v_row.amount, 'FM999G999G999G999')
        || ' akan dipotong dari gaji pada ' || to_char(v_row.due_date, 'DD Mon YYYY') || '.',
      NULL, v_row.id
    );

    UPDATE public.installments SET reminder_sent_at = NOW() WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reporting views. security_invoker keeps each caller inside their own RLS:
-- an applicant sees only their rows, an admin sees everything.
-- ---------------------------------------------------------------------------

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

CREATE VIEW public.receivable_report
WITH (security_invoker = TRUE) AS
SELECT
  r.id,
  r.application_id,
  a.code,
  r.user_id,
  p.full_name,
  p.email,
  p.branch,
  a.jabatan,
  r.principal,
  r.provisi_fee,
  r.monthly_admin_fee,
  r.monthly_installment,
  r.tenure_months,
  r.paid_months,
  r.remaining,
  r.status,
  r.disbursed_on,
  r.settled_at,
  (r.monthly_admin_fee * r.tenure_months) AS total_monthly_admin_fee,
  (r.provisi_fee + r.monthly_admin_fee * r.tenure_months) AS total_admin_fee,
  (
    SELECT MIN(i.due_date)
    FROM public.installments i
    WHERE i.receivable_id = r.id AND i.status = 'Belum Dipotong'
  ) AS next_due_date
FROM public.receivables r
JOIN public.applications a ON a.id = r.application_id
LEFT JOIN public.profiles p ON p.id = r.user_id;

GRANT SELECT ON public.application_report TO authenticated;
GRANT SELECT ON public.receivable_report TO authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard aggregates. RLS on the underlying tables already scopes these, so
-- the same function serves both roles.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dashboard_stats()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'applications_total',    (SELECT COUNT(*) FROM public.applications),
    'applications_pending',  (SELECT COUNT(*) FROM public.applications
                               WHERE status IN ('Diajukan', 'Diproses Admin', 'Menunggu TTD')),
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

-- PostgREST publishes public functions as RPC and PostgreSQL grants EXECUTE to
-- PUBLIC by default. These two write on behalf of other users, so close them:
-- triggers reach enqueue_notification as the definer, and the reminder job runs
-- with the project API key.
REVOKE EXECUTE ON FUNCTION
  public.enqueue_notification(UUID, TEXT, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.queue_installment_reminders(INTEGER)
  FROM PUBLIC, anon, authenticated;
