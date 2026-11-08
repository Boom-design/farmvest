-- Move identity verification from farm_owners up to users.
--
-- The government ID was on farm_owners because, at the time, a farm owner was
-- the only party who uploaded one. An investor is now verified the same way:
-- the platform handles investment money, so identifying the customer is the
-- ordinary anti-money-laundering check that every investment service performs,
-- and an approval with nothing behind it is not a verification.
--
-- That makes the ID an account fact rather than a role fact, so it belongs on
-- the account supertype. The subtypes keep only what is genuinely theirs: the
-- farm address for a farm owner, the budget and risk appetite for an investor.
-- One consequence worth having: User Management reads the ID from one place
-- instead of one per role.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- valid_id_type follows the None convention the rest of the optional text
-- columns use. valid_id_url stays nullable, because the app tests it to decide
-- whether a file was uploaded at all, and 'None' is not a path.
alter table public.users
  add column if not exists valid_id_type text not null default 'None',
  add column if not exists valid_id_url text;

comment on column public.users.valid_id_type is
  'Government ID the account holder submitted, for the Admin to check before approving.';

comment on column public.users.valid_id_url is
  'Object path in the private valid-ids bucket. NULL when no file was uploaded.';

-- ---------------------------------------------------------------------------
-- Carry the existing farm owner IDs across
-- ---------------------------------------------------------------------------

update public.users u
set
  valid_id_type = coalesce(nullif(btrim(f.valid_id_type), ''), 'None'),
  valid_id_url = f.valid_id_url
from public.farm_owners f
where f.farm_owners_id = u.users_id;

alter table public.farm_owners
  drop column if exists valid_id_type,
  drop column if exists valid_id_url;

-- ---------------------------------------------------------------------------
-- The signup trigger writes the ID onto users for either role
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_type text;
begin
  if new.email = public.admin_email() then
    resolved_type := 'Admin';
  elsif new.raw_user_meta_data ->> 'user_type' in ('Farm Owner', 'Investor') then
    resolved_type := new.raw_user_meta_data ->> 'user_type';
  else
    resolved_type := 'Farm Owner';
  end if;

  insert into public.users (
    users_id, name, email, contact_number, user_type, verification_status, verified_at,
    suspended_reason, valid_id_type, valid_id_url
  )
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), 'None'),
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'contact_number'), ''), 'None'),
    resolved_type,
    case when resolved_type = 'Admin' then 'Approved' else 'Pending' end,
    case when resolved_type = 'Admin' then now() else null end,
    'None',
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'valid_id_type'), ''), 'None'),
    -- Left NULL when no file was uploaded: the app tests this to decide
    -- whether there is an ID to open.
    nullif(btrim(new.raw_user_meta_data ->> 'valid_id_url'), '')
  )
  on conflict (users_id) do nothing;

  if resolved_type = 'Farm Owner' then
    insert into public.farm_owners (
      farm_owners_id, farm_location, farm_province, farm_city, farm_barangay
    )
    values (
      new.id,
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_location'), ''), 'None'),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_province'), ''), 'None'),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_city'), ''), 'None'),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_barangay'), ''), 'None')
    )
    on conflict (farm_owners_id) do nothing;

  elsif resolved_type = 'Investor' then
    insert into public.investors (investors_id)
    values (new.id)
    on conflict (investors_id) do nothing;
  end if;

  return new;
end;
$$;
