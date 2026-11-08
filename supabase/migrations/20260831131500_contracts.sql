-- Signed agreements for both business models.
--
-- One table rather than a pair of columns on rentals and investments: a contract
-- is a record in its own right, and the Admin needs one place to answer "show me
-- the agreement". Exactly one of rentals_id / investments_id is filled, the same
-- one-per-side pattern the reports table already uses.
--
-- The signature is click-wrap: the party types their full name and confirms.
-- terms_snapshot stores the exact text they agreed to, because the wording will
-- change later and a contract that cannot be reproduced is not a contract.

create table if not exists public.contracts (
  contracts_id   uuid primary key default gen_random_uuid(),
  rentals_id     uuid references public.rentals (rentals_id) on delete cascade,
  investments_id uuid references public.investments (investments_id) on delete cascade,
  signatory_name text not null,
  signed_at      timestamptz not null default now(),
  terms_version  text not null default 'v1',
  terms_snapshot text not null,
  agreed_amount  numeric(12, 2) not null default 0 check (agreed_amount >= 0),
  created_at     timestamptz not null default now(),
  constraint contracts_one_subject_check
    check (num_nonnulls(rentals_id, investments_id) = 1)
);

create index if not exists contracts_rentals_id_idx on public.contracts (rentals_id);
create index if not exists contracts_investments_id_idx on public.contracts (investments_id);

comment on table public.contracts is
  'Click-wrap agreements. One row per signed rental booking or investment, holding the exact terms the party accepted.';

alter table public.contracts enable row level security;

-- A party reads and signs only their own agreement; the Admin sees all of them.
create policy "Parties read their own contracts"
  on public.contracts for select to authenticated
  using (
    exists (
      select 1 from public.rentals r
      where r.rentals_id = contracts.rentals_id and r.farm_owners_id = auth.uid()
    )
    or exists (
      select 1 from public.investments i
      where i.investments_id = contracts.investments_id and i.investors_id = auth.uid()
    )
  );

create policy "Parties sign their own contracts"
  on public.contracts for insert to authenticated
  with check (
    exists (
      select 1 from public.rentals r
      where r.rentals_id = contracts.rentals_id and r.farm_owners_id = auth.uid()
    )
    or exists (
      select 1 from public.investments i
      where i.investments_id = contracts.investments_id and i.investors_id = auth.uid()
    )
  );

create policy "Admin manages contracts"
  on public.contracts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
