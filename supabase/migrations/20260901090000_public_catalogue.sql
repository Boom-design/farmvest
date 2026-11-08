-- The public catalogue behind the landing page.
--
-- A visitor who has not signed in is the PostgREST role `anon`, and every read
-- policy on projects and equipment is granted `to authenticated`. That is
-- correct for the dashboards, but it left the landing page with nothing to
-- show: a marketplace whose front door is empty has nothing to sell.
--
-- Rather than open the tables to `anon`, the landing page reads two views. A
-- plain view is not security_invoker, so it runs as its owner and is not
-- stopped by the policies above -- which makes the view's own select list the
-- security boundary. Everything a signed-out visitor must not see is simply
-- not selected: no farm_owners_id, no owner name, address or contact, no
-- condition notes, and no project that is unapproved, rejected or frozen.
--
-- What stays behind the login is therefore real, not decorative: the full
-- description, the farm owner profile, the progress photos, the milestone
-- breakdown, and every write action.

-- ---------------------------------------------------------------------------
-- projects: a category to browse by, and a cover photo to browse with
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists category text not null default 'Other';

alter table public.projects
  add column if not exists image_url text;

do $$
begin
  alter table public.projects
    add constraint projects_category_check
    check (category in ('Poultry', 'Swine', 'Cattle', 'Goat', 'Fish', 'Other'));
exception
  when duplicate_object then null;
end;
$$;

comment on column public.projects.category is
  'Livestock category the landing page and the investor browser filter by.';

comment on column public.projects.image_url is
  'Public URL of the cover photo in the project-photos bucket. NULL when the owner uploaded none, which the app tests to fall back to a category placeholder.';

-- ---------------------------------------------------------------------------
-- project-photos bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-photos',
  'project-photos',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public-read, because the cover is the one thing the landing page shows a
-- visitor who has no session at all.
drop policy if exists "Project photos are publicly readable" on storage.objects;
create policy "Project photos are publicly readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'project-photos');

-- Writing stays with the owner of the project and the Admin. The first path
-- segment is the farm owner's id, so nobody can overwrite another owner's
-- cover photo.
drop policy if exists "Farm owners upload their project photos" on storage.objects;
create policy "Farm owners upload their project photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "Farm owners replace their project photos" on storage.objects;
create policy "Farm owners replace their project photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'project-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  )
  with check (
    bucket_id = 'project-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "Farm owners delete their project photos" on storage.objects;
create policy "Farm owners delete their project photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'project-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- ---------------------------------------------------------------------------
-- public_projects
-- ---------------------------------------------------------------------------

-- Dropped rather than replaced: create or replace refuses a changed column list.
drop view if exists public.public_projects;

create view public.public_projects as
  select
    p.projects_id,
    p.title,
    p.category,
    p.risk_level,
    p.funding_goal,
    p.current_funding,
    p.status,
    p.image_url,
    p.created_at
  from public.projects p
  where p.status in ('Open', 'Funded', 'In Progress');

comment on view public.public_projects is
  'Teaser row for the landing page: what a project is and how far it is funded, and nothing that identifies the farm owner. Unapproved, rejected and frozen projects never appear.';

grant select on public.public_projects to anon, authenticated;

-- ---------------------------------------------------------------------------
-- public_equipment
-- ---------------------------------------------------------------------------

drop view if exists public.public_equipment;

create view public.public_equipment as
  select
    e.equipment_id,
    e.name,
    e.type,
    e.price_per_day,
    e.availability_status,
    e.image_url,
    e.created_at
  from public.equipment e;

comment on view public.public_equipment is
  'Teaser row for the landing page. condition_notes is left out on purpose: it carries the damage and repair history of the unit.';

grant select on public.public_equipment to anon, authenticated;
