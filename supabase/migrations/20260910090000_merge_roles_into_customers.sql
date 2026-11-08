-- One customer, both sides of the marketplace.
--
-- Farm Owner and Investor were separate roles with separate accounts, and that
-- was wrong about the people using it. A farm owner who has a good year has
-- money to put into someone else's project, and an investor who buys land
-- becomes a farm owner. Forcing them to hold two accounts, verify the same
-- government ID twice, and sign in twice to do both is a rule the product
-- invented rather than one the business has.
--
-- So there is one non-admin role now: Customer. The same person can post a
-- project, rent equipment, and fund somebody else's project, from one account
-- and one verified identity.
--
-- Schema-wise that means the two subtype tables become one. farm_owners is
-- renamed rather than rebuilt, because a rename carries every policy, foreign
-- key, index and view definition with it -- Postgres rewrites the dependents
-- itself -- while a drop and recreate would mean restating twenty policies by
-- hand and getting one of them subtly wrong.
--
-- investors held exactly one column worth keeping, so it moves across and the
-- table goes.

-- ---------------------------------------------------------------------------
-- farm_owners becomes customers
-- ---------------------------------------------------------------------------

alter table public.farm_owners rename to customers;
alter table public.customers rename column farm_owners_id to customers_id;

alter table public.projects rename column farm_owners_id to customers_id;
alter table public.rentals  rename column farm_owners_id to customers_id;

comment on table public.customers is
  'The non-admin side of an account. Holds the farm address for someone who farms and the investment budget for someone who invests; the same person may do both, and either half may be empty.';

-- ---------------------------------------------------------------------------
-- The investor half moves in
-- ---------------------------------------------------------------------------

alter table public.customers
  add column if not exists investment_budget numeric(12, 2) check (investment_budget >= 0);

comment on column public.customers.investment_budget is
  'What this customer is willing to put into a project. Null until they set one, and nothing is scored by the recommender until they do.';

update public.customers c
set investment_budget = i.investment_budget
from public.investors i
where i.investors_id = c.customers_id
  and i.investment_budget is not null;

-- Anyone who registered as an Investor has no customers row yet, because the
-- signup trigger only created one for a Farm Owner. They get one now, or their
-- account would work for nothing.
insert into public.customers (customers_id, investment_budget)
select i.investors_id, i.investment_budget
from public.investors i
where not exists (
  select 1 from public.customers c where c.customers_id = i.investors_id
)
on conflict (customers_id) do nothing;

-- ---------------------------------------------------------------------------
-- investments point at customers
-- ---------------------------------------------------------------------------

alter table public.investments rename column investors_id to customers_id;

alter table public.investments drop constraint if exists investments_investors_id_fkey;

