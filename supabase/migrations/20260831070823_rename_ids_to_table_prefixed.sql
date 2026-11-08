-- Rename every primary key to <table_name>_id and make foreign keys carry that
-- same name, so a column tells you which table it points at.
--
-- Where a table references users twice, the role is kept as a prefix
-- (reporter_users_id, reviewer_users_id) because two columns cannot share a name.
--
-- Row level security policies follow column renames automatically; the
-- handle_new_user function does not, so it is recreated at the end.

alter table public.users rename column id to users_id;

alter table public.projects rename column id to projects_id;
alter table public.projects rename column farm_owner_id to users_id;

alter table public.investments rename column id to investments_id;
alter table public.investments rename column investor_id to users_id;
alter table public.investments rename column project_id to projects_id;

alter table public.progress_updates rename column id to progress_updates_id;
alter table public.progress_updates rename column project_id to projects_id;

alter table public.equipment rename column id to equipment_id;

alter table public.rentals rename column id to rentals_id;
alter table public.rentals rename column farm_owner_id to users_id;
-- rentals.equipment_id already matches the convention.

alter table public.reports rename column id to reports_id;
alter table public.reports rename column reported_by to reporter_users_id;
alter table public.reports rename column target_user_id to reported_users_id;

alter table public.reviews rename column id to reviews_id;
alter table public.reviews rename column reviewer_id to reviewer_users_id;
alter table public.reviews rename column reviewee_id to reviewee_users_id;

-- Keep index names in step with the columns they cover.
alter index projects_farm_owner_id_idx rename to projects_users_id_idx;
alter index investments_investor_id_idx rename to investments_users_id_idx;
alter index investments_project_id_idx rename to investments_projects_id_idx;
alter index progress_updates_project_id_idx rename to progress_updates_projects_id_idx;
alter index rentals_farm_owner_id_idx rename to rentals_users_id_idx;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (users_id, name, email, contact_number, user_type)
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
  on conflict (users_id) do nothing;

  return new;
end;
$$;
