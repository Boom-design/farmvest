-- The farm location is now picked from cascading Philippine address lists
-- (province, then city or municipality, then barangay) instead of being typed.
--
-- The parts are stored separately so the Admin and the weather advisory can
-- filter by city or province; farm_location keeps the readable combined label.

alter table public.users
  add column if not exists farm_province text;

alter table public.users
  add column if not exists farm_city text;

alter table public.users
  add column if not exists farm_barangay text;

comment on column public.users.farm_location is
  'Readable address label: "Barangay, City, Province". The individual parts live in farm_barangay, farm_city and farm_province.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_type text;
  is_farm_owner boolean;
begin
  if new.email = public.admin_email() then
    resolved_type := 'Admin';
  elsif new.raw_user_meta_data ->> 'user_type' in ('Farm Owner', 'Investor') then
    resolved_type := new.raw_user_meta_data ->> 'user_type';
  else
    resolved_type := 'Farm Owner';
  end if;

  is_farm_owner := resolved_type = 'Farm Owner';

  insert into public.users (
    users_id, name, email, contact_number, user_type,
    verification_status, verified_at,
    farm_location, farm_province, farm_city, farm_barangay, valid_id_url
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'contact_number', ''),
    resolved_type,
    case when resolved_type = 'Admin' then 'Approved' else 'Pending' end,
    case when resolved_type = 'Admin' then now() else null end,
    case when is_farm_owner then new.raw_user_meta_data ->> 'farm_location' end,
    case when is_farm_owner then new.raw_user_meta_data ->> 'farm_province' end,
    case when is_farm_owner then new.raw_user_meta_data ->> 'farm_city' end,
    case when is_farm_owner then new.raw_user_meta_data ->> 'farm_barangay' end,
    case when is_farm_owner then new.raw_user_meta_data ->> 'valid_id_url' end
  )
  on conflict (users_id) do nothing;

  return new;
end;
$$;
