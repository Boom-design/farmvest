-- Turn a report into a case the Admin can actually decide.
--
-- A report used to name two people and nothing else, so the Admin had no way to
-- reach the evidence. A case now points at the project it is about, carries a
-- category, and records how it ended. The project itself can be frozen while the
-- case is open, which is what protects the money: a frozen project takes no new
-- investment and releases no further milestone.

-- ---------------------------------------------------------------------------
-- reports becomes a case record
-- ---------------------------------------------------------------------------

alter table public.reports
  add column if not exists projects_id uuid
    references public.projects (projects_id) on delete set null;

comment on column public.reports.projects_id is
  'The project the case is about. Null for a complaint that is not tied to one, such as conduct during an equipment rental.';

create index if not exists reports_projects_id_idx on public.reports (projects_id);

alter table public.reports
  add column if not exists category text not null default 'Other';

alter table public.reports drop constraint if exists reports_category_check;

alter table public.reports
  add constraint reports_category_check
  check (category in (
    'No progress updates',
    'Fake progress photos',
    'Misuse of funds',
    'Unresponsive',
    'Equipment damage',
    'Other'
  ));

-- How the case ended, and who ended it. resolved_by holds the Admin's email
-- rather than a foreign key: only farm_owners and investors reference users, and
-- the Admin is neither.
alter table public.reports
  add column if not exists resolution text not null default 'None';

alter table public.reports
  add column if not exists resolved_at timestamptz;

alter table public.reports
  add column if not exists resolved_by text;

comment on column public.reports.resolved_by is
  'Email of the Admin who closed the case. Text rather than a foreign key because the Admin has no subtype table.';

-- ---------------------------------------------------------------------------
-- Freezing a project under investigation
-- ---------------------------------------------------------------------------

alter table public.projects drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status in (
    'Pending Approval',
    'Rejected',
    'Open',
    'Funded',
    'In Progress',
    'Under Investigation',
    'Completed',
    'Cancelled'
  ));

comment on column public.projects.status is
  'Under Investigation is the freeze used while a dispute is open: the project is hidden from investors, takes no new investment, and releases no further milestone.';

-- A frozen project drops out of the catalogue the same way an unapproved one
-- does; its own farm owner can still see it.
drop policy if exists "Authenticated users read approved projects" on public.projects;

create policy "Authenticated users read approved projects"
  on public.projects for select to authenticated
  using (
    status not in ('Pending Approval', 'Rejected', 'Under Investigation')
    or auth.uid() = farm_owners_id
    or public.is_admin()
  );

-- No new money into a project that is frozen, rejected or not yet approved.
drop policy if exists "Investors create their own investments" on public.investments;

create policy "Investors create their own investments"
  on public.investments for insert to authenticated
  with check (
    auth.uid() = investors_id
    and exists (
      select 1
      from public.projects p
      where p.projects_id = investments.projects_id
        and p.status in ('Open', 'Funded', 'In Progress')
    )
  );
