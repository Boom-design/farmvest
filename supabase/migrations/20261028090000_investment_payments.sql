-- Investing collects money, the same way renting does.
--
-- An investment used to be a pledge and a signed agreement and nothing else:
-- no peso moved, so a project could read Funded with nothing behind it. Now the
-- investor sends the amount to FarmVest's published GCash or bank account and
-- uploads the receipt, and the Admin confirms it against the receiving account,
-- exactly as a rental payment is handled.
--
-- The payments table already does this for rentals, so it takes investments
-- too rather than a second table that would duplicate every column, policy and
-- review screen. Each payment belongs to exactly one rental or one investment.

alter table public.payments alter column rentals_id drop not null;

alter table public.payments
  add column if not exists investments_id uuid
    references public.investments (investments_id) on delete cascade;

alter table public.payments drop constraint if exists payments_one_subject_check;
alter table public.payments
  add constraint payments_one_subject_check
  check (num_nonnulls(rentals_id, investments_id) = 1);

create index if not exists payments_investments_id_idx on public.payments (investments_id);

comment on column public.payments.investments_id is
  'The investment this payment is for. Null for a rental payment; exactly one of rentals_id and investments_id is set.';

-- ---------------------------------------------------------------------------
-- Row level security: an investor reads and submits payments for their own
-- investments only. The Admin policy already covers every row.
-- ---------------------------------------------------------------------------

drop policy if exists "Investors read their own investment payments" on public.payments;
create policy "Investors read their own investment payments"
  on public.payments for select to authenticated
  using (
    exists (
      select 1 from public.investments i
      where i.investments_id = payments.investments_id and i.customers_id = auth.uid()
    )
  );

drop policy if exists "Investors submit their own investment payments" on public.payments;
create policy "Investors submit their own investment payments"
  on public.payments for insert to authenticated
  with check (
    status = 'Submitted'
    and exists (
      select 1 from public.investments i
      where i.investments_id = payments.investments_id and i.customers_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- The demo investments were seeded as already paid. Real investments made
-- before this migration are left alone: they show as awaiting payment, which
-- is the truth about them.
-- ---------------------------------------------------------------------------

insert into public.payments (
  investments_id, payment_methods_id, amount, payment_type, reference_no, status,
  submitted_at, reviewed_at, reviewed_by
)
select
  i.investments_id,
  (select payment_methods_id from public.payment_methods where is_active order by created_at limit 1),
  i.amount, 'Full', 'INV' || to_char(i.created_at, 'YYMMDD') || substr(i.investments_id::text, 1, 6),
  'Confirmed', i.created_at + interval '2 hours', i.created_at + interval '1 day', public.admin_email()
from public.investments i
join public.users u on u.users_id = i.customers_id
where u.email like '%@farmvest.test'
  and not exists (select 1 from public.payments p where p.investments_id = i.investments_id);
