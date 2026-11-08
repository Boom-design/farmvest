-- Repayment: the farm owner pays the investors back, through FarmVest.
--
-- A completed project owes each investor what they put in plus the stated
-- return. The farm owner sends the whole amount to FarmVest's account and
-- uploads the receipt, as every other payment on the platform is made; the
-- Admin confirms it, sends each investor their share, and records each
-- transfer. Going through FarmVest keeps one record of who was paid what,
-- which is what an investor or the farm owner points to if it is ever
-- disputed.
--
-- Two tables, because they are two transfers with two different parties: one
-- repayment in from the farm owner per project, and one payout out per
-- investment.

create table if not exists public.repayments (
  repayments_id      uuid primary key default gen_random_uuid(),
  projects_id        uuid not null references public.projects (projects_id) on delete cascade,
  payment_methods_id uuid references public.payment_methods (payment_methods_id) on delete set null,
  amount             numeric(12, 2) not null check (amount > 0),
  reference_no       text not null,
  proof_url          text,
  status             text not null default 'Submitted'
                       check (status in ('Submitted', 'Confirmed', 'Rejected')),
  admin_notes        text not null default 'None',
  submitted_at       timestamptz not null default now(),
  reviewed_at        timestamptz,
  reviewed_by        text
);

create index if not exists repayments_projects_id_idx on public.repayments (projects_id);

create table if not exists public.investor_payouts (
  investor_payouts_id uuid primary key default gen_random_uuid(),
  investments_id      uuid not null references public.investments (investments_id) on delete cascade,
  principal           numeric(12, 2) not null check (principal >= 0),
  return_amount       numeric(12, 2) not null check (return_amount >= 0),
  total               numeric(12, 2) not null check (total >= 0),
  reference_no        text not null,
  paid_at             timestamptz not null default now(),
  paid_by             text,
  constraint investor_payouts_one_per_investment unique (investments_id)
);

comment on table public.repayments is
  'Money the farm owner sends FarmVest to repay a completed project''s investors: capital plus the stated return.';
comment on table public.investor_payouts is
  'What FarmVest sent one investor out of a confirmed repayment: their capital, their return, and the transfer reference.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.repayments enable row level security;
alter table public.investor_payouts enable row level security;

drop policy if exists "Admin manages repayments" on public.repayments;
create policy "Admin manages repayments"
  on public.repayments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Farm owners read their own repayments" on public.repayments;
create policy "Farm owners read their own repayments"
  on public.repayments for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.projects_id = repayments.projects_id and p.customers_id = auth.uid()
  ));

drop policy if exists "Farm owners submit their own repayments" on public.repayments;
create policy "Farm owners submit their own repayments"
  on public.repayments for insert to authenticated
  with check (
    status = 'Submitted'
    and exists (
      select 1 from public.projects p
      where p.projects_id = repayments.projects_id and p.customers_id = auth.uid()
    )
  );

drop policy if exists "Admin manages investor payouts" on public.investor_payouts;
create policy "Admin manages investor payouts"
  on public.investor_payouts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Investors read their own payouts" on public.investor_payouts;
create policy "Investors read their own payouts"
  on public.investor_payouts for select to authenticated
  using (exists (
    select 1 from public.investments i
    where i.investments_id = investor_payouts.investments_id and i.customers_id = auth.uid()
  ));

drop policy if exists "Farm owners read payouts on their projects" on public.investor_payouts;
create policy "Farm owners read payouts on their projects"
  on public.investor_payouts for select to authenticated
  using (exists (
    select 1 from public.investments i
    join public.projects p on p.projects_id = i.projects_id
    where i.investments_id = investor_payouts.investments_id and p.customers_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- The seeded Completed projects were repaid, so their history shows it.
-- ---------------------------------------------------------------------------

insert into public.repayments (projects_id, payment_methods_id, amount, reference_no, status, submitted_at, reviewed_at, reviewed_by)
select p.projects_id,
       (select payment_methods_id from public.payment_methods where is_active order by created_at limit 1),
       round(sum(i.amount) * (1 + p.expected_roi_percent / 100), 2),
       'REP' || substr(p.projects_id::text, 1, 8),
       'Confirmed',
       coalesce(p.completed_at, now()) - interval '3 days',
       coalesce(p.completed_at, now()) - interval '2 days',
       public.admin_email()
from public.projects p
join public.investments i on i.projects_id = p.projects_id
join public.users u on u.users_id = p.customers_id
where p.status = 'Completed' and u.email like '%@farmvest.test'
  and p.title <> 'Broiler Production – 200 Heads'
  and not exists (select 1 from public.repayments r where r.projects_id = p.projects_id)
group by p.projects_id, p.expected_roi_percent, p.completed_at;

insert into public.investor_payouts (investments_id, principal, return_amount, total, reference_no, paid_at, paid_by)
select i.investments_id, i.amount,
       round(i.amount * p.expected_roi_percent / 100, 2),
       round(i.amount * (1 + p.expected_roi_percent / 100), 2),
       'PAY' || substr(i.investments_id::text, 1, 8),
       r.reviewed_at, public.admin_email()
from public.investments i
join public.projects p on p.projects_id = i.projects_id
join public.repayments r on r.projects_id = p.projects_id and r.status = 'Confirmed'
on conflict (investments_id) do nothing;
