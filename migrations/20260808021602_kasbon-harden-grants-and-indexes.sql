-- Advisor findings.
--
-- 1. SECURITY DEFINER functions reachable by `anon`. PostgreSQL grants EXECUTE
--    to PUBLIC on every new function, and PostgREST publishes public functions
--    as RPC — so `is_admin()` and `ensure_profile()` were callable without a
--    session. Neither leaks anything today (both key off auth.uid() and return
--    false / raise for an anonymous caller), but there is no reason to expose
--    them. Revoke PUBLIC, then grant back only what each caller needs.
--
--    `is_admin()` must stay executable by `authenticated`: it is evaluated
--    inside the RLS policies on the app tables and on storage.objects. Those
--    policies are all TO authenticated, so `anon` never needs it.
--
-- 2. Foreign keys without an index. These columns are only read on detail
--    screens today, but an unindexed FK also makes every DELETE on the parent
--    scan the child table — which is exactly what happens when an employee
--    account is removed.

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_stats() TO authenticated;

-- Pure formatting/lookup helpers: no data access, but keep them off the
-- anonymous RPC surface anyway.
REVOKE EXECUTE ON FUNCTION public.kasbon_limit(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.format_rupiah(NUMERIC) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.format_tanggal(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kasbon_limit(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.format_rupiah(NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.format_tanggal(DATE) TO authenticated;

CREATE INDEX IF NOT EXISTS applications_reviewed_by_idx
  ON public.applications (reviewed_by);
CREATE INDEX IF NOT EXISTS application_events_actor_id_idx
  ON public.application_events (actor_id);
CREATE INDEX IF NOT EXISTS documents_uploaded_by_idx
  ON public.documents (uploaded_by);
CREATE INDEX IF NOT EXISTS installments_updated_by_idx
  ON public.installments (updated_by);
CREATE INDEX IF NOT EXISTS notifications_application_id_idx
  ON public.notifications (application_id);
CREATE INDEX IF NOT EXISTS notifications_installment_id_idx
  ON public.notifications (installment_id);
