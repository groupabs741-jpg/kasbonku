-- Kartu piutang + rincian angsuran (PRD 6.2 and 7.1).
-- Both tables are server-maintained: a card and its rows appear when an
-- application is disbursed, and "Lunas" is derived from the rows, never typed.

-- ---------------------------------------------------------------------------
-- Let the trusted installment trigger close/reopen an application.
--
-- A direct client UPDATE reaches this guard at pg_trigger_depth() = 1. The only
-- way to reach it deeper is from another trigger, and the sole nested writer is
-- sync_receivable_progress() below — so the bypass is additionally pinned to
-- the "Disetujui / Cair" <-> "Lunas" swap it performs.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.applications_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_is_admin  BOOLEAN := public.is_admin();
  v_is_owner  BOOLEAN := OLD.user_id = auth.uid();
  v_is_system BOOLEAN := pg_trigger_depth() > 1
    AND OLD.status IN ('Disetujui / Cair', 'Lunas')
    AND NEW.status IN ('Disetujui / Cair', 'Lunas');
BEGIN
  IF v_is_system THEN
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
         (OLD.status = 'Diajukan'         AND NEW.status IN ('Diproses Admin', 'Ditolak'))
      OR (OLD.status = 'Diproses Admin'   AND NEW.status IN ('Menunggu TTD', 'Ditolak'))
      OR (OLD.status = 'Menunggu TTD'     AND NEW.status IN ('Menunggu Review', 'Ditolak'))
      OR (OLD.status = 'Menunggu Review'  AND NEW.status IN ('Disetujui / Cair', 'Ditolak', 'Menunggu TTD'))
      OR (OLD.status = 'Ditolak'          AND NEW.status IN ('Diproses Admin', 'Menunggu TTD'))
    ) THEN
      RAISE EXCEPTION 'transition % -> % is not allowed', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'Diproses Admin' AND NEW.processed_at IS NULL THEN
      NEW.processed_at := NOW();
    END IF;
    IF NEW.status = 'Menunggu TTD' THEN
      NEW.document_sent_at := NOW();
    END IF;
    IF NEW.status IN ('Disetujui / Cair', 'Ditolak') THEN
      NEW.reviewed_by := auth.uid();
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
-- receivables (kartu piutang)
-- ---------------------------------------------------------------------------

CREATE TABLE public.receivables (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      UUID NOT NULL UNIQUE
                        REFERENCES public.applications(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  principal           NUMERIC(14, 2) NOT NULL,
  provisi_fee         NUMERIC(14, 2) NOT NULL,
  monthly_admin_fee   NUMERIC(14, 2) NOT NULL,
  monthly_installment NUMERIC(14, 2) NOT NULL,
  tenure_months       INTEGER NOT NULL CHECK (tenure_months BETWEEN 1 AND 6),

  disbursed_on        DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Lunas')),
  paid_months         INTEGER NOT NULL DEFAULT 0 CHECK (paid_months >= 0),
  settled_at          TIMESTAMPTZ,

  remaining           NUMERIC(14, 2)
    GENERATED ALWAYS AS (
      GREATEST(principal - (monthly_installment * paid_months), 0)
    ) STORED,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT receivables_paid_within_tenure CHECK (paid_months <= tenure_months)
);

CREATE INDEX receivables_user_id_idx ON public.receivables (user_id);
CREATE INDEX receivables_status_idx ON public.receivables (status);
CREATE INDEX receivables_disbursed_on_idx ON public.receivables (disbursed_on DESC);

CREATE TRIGGER receivables_updated_at
  BEFORE UPDATE ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- ---------------------------------------------------------------------------
-- installments (rincian per bulan)
-- ---------------------------------------------------------------------------

CREATE TABLE public.installments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id  UUID NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_no       INTEGER NOT NULL CHECK (month_no BETWEEN 1 AND 6),
  due_date       DATE NOT NULL,
  amount         NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  status         TEXT NOT NULL DEFAULT 'Belum Dipotong'
                   CHECK (status IN ('Belum Dipotong', 'Sudah Dipotong')),
  paid_on        DATE,
  note           TEXT,
  updated_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reminder_sent_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (receivable_id, month_no)
);

CREATE INDEX installments_receivable_id_idx ON public.installments (receivable_id, month_no);
CREATE INDEX installments_user_id_idx ON public.installments (user_id);
CREATE INDEX installments_due_date_idx ON public.installments (due_date)
  WHERE status = 'Belum Dipotong';

