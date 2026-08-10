-- PostgREST derives embedded resources from foreign keys. user_id already
-- points at auth.users, which is not exposed over the data API, so the admin
-- list could not pull the applicant's name in the same request. A second FK to
-- public.profiles makes `select('*, profiles(...)')` work and enforces that
-- every application belongs to a user who has completed ensure_profile().

ALTER TABLE public.applications
  ADD CONSTRAINT applications_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.receivables
  ADD CONSTRAINT receivables_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.installments
  ADD CONSTRAINT installments_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
