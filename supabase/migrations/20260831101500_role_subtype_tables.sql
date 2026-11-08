-- Split the two acting roles out of users into their own tables.
--
-- users stays the account supertype: identity, contact, role, verification. The
-- things only a farm owner has (farm address, government ID) move to
-- farm_owners, and investor preferences live in investors. Every other table now
-- points at one of those two subtypes instead of at users, so users is reached
-- only through farm_owners and investors.
--
-- The Admin deliberately has no subtype table: it is a platform account, not a
-- party to a transaction. That is why reports and reviews carry one nullable
-- column per side rather than a single users reference.

-- ---------------------------------------------------------------------------
-- Subtype tables
-- ---------------------------------------------------------------------------

-- The address parts were missing on the remote database even though the
-- migration that adds them is recorded as applied, so they are re-added here
-- before the copy below reads them. Both statements are no-ops when the columns
-- are already there.
alter table public.users add column if not exists farm_location text;
alter table public.users add column if not exists farm_province text;
alter table public.users add column if not exists farm_city text;
alter table public.users add column if not exists farm_barangay text;
alter table public.users add column if not exists valid_id_type text;
alter table public.users add column if not exists valid_id_url text;

create table if not exists public.farm_owners (
  -- Shares the primary key with users, so one account is at most one farm owner.
  farm_owners_id uuid primary key references public.users (users_id) on delete cascade,
  farm_location  text,
  farm_province  text,
  farm_city      text,
  farm_barangay  text,
  valid_id_type  text,
  valid_id_url   text,
  created_at     timestamptz not null default now()
);

comment on table public.farm_owners is
  'Farm owner side of an account: farm address and the government ID the Admin verifies.';

create table if not exists public.investors (
  investors_id      uuid primary key references public.users (users_id) on delete cascade,
  -- Budget and risk appetite are what the investment recommendation AI reads.
  investment_budget numeric(12, 2) check (investment_budget >= 0),
  risk_appetite     text not null default 'Medium'
                      check (risk_appetite in ('Low', 'Medium', 'High')),
  created_at        timestamptz not null default now()
);

comment on table public.investors is
  'Investor side of an account, including the budget and risk appetite used by the recommendation AI.';

-- Carry the existing accounts over before the columns are dropped.
insert into public.farm_owners (
  farm_owners_id, farm_location, farm_province, farm_city, farm_barangay, valid_id_type, valid_id_url
)
select users_id, farm_location, farm_province, farm_city, farm_barangay, valid_id_type, valid_id_url
from public.users
where user_type = 'Farm Owner'
on conflict (farm_owners_id) do nothing;

insert into public.investors (investors_id)
select users_id
from public.users
where user_type = 'Investor'
on conflict (investors_id) do nothing;

alter table public.users
  drop column if exists farm_location,
  drop column if exists farm_province,
  drop column if exists farm_city,
  drop column if exists farm_barangay,
  drop column if exists valid_id_type,
  drop column if exists valid_id_url;

-- ---------------------------------------------------------------------------
-- Drop every foreign key that still points at users
-- ---------------------------------------------------------------------------

