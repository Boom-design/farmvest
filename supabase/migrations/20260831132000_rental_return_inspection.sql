-- Return inspection for equipment rentals.
--
-- Step 8 of the rental flow is "equipment is returned and inspected; condition is
-- logged", which had nowhere to be recorded. The inspection is what separates the
-- two ways a unit comes back broken: damage the renter is liable for under the
-- contract, and mechanical failure that FarmVest carries because it owns the fleet.

alter table public.rentals
  add column if not exists returned_at date;

alter table public.rentals
  add column if not exists return_condition text not null default 'Not Inspected';

alter table public.rentals drop constraint if exists rentals_return_condition_check;

alter table public.rentals
  add constraint rentals_return_condition_check
  check (return_condition in (
    'Not Inspected',
    'Good',
    'Minor Damage',
    'Major Damage',
    'Not Returned'
  ));

alter table public.rentals
  add column if not exists damage_notes text not null default 'None';

-- Reimbursement for the repair, not rental income: the revenue report keeps it
-- out of the rental fee total on purpose.
alter table public.rentals
  add column if not exists damage_charge numeric(10, 2) not null default 0
    check (damage_charge >= 0);

comment on column public.rentals.damage_charge is
  'Charged to the renter for damage beyond normal wear, under the signed rental contract. Reimbursement for repair, not revenue.';

-- Under Inspection sits between Active and Completed: the unit is back but the
-- booking is not closed until the condition is recorded.
alter table public.rentals drop constraint if exists rentals_status_check;

alter table public.rentals
  add constraint rentals_status_check
  check (status in (
    'Pending',
    'Confirmed',
    'On Hold - Weather Advisory',
    'Rescheduled',
    'Active',
    'Under Inspection',
    'Completed',
    'Cancelled'
  ));

-- The occupied-dates view has to know about the new status too.
create or replace view public.equipment_bookings as
  select
    rentals_id,
    equipment_id,
    start_date,
    end_date,
    status
  from public.rentals
  where status in (
    'Pending',
    'Confirmed',
    'Active',
    'Under Inspection',
    'Rescheduled',
    'On Hold - Weather Advisory'
  );

grant select on public.equipment_bookings to authenticated;

-- ---------------------------------------------------------------------------
-- Links that let a damaged return be traced both ways
-- ---------------------------------------------------------------------------

-- A repair caused by a rental points back at the booking that caused it.
alter table public.maintenance_logs
  add column if not exists rentals_id uuid
    references public.rentals (rentals_id) on delete set null;

create index if not exists maintenance_logs_rentals_id_idx on public.maintenance_logs (rentals_id);

-- An "Equipment damage" case needs to reach the rental the same way a project
-- case reaches the project.
alter table public.reports
  add column if not exists rentals_id uuid
    references public.rentals (rentals_id) on delete set null;

create index if not exists reports_rentals_id_idx on public.reports (rentals_id);
