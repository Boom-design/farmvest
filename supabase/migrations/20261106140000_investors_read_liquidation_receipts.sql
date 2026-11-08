-- Investors may see the receipts behind the liquidation of a project they
-- funded, and nothing else in the private project-documents bucket.
--
-- Receipts are filed at {farm owner}/liquidation/{project id}/{file}, so the
-- policy matches only that folder and only for a project the reader holds an
-- investment in. The farm owner's credentials, IDs and collateral papers sit
-- in other folders and stay with the farm owner and the Admin.
drop policy if exists "Investors read liquidation receipts of what they funded" on storage.objects;
create policy "Investors read liquidation receipts of what they funded"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-documents'
    and (storage.foldername(name))[2] = 'liquidation'
    and exists (
      select 1 from public.investments i
      where i.customers_id = auth.uid()
        and i.projects_id::text = (storage.foldername(name))[3]
    )
  );
