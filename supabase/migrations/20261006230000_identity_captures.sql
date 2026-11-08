-- Keep every frame of the liveness sequence, not just the one that matched.
--
-- Verification took a single photograph after a single random challenge. That
-- proved a face moved once, and left the Admin reviewing a flagged account with
-- one picture to compare against the ID.
--
-- The sequence is now fixed and has four steps -- right, left, front, blink --
-- and a frame is kept at each one. Four frames of the same face from three
-- angles is a far harder thing to fake than one, and it gives the Admin
-- something to actually look at: a photograph held up to a camera cannot turn
-- its head, and four pictures of the same printed photo are obvious at a glance
-- in a way one is not.
--
-- A separate table rather than four columns on users: the sequence may grow or
-- change, and a row per frame survives that without a migration per step.

create table if not exists public.identity_captures (
  identity_captures_id uuid primary key default gen_random_uuid(),
  users_id             uuid not null
                         references public.users (users_id) on delete cascade,
  -- Which instruction this frame answers.
  step                 text not null
                         check (step in ('turn-right', 'turn-left', 'front', 'blink')),
  -- Object path in the private valid-ids bucket, beside the ID it is compared to.
  file_url             text not null,
  captured_at          timestamptz not null default now()
);

create index if not exists identity_captures_users_id_idx
  on public.identity_captures (users_id, captured_at desc);

comment on table public.identity_captures is
  'One frame per step of the liveness sequence. Held as evidence for an Admin comparing a flagged account against its government ID; a printed photograph cannot produce four frames from three angles.';

alter table public.identity_captures enable row level security;

drop policy if exists "Customers read their own captures" on public.identity_captures;
drop policy if exists "Customers file their own captures" on public.identity_captures;

create policy "Customers read their own captures"
  on public.identity_captures for select to authenticated
  using (users_id = auth.uid() or public.is_admin());

create policy "Customers file their own captures"
  on public.identity_captures for insert to authenticated
  with check (users_id = auth.uid());

-- No update policy, and none wanted: a capture is evidence of a moment, and
-- letting the subject revise it afterwards would make it worth nothing. A
-- second attempt writes new rows and the old ones stay.
