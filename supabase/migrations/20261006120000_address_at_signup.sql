-- The address comes back to registration.
--
-- It was taken out when identity verification moved to project posting, on the
-- reasoning that someone who only invests has no farm to declare. That was
-- right about the farm and wrong about the address: everyone has one, the
-- platform needs it to show an investor roughly where a project is, and the
-- weather advisory has nothing to forecast without it.
--
-- So it is asked for again at signup, as an address rather than a farm address.
-- It is stored in the same four columns, because for a customer who farms it is
-- the farm location, and for one who does not it is simply where they are.

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
  else
    resolved_type := 'Customer';
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
    -- The Admin is verified by being the Admin. A customer is Pending until
    -- they choose to post a project, which is not a queue anyone is waiting in.
    case when resolved_type = 'Admin' then 'Approved' else 'Pending' end,
    case when resolved_type = 'Admin' then now() else null end,
    'None',
    -- The government ID arrives later, with the verification it belongs to.
    'None',
    null
  )
  on conflict (users_id) do nothing;

  if resolved_type = 'Customer' then
    insert into public.customers (
      customers_id, farm_location, farm_province, farm_city, farm_barangay
    )
    values (
      new.id,
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_location'), ''), 'None'),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_province'), ''), 'None'),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_city'), ''), 'None'),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_barangay'), ''), 'None')
    )
    on conflict (customers_id) do nothing;
  end if;

  return new;
end;
$$;
