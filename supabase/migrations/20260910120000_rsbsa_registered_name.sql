-- RSBSA is typed, not uploaded.
--
-- It was offered as one of the document types, which was wrong about how the
-- check actually works. The public finder at finder-rsbsa.da.gov.ph does not
-- take a reference number at all -- it searches by first name, middle name,
-- last name, sex and birthday -- so a photograph of an RSBSA card gives the
-- Admin nothing they can put into it. What they need is the name as it was
-- registered, which is a text field.
--
-- That makes RSBSA the strongest credential on the form rather than the
-- weakest: it is the only one the Admin can verify against a government
-- database instead of by looking at a scan.

alter table public.projects
  add column if not exists rsbsa_name text not null default 'None';

comment on column public.projects.rsbsa_name is
  'Name as registered with RSBSA, which is what the public finder searches by. Checked against the valid ID on the account: a registered farmer whose RSBSA name does not match their government ID is the thing worth catching.';

comment on column public.projects.rsbsa_number is
  'RSBSA reference number, recorded for the file. The finder searches by name rather than by this, so it is corroboration rather than the lookup key.';

-- 'RSBSA Registration' stays in the project_documents check constraint even
-- though the form no longer offers it. Nothing new will be filed under it, and
-- removing a value that an existing row might use buys nothing.