-- Constraint names were fixed when the columns were first created and did not
-- follow the later renames, so they are looked up rather than spelled out.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select con.conname, con.conrelid::regclass as table_name
    from pg_constraint con
    where con.contype = 'f'
      and con.confrelid = 'public.users'::regclass
      and con.conrelid in (
        'public.projects'::regclass,
        'public.rentals'::regclass,
        'public.investments'::regclass,
        'public.reports'::regclass,
        'public.reviews'::regclass
      )
  loop
    execute format('alter table %s drop constraint %I', constraint_row.table_name, constraint_row.conname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- projects and rentals belong to a farm owner
-- ---------------------------------------------------------------------------

alter table public.projects rename column users_id to farm_owners_id;
alter index if exists projects_users_id_idx rename to projects_farm_owners_id_idx;

alter table public.projects
  add constraint projects_farm_owners_id_fkey
  foreign key (farm_owners_id) references public.farm_owners (farm_owners_id) on delete cascade;

alter table public.rentals rename column users_id to farm_owners_id;
alter index if exists rentals_users_id_idx rename to rentals_farm_owners_id_idx;

alter table public.rentals
  add constraint rentals_farm_owners_id_fkey
  foreign key (farm_owners_id) references public.farm_owners (farm_owners_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- investments belong to an investor
-- ---------------------------------------------------------------------------

alter table public.investments rename column users_id to investors_id;
alter index if exists investments_users_id_idx rename to investments_investors_id_idx;

alter table public.investments
  add constraint investments_investors_id_fkey
  foreign key (investors_id) references public.investors (investors_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- reports and reviews: one nullable column per side
-- ---------------------------------------------------------------------------

-- The policies read the columns that are about to be replaced, so they go first.
drop policy if exists "Reporters read their own reports" on public.reports;
drop policy if exists "Users file their own reports" on public.reports;
drop policy if exists "Users write their own reviews" on public.reviews;

alter table public.reports
  add column if not exists reporter_farm_owners_id uuid references public.farm_owners (farm_owners_id) on delete cascade,
  add column if not exists reporter_investors_id   uuid references public.investors (investors_id) on delete cascade,
  add column if not exists reported_farm_owners_id uuid references public.farm_owners (farm_owners_id) on delete cascade,
  add column if not exists reported_investors_id   uuid references public.investors (investors_id) on delete cascade;

-- Each side resolves independently: the old column held a users_id, and the
-- subtype tables share that value as their own primary key.
update public.reports r
set reporter_farm_owners_id =
      (select fo.farm_owners_id from public.farm_owners fo where fo.farm_owners_id = r.reporter_users_id),
    reporter_investors_id =
      (select i.investors_id from public.investors i where i.investors_id = r.reporter_users_id),
    reported_farm_owners_id =
      (select fo.farm_owners_id from public.farm_owners fo where fo.farm_owners_id = r.reported_users_id),
    reported_investors_id =
      (select i.investors_id from public.investors i where i.investors_id = r.reported_users_id);

alter table public.reports
  drop column if exists reporter_users_id,
  drop column if exists reported_users_id;

-- Exactly one side each, so a report always has one identifiable reporter and
-- one identifiable subject.
alter table public.reports
  add constraint reports_one_reporter_check
  check (num_nonnulls(reporter_farm_owners_id, reporter_investors_id) = 1);

alter table public.reports
  add constraint reports_one_reported_check
  check (num_nonnulls(reported_farm_owners_id, reported_investors_id) = 1);

alter table public.reviews
  add column if not exists reviewer_farm_owners_id uuid references public.farm_owners (farm_owners_id) on delete cascade,
  add column if not exists reviewer_investors_id   uuid references public.investors (investors_id) on delete cascade,
  add column if not exists reviewee_farm_owners_id uuid references public.farm_owners (farm_owners_id) on delete cascade,
  add column if not exists reviewee_investors_id   uuid references public.investors (investors_id) on delete cascade;

update public.reviews rv
set reviewer_farm_owners_id =
      (select fo.farm_owners_id from public.farm_owners fo where fo.farm_owners_id = rv.reviewer_users_id),
    reviewer_investors_id =
      (select i.investors_id from public.investors i where i.investors_id = rv.reviewer_users_id),
    reviewee_farm_owners_id =
      (select fo.farm_owners_id from public.farm_owners fo where fo.farm_owners_id = rv.reviewee_users_id),
    reviewee_investors_id =
      (select i.investors_id from public.investors i where i.investors_id = rv.reviewee_users_id);

alter table public.reviews
  drop column if exists reviewer_users_id,
  drop column if exists reviewee_users_id;

alter table public.reviews
  add constraint reviews_one_reviewer_check
  check (num_nonnulls(reviewer_farm_owners_id, reviewer_investors_id) = 1);

alter table public.reviews
  add constraint reviews_one_reviewee_check
  check (num_nonnulls(reviewee_farm_owners_id, reviewee_investors_id) = 1);

-- ---------------------------------------------------------------------------
-- Signup trigger writes the subtype row
-- ---------------------------------------------------------------------------

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

  if resolved_type = 'Farm Owner' then
    insert into public.farm_owners (
      farm_owners_id, farm_location, farm_province, farm_city, farm_barangay,
      valid_id_type, valid_id_url
    )
    values (
      new.id,
      new.raw_user_meta_data ->> 'farm_location',
      new.raw_user_meta_data ->> 'farm_province',
      new.raw_user_meta_data ->> 'farm_city',
      new.raw_user_meta_data ->> 'farm_barangay',
      new.raw_user_meta_data ->> 'valid_id_type',
      new.raw_user_meta_data ->> 'valid_id_url'
    )
    on conflict (farm_owners_id) do nothing;

  elsif resolved_type = 'Investor' then
    insert into public.investors (investors_id)
    values (new.id)
    on conflict (investors_id) do nothing;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.farm_owners enable row level security;
alter table public.investors   enable row level security;

-- A farm owner row is readable by any signed-in user, the same as the profile it
-- extends: an investor has to see whose project they are funding.
create policy "Authenticated users read farm owners"
  on public.farm_owners for select to authenticated using (true);

create policy "Farm owners write their own row"
  on public.farm_owners for all to authenticated
  using (auth.uid() = farm_owners_id)
  with check (auth.uid() = farm_owners_id);

create policy "Admin manages farm owners"
  on public.farm_owners for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Investor preferences are private: nobody browses them, so only the owner and
-- the Admin can read them.
create policy "Investors read their own row"
  on public.investors for select to authenticated
  using (auth.uid() = investors_id);

create policy "Investors write their own row"
  on public.investors for all to authenticated
  using (auth.uid() = investors_id)
  with check (auth.uid() = investors_id);

create policy "Admin manages investors"
  on public.investors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The subtype primary key carries the same value as users_id, so the ownership
-- checks below still compare against auth.uid().
create policy "Reporters read their own reports"
  on public.reports for select to authenticated
  using (auth.uid() in (reporter_farm_owners_id, reporter_investors_id));

create policy "Users file their own reports"
  on public.reports for insert to authenticated
  with check (auth.uid() in (reporter_farm_owners_id, reporter_investors_id));

create policy "Users write their own reviews"
  on public.reviews for insert to authenticated
  with check (auth.uid() in (reviewer_farm_owners_id, reviewer_investors_id));
