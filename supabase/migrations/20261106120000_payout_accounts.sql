-- Where FarmVest sends a customer's money: the farm owner's released funds and
-- an investor's payout. Each customer keeps one payout account on their own
-- row. The customers policies already limit it to the customer and the Admin,
-- and no public view selects these columns, so nobody else can read it.
alter table public.customers
  add column if not exists payout_method text not null default 'None'
    check (payout_method in ('None', 'GCash', 'Maya', 'Bank Transfer')),
  add column if not exists payout_account_name text not null default 'None',
  add column if not exists payout_account_number text not null default 'None',
  add column if not exists payout_bank_name text not null default 'None';

comment on column public.customers.payout_method is
  'How FarmVest sends this customer money: released project funds and investor payouts. None until set.';
