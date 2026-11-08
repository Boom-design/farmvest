-- A budget at posting, and a liquidation report at the end.
--
-- The investor's return is fixed and secured by collateral, so a farm owner
-- has nothing to gain by under-reporting profit. What still needs proving is
-- that the money went where the project said it would, and that any loss was
-- the ordinary kind. Two records do that:
--
--   the cost estimate   what the farm owner planned to buy and how many head,
--                       with an expected mortality, entered when posting;
--   the liquidation     what was actually spent, with receipts, how many died
--                       and why, and what was harvested and sold.
--
-- The Admin compares the two before marking the project Completed, and the
-- investors can read the summary. A cycle that lost far more animals than
-- planned, or spent far off budget, is flagged rather than waved through.

alter table public.projects
  add column if not exists estimated_heads integer check (estimated_heads is null or estimated_heads > 0),
  add column if not exists expected_mortality_percent numeric(5, 2) not null default 5
    check (expected_mortality_percent >= 0 and expected_mortality_percent <= 100),
  add column if not exists cost_breakdown jsonb not null default '[]'::jsonb;

comment on column public.projects.cost_breakdown is
  'The budget the farm owner posted: an array of {item, amount} that adds up to the funding goal.';

create table if not exists public.liquidations (
  liquidations_id   uuid primary key default gen_random_uuid(),
  projects_id       uuid not null unique references public.projects (projects_id) on delete cascade,
  heads_stocked     integer not null check (heads_stocked >= 0),
  mortality         integer not null default 0 check (mortality >= 0),
  mortality_reason  text not null default 'None',
  heads_harvested   integer not null check (heads_harvested >= 0),
  sales_amount      numeric(12, 2) not null default 0 check (sales_amount >= 0),
  expenses          jsonb not null default '[]'::jsonb,
  receipts          text[] not null default '{}',
  notes             text not null default 'None',
  status            text not null default 'Submitted'
                      check (status in ('Submitted', 'Accepted', 'Returned')),
  admin_notes       text not null default 'None',
  submitted_at      timestamptz not null default now(),
  reviewed_at       timestamptz,
  reviewed_by       text
);

comment on table public.liquidations is
  'The farm owner''s account of a finished cycle: actual expenses with receipts, mortality and its cause, and the harvest sold. One per project; a returned report is corrected in place.';

alter table public.liquidations enable row level security;

drop policy if exists "Admin manages liquidations" on public.liquidations;
create policy "Admin manages liquidations"
  on public.liquidations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Farm owners read their own liquidations" on public.liquidations;
create policy "Farm owners read their own liquidations"
  on public.liquidations for select to authenticated
  using (exists (select 1 from public.projects p
                 where p.projects_id = liquidations.projects_id and p.customers_id = auth.uid()));

drop policy if exists "Farm owners file their own liquidations" on public.liquidations;
create policy "Farm owners file their own liquidations"
  on public.liquidations for insert to authenticated
  with check (
    status = 'Submitted'
    and exists (select 1 from public.projects p
                where p.projects_id = liquidations.projects_id and p.customers_id = auth.uid())
  );

-- A returned report is corrected and sent again; an accepted one is final.
drop policy if exists "Farm owners correct a returned liquidation" on public.liquidations;
create policy "Farm owners correct a returned liquidation"
  on public.liquidations for update to authenticated
  using (
    status = 'Returned'
    and exists (select 1 from public.projects p
                where p.projects_id = liquidations.projects_id and p.customers_id = auth.uid())
  )
  with check (status = 'Submitted');

drop policy if exists "Investors read liquidations of what they funded" on public.liquidations;
create policy "Investors read liquidations of what they funded"
  on public.liquidations for select to authenticated
  using (exists (select 1 from public.investments i
                 where i.projects_id = liquidations.projects_id and i.customers_id = auth.uid()));
