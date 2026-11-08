-- Close the over-broad read policies.
--
-- The publishable key is public by design, so row level security is the only
-- thing standing between a signed-in account and everyone else's data. Three
-- tables were readable by any authenticated user, which meant a farm owner who
-- signed up could call the API directly and read every account's email, contact
-- number and farm address. None of the app's screens need that.
--
-- What each screen actually reads:
--   users            - own row (auth, account page, login check) or the Admin
--   farm_owners      - own row, or the Admin reviewing an account
--   progress_updates - the farm owner who posted them, the Admin, or an
--                      investor who funded that project

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can read profiles" on public.users;

create policy "Users read their own profile"
  on public.users for select to authenticated
  using (auth.uid() = users_id or public.is_admin());

-- ---------------------------------------------------------------------------
-- farm_owners
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users read farm owners" on public.farm_owners;

create policy "Farm owners read their own row"
  on public.farm_owners for select to authenticated
  using (auth.uid() = farm_owners_id or public.is_admin());

-- An investor still has to see whose project they are funding, so the public
-- half of a farm owner profile is exposed through a view instead: name and
-- general location only, never the government ID. A plain view is not
-- security_invoker, so it reads as its owner and is not blocked by the policy
-- above.
create or replace view public.farm_owner_directory as
  select
    fo.farm_owners_id,
    u.name,
    fo.farm_city,
    fo.farm_province
  from public.farm_owners fo
  join public.users u on u.users_id = fo.farm_owners_id;

comment on view public.farm_owner_directory is
  'Public half of a farm owner profile for investor browsing: name and area only. The address detail and the government ID stay behind the farm_owners policy.';

grant select on public.farm_owner_directory to authenticated;

-- ---------------------------------------------------------------------------
-- progress_updates
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can read progress updates" on public.progress_updates;

create policy "Investors and owners read progress updates"
  on public.progress_updates for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.projects p
      where p.projects_id = progress_updates.projects_id
        and p.farm_owners_id = auth.uid()
    )
    or exists (
      select 1 from public.investments i
      where i.projects_id = progress_updates.projects_id
        and i.investors_id = auth.uid()
    )
  );
