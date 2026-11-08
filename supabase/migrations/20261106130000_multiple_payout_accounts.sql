-- A customer may keep several payout accounts (GCash, Maya, bank) instead of
-- one, with one marked as the default. The single set of columns added to
-- customers earlier is moved into the new table and dropped.

create table if not exists public.payout_accounts (
  payout_accounts_id uuid primary key default gen_random_uuid(),
  customers_id       uuid not null references public.customers (customers_id) on delete cascade,
  method             text not null check (method in ('GCash', 'Maya', 'Bank Transfer')),
  account_name       text not null,
  account_number     text not null,
  bank_name          text not null default 'None',
  is_default         boolean not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists payout_accounts_customers_id_idx on public.payout_accounts (customers_id);

-- At most one default per customer.
create unique index if not exists payout_accounts_one_default
  on public.payout_accounts (customers_id) where is_default;

comment on table public.payout_accounts is
  'Where FarmVest sends a customer money: released project funds and investor payouts. Private to the customer and the Admin.';

alter table public.payout_accounts enable row level security;

drop policy if exists "Customers manage their own payout accounts" on public.payout_accounts;
create policy "Customers manage their own payout accounts"
  on public.payout_accounts for all to authenticated
  using (auth.uid() = customers_id) with check (auth.uid() = customers_id);

drop policy if exists "Admin reads payout accounts" on public.payout_accounts;
create policy "Admin reads payout accounts"
  on public.payout_accounts for select to authenticated
  using (public.is_admin());

-- Carry over any account already saved in the single-account columns.
insert into public.payout_accounts (customers_id, method, account_name, account_number, bank_name, is_default)
select customers_id, payout_method, payout_account_name, payout_account_number, payout_bank_name, true
from public.customers
where payout_method in ('GCash', 'Maya', 'Bank Transfer') and payout_account_number <> 'None';

alter table public.customers
  drop column if exists payout_method,
  drop column if exists payout_account_name,
  drop column if exists payout_account_number,
  drop column if exists payout_bank_name;

-- Which account a release was sent to, as written at the time, so the record
-- still reads right if the farm owner later edits or removes that account.
alter table public.fund_releases
  add column if not exists sent_to text not null default 'None';
