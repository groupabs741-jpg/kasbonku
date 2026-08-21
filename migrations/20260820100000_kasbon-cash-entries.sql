-- Buku kas manual untuk sheet "Pencatatan" (arus kas dana kasbon).
--
-- Sebagian besar baris buku kas DITURUNKAN realtime di frontend dari data asli:
--   * KASBON keluar  = Σ principal per batch pencairan
--   * ADM 1/ADM 2 masuk = Σ provisi_fee / Σ (monthly_admin_fee × tenure) per batch
--   * KLAIM KASBON masuk = Σ angsuran "Sudah Dipotong", digabung per batch per bulan
-- Tabel ini HANYA menyimpan baris yang tidak ada di data receivables/installments:
-- suntikan MODAL, pembayaran FEE, dan koreksi manual. Saldo berjalan dihitung di
-- frontend dengan menggabung baris turunan + baris manual ini lalu diurut per tanggal.

CREATE TABLE public.cash_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date   DATE NOT NULL,
  description  TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('modal', 'fee', 'klaim', 'koreksi')),
  direction    TEXT NOT NULL CHECK (direction IN ('masuk', 'keluar')),
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  note         TEXT,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX cash_entries_entry_date_idx ON public.cash_entries (entry_date);

CREATE TRIGGER cash_entries_updated_at
  BEFORE UPDATE ON public.cash_entries
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: buku kas adalah data internal admin. Tidak ada baris per-pemohon, jadi
-- setiap policy cukup mengecek is_admin(). Tidak ada BEFORE-trigger guard di
-- sini, jadi konteks service (auth.uid() NULL dari CLI/migrasi) tetap bebas
-- lewat karena RLS di-bypass service — lihat memory guard-service-context.
-- ---------------------------------------------------------------------------

ALTER TABLE public.cash_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads cash entries" ON public.cash_entries
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin inserts cash entries" ON public.cash_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "admin updates cash entries" ON public.cash_entries
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admin deletes cash entries" ON public.cash_entries
  FOR DELETE TO authenticated
  USING (public.is_admin());

REVOKE ALL ON public.cash_entries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_entries TO authenticated;
