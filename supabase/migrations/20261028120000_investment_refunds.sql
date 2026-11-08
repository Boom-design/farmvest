-- Refunds for a project that never filled.
--
-- Funding is all-or-nothing: a project that does not reach its goal is
-- cancelled and nothing is released to the farm owner. The money investors
-- already paid is sitting in FarmVest's account, so it goes back to each of
-- them. The Admin sends it the same way it came in -- outside the app, through
-- GCash or the bank -- and records the reference here, so the investor can see
-- that it was returned and match it against their own account.
--
-- A refund is a state of the payment it reverses, not a new kind of row: the
-- amount, the account and the investor are already on the payment.

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('Submitted', 'Confirmed', 'Rejected', 'Refunded'));

alter table public.payments
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_reference text not null default 'None';

comment on column public.payments.refund_reference is
  'The reference of the transfer that returned this payment, as the Admin recorded it. None until refunded.';
