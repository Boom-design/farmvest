-- Clear every non-admin account.
--
-- A one-off data deletion in migration history is not good practice, and it is
-- here only because the CLI offers no other way to reach the database. It is
-- written to be harmless on a fresh environment, where there is nothing to
-- delete.
--
-- Deleting from auth.users is deliberate. The profile row in public.users is a
-- foreign key onto it with ON DELETE CASCADE, and everything else hangs off
-- that: customers, projects, project_documents, investments, rentals, payments,
-- contracts, progress_updates, reports and reviews all go with it. Deleting
-- public.users alone would leave an auth account that can still sign in and has
-- no profile to load.
--
-- Storage objects are not touched. The files in valid-ids, project-photos,
-- progress-photos, payment-proofs, project-documents and avatars outlive the
-- rows that referenced them, and are cleared from the Storage browser instead:
-- removing a storage.objects row from SQL orphans the blob rather than freeing
-- it.
--
-- public.equipment survives on purpose. FarmVest owns the fleet, so no unit
-- belongs to a customer, and re-entering the whole fleet would be the only
-- result of deleting it.

delete from auth.users
where email <> public.admin_email();
