-- Profile table for FarmVest users.
-- Passwords and sign-in are handled entirely by Supabase Auth (auth.users);
-- this table only stores the profile data collected at registration.
-- The old dashboard-created table used a standalone id, so it is rebuilt here
-- with id as a foreign key to auth.users.

drop table if exists public.users cascade;

create table public.users (
  id             uuid primary key references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  name           text not null,
  email          text not null unique,
  contact_number text not null,
  user_type      text not null check (user_type in ('Farm Owner', 'Investor'))
);

comment on table public.users is
  'Profile data for Farm Owners and Investors. The Admin account is hardcoded in the app and is not stored here.';

alter table public.users enable row level security;

-- Any signed-in user may read profiles, so project and rental listings can show
-- the other party's name and contact details.
create policy "Authenticated users can read profiles"
  on public.users for select
  to authenticated
  using (true);

create policy "Users can create their own profile"
  on public.users for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.users for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