CREATE TRIGGER installments_updated_at
  BEFORE UPDATE ON public.installments
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- ---------------------------------------------------------------------------
-- Disbursement opens a card and lays out every month up front
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.open_receivable_on_disbursement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_receivable_id UUID;
  v_disbursed_on  DATE;
  n               INTEGER;
BEGIN
  IF NEW.status <> 'Disetujui / Cair' OR OLD.status = 'Disetujui / Cair' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.receivables r WHERE r.application_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_disbursed_on := (COALESCE(NEW.disbursed_at, NOW()) AT TIME ZONE 'Asia/Makassar')::DATE;

  INSERT INTO public.receivables (
    application_id, user_id, principal, provisi_fee, monthly_admin_fee,
    monthly_installment, tenure_months, disbursed_on
  )
  VALUES (
    NEW.id, NEW.user_id, NEW.amount, NEW.provisi_fee, NEW.monthly_admin_fee,
    NEW.monthly_installment, NEW.tenure_months, v_disbursed_on
  )
  RETURNING id INTO v_receivable_id;

  -- Angsuran bulanan = pokok saja; biaya admin sudah dipotong saat pencairan.
  FOR n IN 1..NEW.tenure_months LOOP
    INSERT INTO public.installments (receivable_id, user_id, month_no, due_date, amount)
    VALUES (
      v_receivable_id,
      NEW.user_id,
      n,
      (v_disbursed_on + (n || ' month')::INTERVAL)::DATE,
      NEW.monthly_installment
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER applications_open_receivable
  AFTER UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.open_receivable_on_disbursement();

-- ---------------------------------------------------------------------------
-- Marking rows drives paid_months, card status and the application status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_receivable_progress()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_receivable_id UUID := COALESCE(NEW.receivable_id, OLD.receivable_id);
  v_paid          INTEGER;
  v_tenure        INTEGER;
  v_application   UUID;
  v_is_settled    BOOLEAN;
BEGIN
  SELECT COUNT(*) FILTER (WHERE i.status = 'Sudah Dipotong'), r.tenure_months, r.application_id
    INTO v_paid, v_tenure, v_application
  FROM public.receivables r
  LEFT JOIN public.installments i ON i.receivable_id = r.id
  WHERE r.id = v_receivable_id
  GROUP BY r.tenure_months, r.application_id;

  IF v_tenure IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_is_settled := v_paid >= v_tenure;

  UPDATE public.receivables
     SET paid_months = v_paid,
         status      = CASE WHEN v_is_settled THEN 'Lunas' ELSE 'Aktif' END,
         settled_at  = CASE WHEN v_is_settled THEN COALESCE(settled_at, NOW()) ELSE NULL END
   WHERE id = v_receivable_id;

  -- Trusted nested write: recognised by applications_guard_update() via
  -- pg_trigger_depth(). Kept to the two settlement states on purpose.
  UPDATE public.applications
     SET status = CASE WHEN v_is_settled THEN 'Lunas' ELSE 'Disetujui / Cair' END
   WHERE id = v_application
     AND status IN ('Disetujui / Cair', 'Lunas')
     AND status IS DISTINCT FROM (CASE WHEN v_is_settled THEN 'Lunas' ELSE 'Disetujui / Cair' END);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER installments_sync_progress
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.installments
  FOR EACH ROW EXECUTE FUNCTION public.sync_receivable_progress();

-- Only admins record salary deductions, and only on the mutable columns.
CREATE OR REPLACE FUNCTION public.guard_installment_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an admin can update installment rows';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.receivable_id IS DISTINCT FROM OLD.receivable_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.month_no IS DISTINCT FROM OLD.month_no
  THEN
    RAISE EXCEPTION 'installment identity fields are immutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.updated_by := auth.uid();
    NEW.paid_on := CASE
      WHEN NEW.status = 'Sudah Dipotong'
        THEN COALESCE(NEW.paid_on, (NOW() AT TIME ZONE 'Asia/Makassar')::DATE)
      ELSE NULL
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER installments_guard_update
  BEFORE UPDATE ON public.installments
  FOR EACH ROW EXECUTE FUNCTION public.guard_installment_update();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own card or all as admin" ON public.receivables
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "read own installments or all as admin" ON public.installments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "admin records deductions" ON public.installments
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cards and rows are created by the disbursement trigger only.
REVOKE ALL ON public.receivables FROM anon, authenticated;
REVOKE ALL ON public.installments FROM anon, authenticated;
GRANT SELECT ON public.receivables TO authenticated;
GRANT SELECT ON public.installments TO authenticated;
GRANT UPDATE (status, paid_on, note, due_date, amount) ON public.installments TO authenticated;
