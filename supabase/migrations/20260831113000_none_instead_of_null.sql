-- Store the word None instead of NULL in the optional text columns.
--
-- This is deliberately not the usual modelling choice: NULL is what "the user
-- left this blank" normally means, and a literal 'None' cannot be told apart
-- from a real answer of "None". It is done here so the tables read cleanly in
-- the Supabase table editor during the defense.
--
-- Only descriptive text is covered. Timestamps, numbers, coordinates and the two
-- file paths (valid_id_url, avatar_url) stay nullable, because 'None' is not a
-- valid value for those types and would break the "is a file attached?" check.
-- The app prints None for them instead.

-- ---------------------------------------------------------------------------
-- Backfill, then make None the default for anything inserted later
-- ---------------------------------------------------------------------------

do $$
declare
  target record;
begin
  for target in
    select *
    from (
      values
        ('users',            'contact_number'),
        ('users',            'suspended_reason'),
        ('farm_owners',      'farm_location'),
        ('farm_owners',      'farm_province'),
        ('farm_owners',      'farm_city'),
        ('farm_owners',      'farm_barangay'),
        ('farm_owners',      'valid_id_type'),
        ('projects',         'description'),
        ('projects',         'rejection_reason'),
        ('equipment',        'unit_code'),
        ('equipment',        'type'),
        ('equipment',        'condition_notes'),
        ('rentals',          'admin_notes'),
        ('progress_updates', 'notes'),
        ('maintenance_logs', 'description'),
        ('reviews',          'comment')
    ) as t(table_name, column_name)
  loop
    -- Blank strings are the same thing as NULL to the person reading the table.
    execute format(
      'update public.%I set %I = ''None'' where %I is null or btrim(%I) = ''''',
      target.table_name, target.column_name, target.column_name, target.column_name
    );

    execute format(
      'alter table public.%I alter column %I set default ''None''',
      target.table_name, target.column_name
    );

    execute format(
      'alter table public.%I alter column %I set not null',
      target.table_name, target.column_name
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The signup trigger writes None for anything the form left empty
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
    suspended_reason
  )
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), 'None'),
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'contact_number'), ''), 'None'),
    resolved_type,
    case when resolved_type = 'Admin' then 'Approved' else 'Pending' end,
    case when resolved_type = 'Admin' then now() else null end,
    'None'
  )
  on conflict (users_id) do nothing;

  if resolved_type = 'Farm Owner' then
    insert into public.farm_owners (
      farm_owners_id, farm_location, farm_province, farm_city, farm_barangay,
      valid_id_type, valid_id_url
    )
    values (
      new.id,
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_location'), ''), 'None'),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_province'), ''), 'None'),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_city'), ''), 'None'),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'farm_barangay'), ''), 'None'),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'valid_id_type'), ''), 'None'),
      -- Left NULL when no file was uploaded: the app tests this to decide
      -- whether there is an ID to open.
      nullif(btrim(new.raw_user_meta_data ->> 'valid_id_url'), '')
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
