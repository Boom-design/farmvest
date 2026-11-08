-- Proof that a posted project is a real farm doing real work.
--
-- Until now the Admin approved a project on the strength of the words the farm
-- owner typed. Nothing else reached the review screen -- not even the cover
-- photo, which the admin query never selected. Approval was a guess.
--
-- Two different questions have to be answered before a project reaches an
-- investor, and they need different evidence:
--
--   Is this a real farmer or farm business?
--     RSBSA, proof of land, a barangay certification, a business permit, or a
--     veterinary facility permit. Any one of them is enough. Requiring a
--     specific one would be wrong: RSBSA covers the basic sector and a
--     registered farm business is often not in it at all, while a smallholder
--     in a remote barangay may hold nothing but a barangay certificate.
--     Rejecting either would be rejecting a real farmer.
--
--   Is this particular project real?
--     Photos of the actual facility, a proposal, and a cost estimate. These are
--     per project because they describe this cycle, not the farm in general.
--
-- Risk level moves to the Admin in the same change. It was declared by the farm
-- owner, who has an incentive to understate it -- the recommender gives risk
-- match 25 of its 100 points, so a project claiming Low ranks higher for a
-- cautious investor. The Admin now sets it at approval, having just read the
-- documents, which is the only point in the flow where anyone has the evidence
-- to judge it.

-- ---------------------------------------------------------------------------
-- The RSBSA reference
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists rsbsa_number text not null default 'None';

comment on column public.projects.rsbsa_number is
  'Registry System for Basic Sectors in Agriculture reference, when the farm owner has one. Optional: the public finder at finder-rsbsa.da.gov.ph searches by name and birthday rather than by this number, so it is recorded for the file rather than used as a lookup key.';

comment on column public.projects.risk_level is
  'Set by the Admin at approval, not by the farm owner. Self-declared risk was worth nothing: the recommender weights risk match at 25 points, so understating it raised the score.';

-- ---------------------------------------------------------------------------
-- The documents
-- ---------------------------------------------------------------------------

create table if not exists public.project_documents (
  project_documents_id uuid primary key default gen_random_uuid(),
  projects_id          uuid not null
                         references public.projects (projects_id) on delete cascade,
  doc_type             text not null,
  -- Object path in the private project-documents bucket, not a public URL.
  file_url             text not null,
  -- Kept so the Admin sees what the farm owner actually attached.
  file_name            text not null default 'None',
  uploaded_at          timestamptz not null default now()
);

alter table public.project_documents drop constraint if exists project_documents_type_check;

alter table public.project_documents
  add constraint project_documents_type_check
  check (doc_type in (
    -- Credentials: any one of these answers "is this a real farmer".
    'RSBSA Registration',
    'Proof of Land',
    'Barangay or LGU Certification',
    'Business Permit',
    'Veterinary or Facility Permit',
    -- Project evidence: these answer "is this project real".
    'Farm Photo',
    'Project Proposal',
    'Cost Estimate'
  ));

create index if not exists project_documents_projects_id_idx
  on public.project_documents (projects_id);

comment on table public.project_documents is
  'Supporting files attached to a project at posting. Credential types prove the farmer or farm business exists; the rest describe this particular project. Visible to the owning farm owner and the Admin only -- they carry names, addresses and permit numbers, so investors never see them.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.project_documents enable row level security;

drop policy if exists "Farm owners read their own project documents" on public.project_documents;
drop policy if exists "Farm owners attach their own project documents" on public.project_documents;
drop policy if exists "Admin reads every project document" on public.project_documents;

-- Deliberately not readable by investors. A permit carries a name, an address
-- and a registration number, none of which an investor needs to decide.
create policy "Farm owners read their own project documents"
  on public.project_documents for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.projects p
      where p.projects_id = project_documents.projects_id
        and p.farm_owners_id = auth.uid()
    )
  );

create policy "Farm owners attach their own project documents"
  on public.project_documents for insert to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.projects_id = project_documents.projects_id
        and p.farm_owners_id = auth.uid()
    )
  );

-- No update policy on purpose, the same rule the payments table follows: a
-- submitted document is a claim on the record, and letting the claimant swap
-- the file after the Admin read it would make the review meaningless.

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-documents',
  'project-documents',
  false, -- permits and certificates carry personal data
  10485760, -- 10 MB, larger than a receipt because a scanned permit runs long
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Farm owners upload their own project documents" on storage.objects;
drop policy if exists "Farm owners read their own project documents" on storage.objects;
drop policy if exists "Admin reads every project document file" on storage.objects;
drop policy if exists "Admin deletes project document files" on storage.objects;

-- Own folder only, the same rule the avatars, progress-photos and
-- payment-proofs buckets use.
create policy "Farm owners upload their own project documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Farm owners read their own project documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Admin reads every project document file"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-documents' and public.is_admin());

create policy "Admin deletes project document files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-documents' and public.is_admin());
