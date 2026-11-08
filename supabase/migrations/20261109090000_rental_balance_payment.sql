-- A renter who paid a 50% downpayment pays the rest on delivery. That second
-- payment is recorded as its own row, of type Balance, and confirmed by the
-- Admin like any other.
alter table public.payments drop constraint if exists payments_payment_type_check;
alter table public.payments add constraint payments_payment_type_check
  check (payment_type in ('Full', '50% Downpayment', 'Balance'));
