-- A unit on the road is not available.
--
-- equipment_bookings is the list of dates a unit is already spoken for, and it
-- was written before 'Out for Delivery' existed. The status was added to the
-- rentals check constraint but never to this view, so a unit that had left the
-- yard read as free: a second renter could book the exact days it was already
-- being driven to somebody else's farm.
--
-- Nothing else caught it. The overlap test in the app reads this view, so the
-- gap was invisible from the interface.

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
    'Out for Delivery',
    'Active',
    'Under Inspection',
    'Rescheduled',
    'On Hold - Weather Advisory'
  );

comment on view public.equipment_bookings is
  'Dates each unit is already committed to, without saying who booked it. Cancelled and Completed are absent: those dates are free again.';

grant select on public.equipment_bookings to authenticated;
