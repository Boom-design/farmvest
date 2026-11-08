-- Delivery as a two-party handover.
--
-- FarmVest has no GPS and no driver app, so nothing can observe a unit arriving.
-- What it had instead was the Admin moving a booking to Active, which is a claim
-- by the party that did not receive anything. Two ways that goes wrong: a unit
-- marked delivered that never arrived, with the renter already paying for days
-- they do not have; and a unit that arrived while the Admin forgot to record it,
-- so every report afterwards is wrong.
--
-- The fix is not tracking. It is that the person who received the unit is the
-- one who says so. The Admin dispatches; the farm owner confirms receipt, and
-- that confirmation is what makes the booking Active. A booking left sitting in
-- Out for Delivery is then a real signal rather than a silent error.
--
-- This mirrors the return inspection, which the Admin records because the Admin
-- is the one the unit comes back to. Each side records the half it witnessed.

-- ---------------------------------------------------------------------------
-- A status between confirmed and in use
-- ---------------------------------------------------------------------------

alter table public.rentals drop constraint if exists rentals_status_check;

alter table public.rentals
  add constraint rentals_status_check
  check (
    status in (
      'Pending',
      'Confirmed',
      'Out for Delivery',
      'On Hold - Weather Advisory',
      'Rescheduled',
      'Active',
      'Under Inspection',
      'Completed',
      'Cancelled'
    )
  );

-- ---------------------------------------------------------------------------
-- What each side records
-- ---------------------------------------------------------------------------

alter table public.rentals
  -- Set by the Admin at dispatch.
  add column if not exists dispatched_at timestamptz,
  -- Words rather than a timestamp: "Morning" is what an operator can honestly
  -- promise, and a precise time nobody can keep is worse than a vague one.
  add column if not exists delivery_window text not null default 'None',
  add column if not exists driver_name text not null default 'None',
  -- The number the renter calls to ask where the unit is. Without tracking,
  -- this is the answer to that question.
  add column if not exists driver_contact text not null default 'None',
  -- Set by the farm owner at receipt.
  add column if not exists delivered_at timestamptz,
  -- Who signed for it, in the same click-wrap style as the rental agreement.
  add column if not exists received_by text not null default 'None';

comment on column public.rentals.delivery_window is
  'When the unit is expected, in words the operator can keep: "Nov 10, morning".';

comment on column public.rentals.delivered_at is
  'Set when the farm owner confirms receipt, which is also what moves the booking to Active. Never written by the Admin: the receiving party is the one who witnessed it.';

comment on column public.rentals.received_by is
  'Name typed by the person who accepted the unit, the delivery-receipt equivalent of a signature.';

-- ---------------------------------------------------------------------------
-- The farm owner may confirm receipt, and nothing else
-- ---------------------------------------------------------------------------

-- The existing policy lets a farm owner update their own rental only while it is
-- still Pending, which is the cancel action on My Rentals. Confirming receipt is
-- the second thing they may do, and it is allowed only from Out for Delivery, so
-- a booking cannot be dragged forward or back from anywhere else.
drop policy if exists "Farm owners confirm delivery" on public.rentals;

create policy "Farm owners confirm delivery"
  on public.rentals for update to authenticated
  using (farm_owners_id = auth.uid() and status = 'Out for Delivery')
  with check (farm_owners_id = auth.uid() and status = 'Active');
