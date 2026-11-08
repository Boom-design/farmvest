-- Schema support for the seven Admin sections.
--
--   User Management        - suspend or reactivate an account
--   Livestock Projects     - approve or reject a posted project
--   Rental Bookings        - the full booking lifecycle, including the weather
--                            hold used when a typhoon is forecast
--   Equipment Fleet        - maintenance history per unit

-- ---------------------------------------------------------------------------
-- User Management: suspension
-- ---------------------------------------------------------------------------

alter table public.users
  add column if not exists account_status text not null default 'Active'
    check (account_status in ('Active', 'Suspended'));

alter table public.users
  add column if not exists suspended_reason text;

-- ---------------------------------------------------------------------------
-- Livestock Projects: Admin approval before a project is visible for funding
-- ---------------------------------------------------------------------------

alter table public.projects drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status in (
    'Pending Approval',
    'Rejected',
    'Open',
    'Funded',
    'In Progress',
    'Completed',
    'Cancelled'
  ));

alter table public.projects alter column status set default 'Pending Approval';

alter table public.projects
  add column if not exists reviewed_at timestamptz;

alter table public.projects
  add column if not exists rejection_reason text;

-- ---------------------------------------------------------------------------
-- Rental Bookings: full lifecycle
-- ---------------------------------------------------------------------------

-- Map the two statuses that are being renamed before the new constraint lands.
update public.rentals set status = 'Confirmed' where status = 'Approved';
update public.rentals set status = 'Completed' where status = 'Returned';

alter table public.rentals drop constraint if exists rentals_status_check;

alter table public.rentals
  add constraint rentals_status_check
  check (status in (
    'Pending',
    'Confirmed',
    'On Hold - Weather Advisory',
    'Rescheduled',
    'Active',
    'Completed',
    'Cancelled'
  ));

alter table public.rentals
  add column if not exists admin_notes text;

-- ---------------------------------------------------------------------------
-- Equipment Fleet: maintenance history
-- ---------------------------------------------------------------------------

-- A short label for the physical unit, so two identical tractors can be told
-- apart in the fleet list and in maintenance records.
alter table public.equipment
  add column if not exists unit_code text;

create table if not exists public.maintenance_logs (
  maintenance_logs_id uuid primary key default gen_random_uuid(),
  equipment_id        uuid not null references public.equipment (equipment_id) on delete cascade,
  service_date        date not null default current_date,
  service_type        text not null default 'Routine'
                        check (service_type in ('Routine', 'Repair', 'Inspection')),
  description         text,
  cost                numeric(10, 2) check (cost >= 0),
  next_service_date   date,
  created_at          timestamptz not null default now()
);

create index if not exists maintenance_logs_equipment_id_idx
  on public.maintenance_logs (equipment_id);

alter table public.maintenance_logs enable row level security;

-- Maintenance records are internal, so only the Admin can see or write them.
create policy "Admin manages maintenance logs"
  on public.maintenance_logs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