alter table public.investments
  add constraint investments_customers_id_fkey
  foreign key (customers_id) references public.customers (customers_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- reports and reviews: four party columns become two
-- ---------------------------------------------------------------------------

-- Each of these tables carried the split twice over: a reporter could be a farm
-- owner or an investor, and so could the subject, so one report needed four
-- columns and a check constraint to enforce that exactly one of each pair was
-- filled. With a single role the pair collapses, the constraint has nothing
-- left to guard, and the column can simply be NOT NULL.

-- These read the columns being dropped, so they go first and are restated
-- against the merged column below.
drop policy if exists "Reporters read their own reports" on public.reports;
drop policy if exists "Users file their own reports" on public.reports;
drop policy if exists "Users write their own reviews" on public.reviews;

alter table public.reports drop constraint if exists reports_one_reporter_check;
alter table public.reports drop constraint if exists reports_one_reported_check;
alter table public.reviews drop constraint if exists reviews_one_reviewer_check;
alter table public.reviews drop constraint if exists reviews_one_reviewee_check;

-- The two halves never overlapped, so coalescing them loses nothing. Safe only
-- because every former investor now has a customers row, inserted above.
update public.reports
set reporter_farm_owners_id = coalesce(reporter_farm_owners_id, reporter_investors_id),
    reported_farm_owners_id = coalesce(reported_farm_owners_id, reported_investors_id);

update public.reviews
set reviewer_farm_owners_id = coalesce(reviewer_farm_owners_id, reviewer_investors_id),
    reviewee_farm_owners_id = coalesce(reviewee_farm_owners_id, reviewee_investors_id);

alter table public.reports
  drop column if exists reporter_investors_id,
  drop column if exists reported_investors_id;

alter table public.reviews
  drop column if exists reviewer_investors_id,
  drop column if exists reviewee_investors_id;

alter table public.reports rename column reporter_farm_owners_id to reporter_customers_id;
alter table public.reports rename column reported_farm_owners_id to reported_customers_id;
alter table public.reviews rename column reviewer_farm_owners_id to reviewer_customers_id;
alter table public.reviews rename column reviewee_farm_owners_id to reviewee_customers_id;

-- A report with no reporter, or a review with no author, was already impossible
-- under the old check. Now the column itself says so.
alter table public.reports
  alter column reporter_customers_id set not null,
  alter column reported_customers_id set not null;

alter table public.reviews
  alter column reviewer_customers_id set not null,
  alter column reviewee_customers_id set not null;

-- One column each now, so the policies say plainly what they always meant.
create policy "Reporters read their own reports"
  on public.reports for select to authenticated
  using (auth.uid() = reporter_customers_id);

create policy "Users file their own reports"
  on public.reports for insert to authenticated
  with check (auth.uid() = reporter_customers_id);

create policy "Users write their own reviews"
  on public.reviews for insert to authenticated
  with check (auth.uid() = reviewer_customers_id);

-- ---------------------------------------------------------------------------
-- The investor table has nothing left in it
-- ---------------------------------------------------------------------------

drop table if exists public.investors;

-- ---------------------------------------------------------------------------
-- One role
-- ---------------------------------------------------------------------------

-- The constraint has to go before the rows move: it still only admits the two
-- old values, so the update would fail against it.
alter table public.users drop constraint if exists users_user_type_check;

update public.users
set user_type = 'Customer'
where user_type in ('Farm Owner', 'Investor');

alter table public.users
  add constraint users_user_type_check check (user_type in ('Customer', 'Admin'));

comment on column public.users.user_type is
  'Customer or Admin. The Farm Owner and Investor split is gone: one account does both, because the same person often is both.';

-- ---------------------------------------------------------------------------
-- The signup trigger
-- ---------------------------------------------------------------------------

-- Registration no longer asks which side you are on, so there is no branch. It
-- also no longer asks for a farm address: someone who only wants to invest has
-- no farm, and someone who does will be asked when they post their first
-- project. Everyone gets a customers row, empty on both halves.
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
  else
    resolved_type := 'Customer';
  end if;

  insert into public.users (
    users_id, name, email, contact_number, user_type, verification_status, verified_at,
    suspended_reason, valid_id_type, valid_id_url
  )
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), 'None'),
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'contact_number'), ''), 'None'),
    resolved_type,
    case when resolved_type = 'Admin' then 'Approved' else 'Pending' end,
    case when resolved_type = 'Admin' then now() else null end,
    'None',
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'valid_id_type'), ''), 'None'),
    -- Left NULL when no file was uploaded: the app tests this to decide
    -- whether there is an ID to open.
    nullif(btrim(new.raw_user_meta_data ->> 'valid_id_url'), '')
  )
  on conflict (users_id) do nothing;

  if resolved_type = 'Customer' then
    insert into public.customers (
      customers_id, farm_location, farm_province, farm_city, farm_barangay
    )
    values (new.id, 'None', 'None', 'None', 'None')
    on conflict (customers_id) do nothing;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The two views that name the old role
-- ---------------------------------------------------------------------------

-- Renamed rather than replaced: the rename above already rewrote their column
-- references, so only the names are stale.
alter view if exists public.farm_owner_directory rename to customer_directory;
alter view if exists public.farm_owner_track_record rename to customer_track_record;

