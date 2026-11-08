-- Payment for an equipment rental.
--
-- FarmVest is not connected to GCash or to any bank, and deliberately so: the
-- platform would have to be a registered merchant to accept money, and holding
-- funds would make it a payment intermediary. What it does instead is what a
-- small operator actually does today. FarmVest publishes the account to send to,
-- the renter sends the money through their own GCash or bank app, uploads the
-- receipt, and the Admin checks it against the account before confirming the
-- booking.
--
-- The reason a booking is paid for at all is cancellation. A unit is hauled to
-- the farm, and a booking called off once the driver has left costs FarmVest the
-- whole trip. A downpayment makes that cancellation cost the renter something,
-- which is what a deposit is for.

-- ---------------------------------------------------------------------------
-- Where to send the money
-- ---------------------------------------------------------------------------

create table if not exists public.payment_methods (
  payment_methods_id uuid primary key default gen_random_uuid(),
  method             text not null check (method in ('GCash', 'Bank Transfer', 'Other')),
  -- The name the account is under, so the renter can check it before sending.
  account_name       text not null,
  account_number     text not null,
  -- Only a bank transfer has one; GCash is identified by the number alone.
  bank_name          text not null default 'None',
  instructions       text not null default 'None',
  -- Set inactive rather than deleted: a payment already made against it still
  -- points here, and the record has to stay readable.
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

comment on table public.payment_methods is
  'FarmVest accounts a renter sends payment to. Maintained by the Admin under My Account; read by every signed-in user, because that is what makes them payable.';

-- ---------------------------------------------------------------------------
-- What was sent
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  payments_id        uuid primary key default gen_random_uuid(),
  rentals_id         uuid not null references public.rentals (rentals_id) on delete cascade,
  -- Kept even when the method is later set inactive, so the record stays
  -- complete.
  payment_methods_id uuid references public.payment_methods (payment_methods_id) on delete set null,
  amount             numeric(12, 2) not null check (amount > 0),
  -- Half now and the rest on delivery, or the whole fee up front.
  payment_type       text not null default 'Full'
                       check (payment_type in ('Full', '50% Downpayment')),
  -- The reference the renter's own app produced. This is what the Admin matches
  -- against the receiving account; the platform cannot verify it on its own.
  reference_no       text not null,
  -- Object path in the private payment-proofs bucket.
  proof_url          text,
  status             text not null default 'Submitted'
                       check (status in ('Submitted', 'Confirmed', 'Rejected')),
  admin_notes        text not null default 'None',
  submitted_at       timestamptz not null default now(),
  reviewed_at        timestamptz,
  -- The Admin's email as text, because the Admin has no subtype row.
  reviewed_by        text
);

create index if not exists payments_rentals_id_idx on public.payments (rentals_id);
create index if not exists payments_status_idx on public.payments (status);

comment on table public.payments is
  'A payment the renter says they sent, with the reference and receipt. Confirmed by the Admin against the receiving account; FarmVest processes nothing itself.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.payment_methods enable row level security;
alter table public.payments        enable row level security;

-- Every signed-in user reads the accounts. There is nothing secret in them:
-- publishing the number is the whole point, and it is the same number that
-- would be printed on an invoice.
create policy "Signed-in users read payment methods"
  on public.payment_methods for select to authenticated using (true);

create policy "Admin manages payment methods"
  on public.payment_methods for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A renter sees and files payments against their own bookings only.
create policy "Renters read their own payments"
  on public.payments for select to authenticated
  using (
    exists (
      select 1 from public.rentals r
      where r.rentals_id = payments.rentals_id and r.farm_owners_id = auth.uid()
    )
  );

create policy "Renters submit their own payments"
  on public.payments for insert to authenticated
  with check (
    status = 'Submitted'
    and exists (
      select 1 from public.rentals r
      where r.rentals_id = payments.rentals_id and r.farm_owners_id = auth.uid()
    )
  );

-- No update policy for the renter on purpose: a submitted payment is a claim on
-- the record, and letting the claimant edit it after the fact would make the
-- Admin's confirmation meaningless.
create policy "Admin manages payments"
  on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false, -- a receipt carries a name and a phone number, so it is not public
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Renters upload their own payment proof" on storage.objects;
drop policy if exists "Renters read their own payment proof" on storage.objects;
drop policy if exists "Admin reads every payment proof" on storage.objects;
drop policy if exists "Admin deletes payment proof" on storage.objects;

-- Own folder only, the same rule the avatars and progress-photos buckets use.
create policy "Renters upload their own payment proof"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Renters read their own payment proof"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Admin reads every payment proof"
  on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());

create policy "Admin deletes payment proof"
  on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());
