-- Collateral, expected return, and a funding ceiling earned by evidence.
--
-- Three changes arriving together, because they are one change: a project stops
-- being an open-ended request for money and becomes a secured offer with a
-- stated return and a limit set by what the farm owner has proved.
--
-- ---------------------------------------------------------------------------
-- What this does to the business model
-- ---------------------------------------------------------------------------
--
-- A stated return plus a pledged asset is a secured loan, not an investment.
-- The previous agreement said the investor carried an ordinary farming loss;
-- that reverses. The farm owner now owes the amount back, and the pledged asset
-- is what the investor can pursue if they do not pay -- whether the cause is a
-- failed cycle, dead livestock, or the owner's death.
--
-- FarmVest records the agreement and the security interest. It does not lend
-- its own money and it does not foreclose: recovery is a legal matter between
-- the two parties, and the platform holds the documents that make it provable.
--
-- ---------------------------------------------------------------------------
-- The expected return
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists expected_roi_percent numeric(5, 2) not null default 0
    check (expected_roi_percent >= 0 and expected_roi_percent <= 100),
  -- Days rather than a due date, because a cycle starts when the project is
  -- funded and nobody knows when that will be at the time of posting.
  add column if not exists expected_cycle_days integer
    check (expected_cycle_days is null or expected_cycle_days between 1 and 1095);

comment on column public.projects.expected_roi_percent is
  'Return the farm owner expects to pay on top of the amount invested, as a percentage. Expected, never guaranteed: the cycle can still fail, which is why collateral is required.';

comment on column public.projects.expected_cycle_days is
  'How long the farm owner expects the cycle to run once funded. Not a due date: the clock starts at full funding, and that date is unknown at posting.';

-- ---------------------------------------------------------------------------
-- The collateral
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists collateral_type text not null default 'None',
  add column if not exists collateral_description text not null default 'None',
  add column if not exists collateral_value numeric(12, 2)
    check (collateral_value is null or collateral_value > 0);

comment on column public.projects.collateral_type is
  'What is pledged against this project: a land title, a vehicle, a building, equipment, or the livestock itself.';

comment on column public.projects.collateral_description is
  'Enough detail to identify the asset -- a title number, a plate number, a location -- so the pledge names something rather than a category.';

comment on column public.projects.collateral_value is
  'Value the farm owner declares for the pledged asset. It is the ceiling on the funding goal, enforced below: a project may not ask for more than the security behind it.';

-- The security is the ceiling. This is the one part of the funding limit that a
-- constraint can enforce by itself, because both figures sit on the same row;
-- the document tier below depends on rows inserted after this one and is
-- enforced by the form and verified by the Admin at review.
alter table public.projects drop constraint if exists projects_goal_within_collateral;

alter table public.projects
  add constraint projects_goal_within_collateral
  check (collateral_value is null or funding_goal <= collateral_value);

-- ---------------------------------------------------------------------------
-- Proof of the pledged asset
-- ---------------------------------------------------------------------------

alter table public.project_documents drop constraint if exists project_documents_type_check;

alter table public.project_documents
  add constraint project_documents_type_check
  check (doc_type in (
    -- Credentials: any of these answers "is this a real farmer".
    'RSBSA Registration',
    'Proof of Land',
    'Barangay or LGU Certification',
    'Business Permit',
    'Veterinary or Facility Permit',
    -- The pledged asset, which is now required on every project.
    'Collateral Proof',
    -- Project evidence: these answer "is this project real".
    'Farm Photo',
    'Project Proposal',
    'Cost Estimate'
  ));

-- ---------------------------------------------------------------------------
-- The funding ceiling, as the Admin sees it
-- ---------------------------------------------------------------------------

-- The same arithmetic the posting form runs, exposed so the review screen can
-- show what the project was entitled to ask for without recomputing it from
-- the client's own numbers.
create or replace function public.project_funding_cap(p_projects_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  with evidence as (
    select
      p.customers_id,
      p.collateral_value,
      p.rsbsa_name <> 'None' as has_rsbsa,
      (
        select count(distinct d.doc_type)
        from public.project_documents d
        where d.projects_id = p.projects_id
          and d.doc_type in (
            'RSBSA Registration',
            'Proof of Land',
            'Barangay or LGU Certification',
            'Business Permit',
            'Veterinary or Facility Permit'
          )
      ) as credentials
    from public.projects p
    where p.projects_id = p_projects_id
  )
  select least(
    -- Base entitlement from the strength of the paperwork, plus what the farm
    -- has already finished. A farm with a record is a better risk than any
    -- document says.
    case when e.credentials >= 3 or e.has_rsbsa then 100000 else 30000 end
      + 50000 * coalesce(
          (
            select count(*)
            from public.projects done
            where done.customers_id = e.customers_id
              and done.status = 'Completed'
          ),
          0
        ),
    -- And never more than the security behind it.
    coalesce(e.collateral_value, 0)
  )
  from evidence e;
$$;

comment on function public.project_funding_cap(uuid) is
  'The most this project was entitled to ask for: a base from the credential documents and the farm''s completed projects, capped by the declared collateral value.';

grant execute on function public.project_funding_cap(uuid) to authenticated;