comment on view public.customer_directory is
  'Public half of a customer profile for browsing: name and area only. The address detail and the government ID stay behind the customers policy.';

comment on view public.customer_track_record is
  'Aggregate record of what a customer has finished as a farm owner: counts, dates and ratings, never the underlying rows. This is what the recommendation engine scores a project on.';

grant select on public.customer_directory to authenticated;
grant select on public.customer_track_record to authenticated;

-- ---------------------------------------------------------------------------
-- Investing in your own project
-- ---------------------------------------------------------------------------

-- This check existed before but could never fire: the two sides were different
-- accounts. Now that one account can do both it is the rule that actually
-- matters, so the function is restated against the merged table.
create or replace function public.invest_in_project(
  p_projects_id     uuid,
  p_amount          numeric,
  p_signatory_name  text,
  p_terms_snapshot  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minimum   constant numeric := 500;
  v_project   public.projects%rowtype;
  v_remaining numeric;
  v_investor  uuid := auth.uid();
  v_new_id    uuid;
begin
  if v_investor is null then
    raise exception 'Sign in to invest.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;

  if coalesce(btrim(p_signatory_name), '') = '' then
    raise exception 'Type your full name to sign the agreement.';
  end if;

  -- Checked here rather than trusted from the client, because this function
  -- runs as its owner and so bypasses the row level security that would
  -- otherwise catch it.
  if not exists (
    select 1
    from public.customers c
    join public.users u on u.users_id = c.customers_id
    where c.customers_id = v_investor
      and u.account_status = 'Active'
      and u.verification_status = 'Approved'
  ) then
    raise exception 'Your account is not approved yet.';
  end if;

  -- for update is the whole point of doing this in the database: it holds the
  -- row until this transaction commits, so a second investor arriving at the
  -- same moment waits and then re-reads a total that already includes the first.
  select * into v_project
  from public.projects
  where projects_id = p_projects_id
  for update;

  if not found then
    raise exception 'That project no longer exists.';
  end if;

  if v_project.status not in ('Open', 'Funded', 'In Progress') then
    raise exception 'That project is not accepting investment right now.';
  end if;

  if v_project.customers_id = v_investor then
    raise exception 'You cannot invest in your own project.';
  end if;

  v_remaining := v_project.funding_goal - v_project.current_funding;

  if v_remaining <= 0 then
    raise exception 'This project is already fully funded.';
  end if;

  if p_amount > v_remaining then
    raise exception 'Only % remains on this project.', to_char(v_remaining, 'FM999,999,999.00');
  end if;

  -- Below the floor is allowed only when it closes the project out, otherwise a
  -- final small balance would be unreachable by anyone.
  if p_amount < v_minimum and p_amount <> v_remaining then
    raise exception 'The smallest investment is %. You may also take the remaining % to finish this project.',
      to_char(v_minimum, 'FM999,999,999.00'),
      to_char(v_remaining, 'FM999,999,999.00');
  end if;

  insert into public.investments (customers_id, projects_id, amount)
  values (v_investor, p_projects_id, p_amount)
  returning investments_id into v_new_id;

  insert into public.contracts (investments_id, signatory_name, terms_snapshot, agreed_amount)
  values (v_new_id, btrim(p_signatory_name), p_terms_snapshot, p_amount);

  update public.projects
  set current_funding = current_funding + p_amount,
      status = case
                 when status = 'Open' and current_funding + p_amount >= funding_goal
                   then 'Funded'
                 else status
               end
  where projects_id = p_projects_id;

  return v_new_id;
end;
$$;

comment on function public.invest_in_project(uuid, numeric, text, text) is
  'Records one investment, its signed contract, and the project total as a single transaction. Locks the project row first, so concurrent investors cannot together overfund it. Enforces a PHP 500 minimum, waived only for an amount that exactly closes the remaining balance, and refuses an investment in the caller''s own project.';

revoke all on function public.invest_in_project(uuid, numeric, text, text) from public;
grant execute on function public.invest_in_project(uuid, numeric, text, text) to authenticated;
