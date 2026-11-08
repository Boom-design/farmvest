-- Create the profile row automatically when a new auth user signs up.
--
-- Email confirmation is enabled, so signUp() returns no session and the app
-- cannot insert into public.users itself: the row level security policy needs
-- auth.uid(), which is null until the user confirms and signs in. A definer
-- trigger on auth.users fills the profile from the metadata passed to signUp.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, email, contact_number, user_type)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'contact_number', ''),
    case
      when new.raw_user_meta_data ->> 'user_type' in ('Farm Owner', 'Investor')
        then new.raw_user_meta_data ->> 'user_type'
      else 'Farm Owner'
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
