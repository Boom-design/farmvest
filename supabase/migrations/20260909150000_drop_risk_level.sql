-- Remove risk level from the schema.
--
-- It started as a dropdown on the farm owner's own form, which made it worth
-- nothing: the recommender weighted risk match at 25 of its 100 points, so a
-- project claiming Low ranked higher for a cautious investor, and the party
-- choosing the label was the party the label was about. Moving the choice to
-- the Admin removed that incentive but replaced it with a worse one -- two
-- Admins reading the same file would disagree, and neither could say why.
--
-- What actually tells an investor whether a project is sound is already on the
-- record and cannot be typed in: the two credential documents the Admin checks,
-- the photographs of the facility, what the farm has finished before, whether
-- anyone has filed a case against it, and the weather where it sits. The label
-- added nothing on top of those and invited being trusted more than they were.
--
-- The 25 points it carried went to budget fit and track record rather than
-- being dropped, so a strong match still scores near 100.
--
-- Nothing in the application reads or writes the column any more. This removes
-- it from the schema so it cannot quietly come back.

-- ---------------------------------------------------------------------------
-- The public view has to let go of it first
-- ---------------------------------------------------------------------------

-- Dropped rather than replaced: create or replace refuses a changed column list.
drop view if exists public.public_projects;

alter table public.projects drop column if exists risk_level;

create view public.public_projects as
  select
    p.projects_id,
    p.title,
    p.category,
    p.funding_goal,
    p.current_funding,
    p.status,
    p.image_url,
    p.created_at
  from public.projects p
  where p.status in ('Open', 'Funded', 'In Progress');

comment on view public.public_projects is
  'Teaser row for the landing page: what a project is and how far it is funded, and nothing that identifies the farm owner. Unapproved, rejected and frozen projects never appear.';

grant select on public.public_projects to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Risk appetite goes with it
-- ---------------------------------------------------------------------------

-- The appetite only ever existed to be matched against the level. With nothing
-- to match, it is a question asked of every investor whose answer is read by
-- nothing.
alter table public.investors drop column if exists risk_appetite;
