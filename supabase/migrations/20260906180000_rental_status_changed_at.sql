-- When a booking last changed hands.
--
-- The notification bell is derived from live rows rather than from a table of
-- its own, so every item needs a timestamp saying when it became true. Bookings
-- had only created_at, which meant a status change carried the date the booking
-- was made: the farm owner had already seen that date, so the badge stayed
-- quiet and "your unit is on the way" never rang.
--
-- Set by a trigger rather than by the app. The Admin changes a booking's status
-- from three places -- the Confirm button, the status dropdown, and the return
-- inspection -- and a column that only some of them remember to write is worse
-- than no column at all.

alter table public.rentals
  add column if not exists status_changed_at timestamptz not null default now();

comment on column public.rentals.status_changed_at is
  'When status last changed. Maintained by a trigger; read by the notification bell to date a status change.';

-- Existing rows have never changed status as far as anyone knows, so the
-- booking date is the honest answer for them.
update public.rentals
set status_changed_at = created_at
where status_changed_at is null or status_changed_at = created_at;

create or replace function public.touch_rental_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists rentals_status_changed on public.rentals;

create trigger rentals_status_changed
  before update on public.rentals
  for each row
  execute function public.touch_rental_status();
