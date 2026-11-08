-- The evidence behind an investment recommendation.
--
-- AI #1 ranks projects on the farm owner's record as much as on the project's
-- own numbers, and an investor cannot read that record directly: progress
-- updates are limited to projects they already funded, and a dispute case is
-- visible only to the parties and the Admin. Both restrictions are correct and
-- stay.
--
-- What an investor legitimately needs before handing over money is not the
-- contents of those rows but their shape: how many projects this farm has
-- finished, how recently it posted proof of work, how it has been rated, and
-- whether a case is open against it. Those are counts and dates, so they are
-- exposed as aggregates through a plain view.
--
-- A plain view is not security_invoker, so it runs as its owner and is not
-- stopped by the policies above, which makes the select list below the security
-- boundary. Nothing identifying leaves it: no photo, no note, no coordinate, no
-- complaint text, no reviewer. Only the farm_owners_id, which the investor
-- already has from farm_owner_directory.
--
-- Scalar subqueries rather than joins: a single query joining projects,
-- progress_updates, reviews and reports would multiply the rows against each
-- other and count everything several times over.

create or replace view public.farm_owner_track_record as
select
  fo.farm_owners_id,

  (
    select count(*)
    from public.projects p
    where p.farm_owners_id = fo.farm_owners_id
      and p.status = 'Completed'
  ) as completed_projects,

  (
    select count(*)
    from public.projects p
    where p.farm_owners_id = fo.farm_owners_id
  ) as total_projects,

  -- How recently this farm proved it is working, which is the single strongest
  -- signal an investor has between milestones.
  (
    select max(pu.captured_at)
    from public.progress_updates pu
    join public.projects p on p.projects_id = pu.projects_id
    where p.farm_owners_id = fo.farm_owners_id
  ) as last_update_at,

  (
    select count(*)
    from public.progress_updates pu
    join public.projects p on p.projects_id = pu.projects_id
    where p.farm_owners_id = fo.farm_owners_id
  ) as progress_update_count,

  (
    select round(avg(r.rating), 2)
    from public.reviews r
    where r.reviewee_farm_owners_id = fo.farm_owners_id
  ) as average_rating,

  (
    select count(*)
    from public.reviews r
    where r.reviewee_farm_owners_id = fo.farm_owners_id
  ) as rating_count,

  -- Decided cases are left out: a dismissed complaint is not a mark against
  -- anyone, and a resolved one has already been dealt with.
  (
    select count(*)
    from public.reports rp
    where rp.reported_farm_owners_id = fo.farm_owners_id
      and rp.status in ('Open', 'Reviewing')
  ) as open_disputes

from public.farm_owners fo;

comment on view public.farm_owner_track_record is
  'Aggregate record of a farm owner for the investment recommender: completed projects, progress-update recency, rating, and open dispute count. Counts and dates only, never the underlying rows.';

grant select on public.farm_owner_track_record to authenticated;
