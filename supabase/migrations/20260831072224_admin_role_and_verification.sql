-- Give the Admin a real role in the database and add account verification.
--
-- The Admin still signs in with credentials hardcoded in the app, but those
-- credentials now belong to an actual Supabase Auth user. Without a session the
-- Admin has no auth.uid(), so row level security would hide every row from the
-- admin dashboard.
--
-- Account verification is the Admin's anti-fraud step: new sign-ups land as
-- Pending and cannot use the app until they are Approved.

-- ---------------------------------------------------------------------------
-- users: allow the Admin role and track verification
-- ---------------------------------------------------------------------------

alter table public.users drop constraint if exists users_user_type_check;

alter table public.users
  add constraint users_user_type_check
  check (user_type in ('Farm Owner', 'Investor', 'Admin'));

alter table public.users
  add column if not exists verification_status text not null default 'Pending'
    check (verification_status in ('Pending', 'Approved', 'Rejected'));

alter table public.users
  add column if not exists verified_at timestamptz;

-- ---------------------------------------------------------------------------
-- Admin detection
-- ---------------------------------------------------------------------------

-- The email that receives the Admin role. Kept in one place so the app and the
-- database agree on who the Admin is.
create or replace function public.admin_email()
returns text
language sql
immutable
as $$
  select 'admin@farmvest.com';
$$;

-- Security definer so the lookup bypasses row level security on users, which
-- would otherwise recurse while evaluating the policies below.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.users_id = auth.uid()
      and u.user_type = 'Admin'
  );
$$;

-- The Admin account is created once in the Supabase dashboard; this trigger
-- gives it the Admin role and skips verification for it.
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
    users_id, name, email, contact_number, user_type, verification_status, verified_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'contact_number', ''),
    resolved_type,
    case when resolved_type = 'Admin' then 'Approved' else 'Pending' end,
    case when resolved_type = 'Admin' then now() else null end
  )
  on conflict (users_id) do nothing;

  return new;
end;
$$;

-- Promote the Admin account if it was created before this migration ran.
update public.users
set user_type = 'Admin',
    verification_status = 'Approved',
    verified_at = coalesce(verified_at, now())
where email = public.admin_email();

-- ---------------------------------------------------------------------------
-- Admin policies: full access to every table
-- ---------------------------------------------------------------------------

create policy "Admin manages users"
  on public.users for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Admin manages projects"
  on public.projects for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Admin manages investments"
  on public.investments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Admin manages progress updates"
  on public.progress_updates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Admin manages equipment"
  on public.equipment for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Admin manages rentals"
  on public.rentals for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Admin manages reports"
  on public.reports for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Admin manages reviews"
  on public.reviews for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
