-- A photo for every unit in the fleet.
--
-- The farm owner books equipment from a card, and a picture is what makes a unit
-- recognisable. Only the Admin uploads, because FarmVest owns the fleet.

alter table public.equipment
  add column if not exists image_url text;

comment on column public.equipment.image_url is
  'Public URL of the unit photo in the equipment-photos bucket. Stays NULL when no photo was uploaded, which is what the app tests to fall back to a placeholder.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'equipment-photos',
  'equipment-photos',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Anyone signed in browses the fleet, so the photos are public-read like avatars.
drop policy if exists "Equipment photos are publicly readable" on storage.objects;
create policy "Equipment photos are publicly readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'equipment-photos');

drop policy if exists "Admin uploads equipment photos" on storage.objects;
create policy "Admin uploads equipment photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'equipment-photos' and public.is_admin());

drop policy if exists "Admin replaces equipment photos" on storage.objects;
create policy "Admin replaces equipment photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'equipment-photos' and public.is_admin())
  with check (bucket_id = 'equipment-photos' and public.is_admin());

drop policy if exists "Admin deletes equipment photos" on storage.objects;
create policy "Admin deletes equipment photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'equipment-photos' and public.is_admin());
