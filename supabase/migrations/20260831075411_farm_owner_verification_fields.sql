-- Farm Owner registration adds a farm location and a valid ID upload, which the
-- Admin reviews before approving the account.
--
-- Both columns are nullable: an Investor has no farm and uploads no ID.

alter table public.users
  add column if not exists farm_location text;

alter table public.users
  add column if not exists valid_id_url text;

comment on column public.users.valid_id_url is
  'Object path inside the private valid-ids storage bucket, not a public URL. The admin dashboard reads it through a short-lived signed URL.';

-- Carry the two new fields from the signup metadata into the profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_type text;
begin
  if new.email = public.admin_email() then
    resolved_type := 'Admin';
  elsif new.raw_user_meta_data ->> 'user_type' in ('Farm Owner', 'Investor') then
    resolved_type := new.raw_user_meta_data ->> 'user_type';
  else
    resolved_type := 'Farm Owner';
  end if;

  insert into public.users (
    users_id, name, email, contact_number, user_type,
    verification_status, verified_at, farm_location, valid_id_url
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'contact_number', ''),
    resolved_type,
    case when resolved_type = 'Admin' then 'Approved' else 'Pending' end,
    case when resolved_type = 'Admin' then now() else null end,
    case when resolved_type = 'Farm Owner' then new.raw_user_meta_data ->> 'farm_location' end,
    case when resolved_type = 'Farm Owner' then new.raw_user_meta_data ->> 'valid_id_url' end
  )
  on conflict (users_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Private storage bucket for the ID images
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'valid-ids',
  'valid-ids',
  false,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Uploads happen during signup, before the email is confirmed, so there is no
-- session yet: the anonymous role needs insert rights on this bucket. Reading is
-- not granted here, so an uploaded ID cannot be listed or downloaded by the
-- public - only the Admin policy below can read them.
drop policy if exists "Signup can upload a valid ID" on storage.objects;
create policy "Signup can upload a valid ID"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'valid-ids');

drop policy if exists "Admin reads valid IDs" on storage.objects;
create policy "Admin reads valid IDs"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'valid-ids' and public.is_admin());

drop policy if exists "Admin deletes valid IDs" on storage.objects;
create policy "Admin deletes valid IDs"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'valid-ids' and public.is_admin());
