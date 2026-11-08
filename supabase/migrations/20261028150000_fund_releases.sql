-- Staged release of funds, and FarmVest's commission taken from each release.
--
-- The investors' money sits in FarmVest's account once their payments are
-- confirmed. When a project is fully funded it reaches the farm owner in three
-- stages, each against progress evidence: Initial 40% to start the cycle,
-- Midterm 30% once dated progress shows it running, Final 30% toward harvest.
-- FarmVest keeps 5% of every release as its commission and sends the rest.
--
-- Commission is therefore earned only on money that was actually raised and
-- released. A project that never fills is cancelled and refunded with nothing
-- kept, which the earlier calculation -- 5% of every investment as soon as it
-- was committed -- could not tell apart.
--
-- Each row is the record of one transfer: how much left, how much FarmVest
-- kept, and the reference the farm owner can match against their own account.

create table if not exists public.fund_releases (
  fund_releases_id uuid primary key default gen_random_uuid(),
  projects_id      uuid not null references public.projects (projects_id) on delete cascade,
  stage            text not null check (stage in ('Initial', 'Midterm', 'Final')),
  gross_amount     numeric(12, 2) not null check (gross_amount > 0),
  commission       numeric(12, 2) not null check (commission >= 0),
  net_amount       numeric(12, 2) not null check (net_amount >= 0),
  reference_no     text not null,
  released_at      timestamptz not null default now(),
  released_by      text,
  constraint fund_releases_one_per_stage unique (projects_id, stage)
);

create index if not exists fund_releases_projects_id_idx on public.fund_releases (projects_id);
create index if not exists fund_releases_released_at_idx on public.fund_releases (released_at);

comment on table public.fund_releases is
  'One transfer of raised funds from FarmVest to the farm owner. gross_amount is the share of the raise, commission is the 5% FarmVest keeps, net_amount is what was sent.';

alter table public.projects
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.fund_releases enable row level security;

drop policy if exists "Admin manages fund releases" on public.fund_releases;
create policy "Admin manages fund releases"
  on public.fund_releases for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Farm owners read their own releases" on public.fund_releases;
create policy "Farm owners read their own releases"
  on public.fund_releases for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.projects_id = fund_releases.projects_id and p.customers_id = auth.uid()
    )
  );

drop policy if exists "Investors read releases of what they funded" on public.fund_releases;
create policy "Investors read releases of what they funded"
  on public.fund_releases for select to authenticated
  using (
    exists (
      select 1 from public.investments i
      where i.projects_id = fund_releases.projects_id and i.customers_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- The seeded history: projects already In Progress or Completed were released
-- to, so they get the releases they would have had. Funded projects have not
-- started, so they get none.
-- ---------------------------------------------------------------------------

insert into public.fund_releases (projects_id, stage, gross_amount, commission, net_amount, reference_no, released_at, released_by)
select p.projects_id, s.stage,
       round(p.funding_goal * s.share, 2),
       round(p.funding_goal * s.share * 0.05, 2),
       round(p.funding_goal * s.share * 0.95, 2),
       'REL' || to_char(p.created_at + s.after, 'YYMMDD') || substr(p.projects_id::text, 1, 4) || s.n,
       p.created_at + s.after,
       public.admin_email()
from public.projects p
join public.users u on u.users_id = p.customers_id
cross join (values (1, 'Initial', 0.40, interval '20 days'),
                   (2, 'Midterm', 0.30, interval '40 days'),
                   (3, 'Final',   0.30, interval '60 days')) as s(n, stage, share, after)
where u.email like '%@farmvest.test'
  and (p.status = 'Completed' or (p.status = 'In Progress' and s.n <= 2))
  and p.created_at + s.after < now()
on conflict (projects_id, stage) do nothing;

update public.projects p
set started_at = coalesce(p.started_at, p.created_at + interval '20 days'),
    completed_at = case when p.status = 'Completed' then coalesce(p.completed_at, p.created_at + interval '75 days') else p.completed_at end
where p.status in ('In Progress', 'Completed')
  and exists (select 1 from public.users u where u.users_id = p.customers_id and u.email like '%@farmvest.test');
