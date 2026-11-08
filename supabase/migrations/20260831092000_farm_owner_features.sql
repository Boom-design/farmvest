-- Schema support for the Farm Owner side of the app.
--
--   My Projects       - a posted project must stay invisible to investors until
--                       the Admin approves it, so the browse policy is tightened
--   Progress Updates  - photos need a storage bucket of their own
--   Rent Equipment    - the availability calendar has to know which dates are
--                       already taken, without exposing who booked them
--   My Rentals        - a farm owner may cancel a booking the Admin has not
--                       acted on yet

-- ---------------------------------------------------------------------------
-- Projects: hide unapproved projects from everyone but their owner
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can read projects" on public.projects;

create policy "Authenticated users read approved projects"
  on public.projects for select to authenticated
  using (
    status not in ('Pending Approval', 'Rejected')
    or auth.uid() = users_id
  );

-- ---------------------------------------------------------------------------
-- Rentals: the farm owner cancels, the Admin does everything else
-- ---------------------------------------------------------------------------

-- Limited to a booking the Admin has not acted on yet: once it is Confirmed or
-- Active the equipment is already committed, so cancelling becomes an Admin call.
create policy "Farm owners cancel their own pending rentals"
  on public.rentals for update to authenticated
  using (auth.uid() = users_id and status = 'Pending')
  with check (auth.uid() = users_id and status in ('Pending', 'Cancelled'));

-- Booked date ranges for the availability calendar. The view deliberately drops
-- users_id: a farm owner needs to know a unit is taken, not who took it. A plain
-- view is not security_invoker, so it reads rentals as its owner and is not
-- blocked by the owner-only policy on that table.
create or replace view public.equipment_bookings as
  select
    rentals_id,
    equipment_id,
    start_date,
    end_date,
    status
  from public.rentals
  where status in (
    'Pending',
    'Confirmed',
    'Active',
    'Rescheduled',
    'On Hold - Weather Advisory'
  );

comment on view public.equipment_bookings is
  'Occupied date ranges per equipment unit, with the renter hidden. Feeds the availability check on the Rent Equipment page.';

grant select on public.equipment_bookings to authenticated;

-- ---------------------------------------------------------------------------
-- Progress updates: photo storage
-- ---------------------------------------------------------------------------

-- Progress photos are evidence shown to investors, so the bucket is public-read
-- like avatars. Writes stay inside the uploading user's own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'progress-photos',
  'progress-photos',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Files are stored as <users_id>/<filename>, so the first path segment decides
-- who may write.
drop policy if exists "Farm owners upload their own progress photos" on storage.objects;
create policy "Farm owners upload their own progress photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Farm owners delete their own progress photos" on storage.objects;
create policy "Farm owners delete their own progress photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Progress photos are publicly readable" on storage.objects;
create policy "Progress photos are publicly readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'progress-photos');
