-- Give the Admin back the writes the column revoke took away.
--
-- The previous migration revoked UPDATE on public.users and granted it back for
-- three harmless columns, to stop a signed-in user setting their own
-- verification_status to 'Approved'. That was the right fix for the hole and
-- the wrong fix for the Admin: column privileges are checked before row level
-- security, so a policy calling is_admin() never gets the chance to allow what
-- the grant already refused. The Admin's Approve button broke with it.
--
-- Column grants cannot express "this role, but only when is_admin()", so the
-- Admin's writes move into functions instead. These run as their owner, so the
-- revoke does not apply inside them, and each one re-checks is_admin() itself
-- rather than trusting the caller.

-- ---------------------------------------------------------------------------
-- Clearing or refusing a flagged verification
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_verification(
  p_users_id uuid,
  p_status   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may decide a verification.';
  end if;

  if p_status not in ('Approved', 'Rejected') then
    raise exception 'A verification is either Approved or Rejected.';
  end if;

  update public.users
  set verification_status = p_status,
      verified_at = now(),
      -- An approval also lifts any suspension that came with it, which is what
      -- the Approve button always did.
      account_status = case when p_status = 'Approved' then 'Active' else account_status end,
      suspended_reason = case when p_status = 'Approved' then 'None' else suspended_reason end,
      verification_notes = case
        when p_status = 'Approved'
          then 'Cleared by an administrator after comparing the ID and the live photo.'
        else 'Refused by an administrator after comparing the ID and the live photo.'
      end
  where users_id = p_users_id
    and user_type <> 'Admin';

  if not found then
    raise exception 'No such account.';
  end if;
end;
$$;

comment on function public.admin_set_verification(uuid, text) is
  'Clears or refuses a flagged verification. The only path an Admin has to write verification_status, because column privileges are checked before row level security and the blanket revoke on users applies to the Admin too.';

-- ---------------------------------------------------------------------------
-- Deactivating and restoring an account
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_account_status(
  p_users_id uuid,
  p_status   text,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may change an account status.';
  end if;

  if p_status not in ('Active', 'Inactive') then
    raise exception 'An account is either Active or Inactive.';
  end if;

  -- Deactivating without saying why leaves the next reviewer, and the customer,
  -- with nothing to act on.
  if p_status = 'Inactive' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for deactivating the account.';
  end if;

  update public.users
  set account_status = p_status,
      suspended_reason = case
        when p_status = 'Inactive' then btrim(p_reason)
        else 'None'
      end
  where users_id = p_users_id
    and user_type <> 'Admin';

  if not found then
    raise exception 'No such account.';
  end if;
end;
$$;

comment on function public.admin_set_account_status(uuid, text, text) is
  'Deactivates or restores an account, with a written reason required for a deactivation.';

revoke all on function public.admin_set_verification(uuid, text) from public;
revoke all on function public.admin_set_account_status(uuid, text, text) from public;

grant execute on function public.admin_set_verification(uuid, text) to authenticated;
grant execute on function public.admin_set_account_status(uuid, text, text) to authenticated;
