-- Core FarmVest tables.
--
-- Two business models live side by side here:
--   * Livestock investment - marketplace, so projects and investments both
--     point at user profiles.
--   * Equipment rental - FarmVest owns the fleet, so the equipment table
--     deliberately has no owner_id.
--
-- Row level security allows any signed-in user to browse, while writes are
-- limited to the owning user. The Admin account is hardcoded in the app and is
-- expected to act through the Supabase dashboard or a service key.

-- ---------------------------------------------------------------------------
-- Livestock investment
-- ---------------------------------------------------------------------------

create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  farm_owner_id   uuid not null references public.users (id) on delete cascade,
  title           text not null,
  description     text,
  funding_goal    numeric(12, 2) not null check (funding_goal > 0),
  current_funding numeric(12, 2) not null default 0 check (current_funding >= 0),
  risk_level      text not null default 'Medium' check (risk_level in ('Low', 'Medium', 'High')),
  status          text not null default 'Open'
                    check (status in ('Open', 'Funded', 'In Progress', 'Completed', 'Cancelled')),
  created_at      timestamptz not null default now()
);

create index projects_farm_owner_id_idx on public.projects (farm_owner_id);

create table public.investments (
  id              uuid primary key default gen_random_uuid(),
  investor_id     uuid not null references public.users (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  amount          numeric(12, 2) not null check (amount > 0),
  -- Funds are released in stages instead of all at once, as an anti-fraud measure.
  milestone_stage text not null default 'Initial'
                    check (milestone_stage in ('Initial', 'Midterm', 'Final')),
  created_at      timestamptz not null default now()
);

create index investments_investor_id_idx on public.investments (investor_id);
create index investments_project_id_idx on public.investments (project_id);

create table public.progress_updates (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  photo_url   text,
  -- Named captured_at rather than timestamp to avoid clashing with the type name.
  captured_at timestamptz not null default now(),
  latitude    numeric(9, 6),
  longitude   numeric(9, 6),
  notes       text,
  created_at  timestamptz not null default now()
);

create index progress_updates_project_id_idx on public.progress_updates (project_id);

-- ---------------------------------------------------------------------------
-- Equipment rental (FarmVest owns the fleet)
-- ---------------------------------------------------------------------------

create table public.equipment (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  type                text,
  price_per_day       numeric(10, 2) not null check (price_per_day >= 0),
  availability_status text not null default 'Available'
                        check (availability_status in ('Available', 'Rented', 'Maintenance')),
  condition_notes     text,
  created_at          timestamptz not null default now()
);

comment on table public.equipment is
  'FarmVest-owned rental fleet. No owner_id column: there is no third-party equipment owner.';

create table public.rentals (
  id            uuid primary key default gen_random_uuid(),
  farm_owner_id uuid not null references public.users (id) on delete cascade,
  equipment_id  uuid not null references public.equipment (id) on delete restrict,
  start_date    date not null,
  end_date      date not null,
  status        text not null default 'Pending'
                  check (status in ('Pending', 'Approved', 'Active', 'Returned', 'Cancelled')),
  created_at    timestamptz not null default now(),
  constraint rentals_date_order_check check (end_date >= start_date)
);

create index rentals_farm_owner_id_idx on public.rentals (farm_owner_id);
create index rentals_equipment_id_idx on public.rentals (equipment_id);

-- ---------------------------------------------------------------------------
-- Moderation and feedback
-- ---------------------------------------------------------------------------

create table public.reports (
  id             uuid primary key default gen_random_uuid(),
  reported_by    uuid not null references public.users (id) on delete cascade,
  target_user_id uuid not null references public.users (id) on delete cascade,
  reason         text not null,
  status         text not null default 'Open'
                   check (status in ('Open', 'Reviewing', 'Resolved', 'Dismissed')),
  created_at     timestamptz not null default now()
);

create table public.reviews (
  id               uuid primary key default gen_random_uuid(),
  reviewer_id      uuid not null references public.users (id) on delete cascade,
  reviewee_id      uuid not null references public.users (id) on delete cascade,
  transaction_type text not null check (transaction_type in ('Investment', 'Rental')),
  rating           smallint not null check (rating between 1 and 5),
  comment          text,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.projects         enable row level security;
alter table public.investments      enable row level security;
alter table public.progress_updates enable row level security;
alter table public.equipment        enable row level security;
alter table public.rentals          enable row level security;
alter table public.reports          enable row level security;
alter table public.reviews          enable row level security;

-- Browsing: any signed-in user can read the public catalogue.
create policy "Authenticated users can read projects"
  on public.projects for select to authenticated using (true);

create policy "Authenticated users can read progress updates"
  on public.progress_updates for select to authenticated using (true);

create policy "Authenticated users can read equipment"
  on public.equipment for select to authenticated using (true);

create policy "Authenticated users can read reviews"
  on public.reviews for select to authenticated using (true);

-- Writing: limited to the owning user.
create policy "Farm owners manage their own projects"
  on public.projects for all to authenticated
  using (auth.uid() = farm_owner_id)
  with check (auth.uid() = farm_owner_id);

create policy "Farm owners manage progress updates for their own projects"
  on public.progress_updates for all to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = progress_updates.project_id
        and p.farm_owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = progress_updates.project_id
        and p.farm_owner_id = auth.uid()
    )
  );

-- Investments are private between the investor and the funded farm owner.
create policy "Investors read their own investments"
  on public.investments for select to authenticated
  using (
    auth.uid() = investor_id
    or exists (
      select 1 from public.projects p
      where p.id = investments.project_id
        and p.farm_owner_id = auth.uid()
    )
  );

create policy "Investors create their own investments"
  on public.investments for insert to authenticated
  with check (auth.uid() = investor_id);

create policy "Farm owners read their own rentals"
  on public.rentals for select to authenticated
  using (auth.uid() = farm_owner_id);

create policy "Farm owners create their own rentals"
  on public.rentals for insert to authenticated
  with check (auth.uid() = farm_owner_id);

create policy "Reporters read their own reports"
  on public.reports for select to authenticated
  using (auth.uid() = reported_by);

create policy "Users file their own reports"
  on public.reports for insert to authenticated
  with check (auth.uid() = reported_by);

create policy "Users write their own reviews"
  on public.reviews for insert to authenticated
  with check (auth.uid() = reviewer_id);
