-- Rename the suspended account state to Inactive.
--
-- "Suspended" reads as a punishment; the Admin also deactivates accounts for
-- ordinary reasons, so the pair is now Active / Inactive. The column keeps its
-- name because it still describes the same thing.

alter table public.users drop constraint if exists users_account_status_check;

update public.users set account_status = 'Inactive' where account_status = 'Suspended';

alter table public.users
  add constraint users_account_status_check
  check (account_status in ('Active', 'Inactive'));

comment on column public.users.suspended_reason is
  'Why the Admin set the account to Inactive. Null while the account is Active.';
