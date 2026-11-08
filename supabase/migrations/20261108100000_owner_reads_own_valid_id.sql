-- A customer may view the ID they submitted, from My Account. Only the one file
-- recorded on their own users row is readable to them; every other ID stays with
-- its owner and the Admin.
drop policy if exists "Owners read their own valid ID" on storage.objects;
create policy "Owners read their own valid ID"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'valid-ids'
    and exists (
      select 1 from public.users u
      where u.users_id = auth.uid() and u.valid_id_url = storage.objects.name
    )
  );
