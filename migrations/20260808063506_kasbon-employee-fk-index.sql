-- allowed_employees.invited_by references auth.users tanpa index, jadi setiap
-- penghapusan akun admin harus memindai seluruh tabel karyawan (FK-nya
-- ON DELETE SET NULL).

CREATE INDEX IF NOT EXISTS allowed_employees_invited_by_idx
  ON public.allowed_employees (invited_by);
