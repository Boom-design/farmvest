-- What an investor sees about a project before funding it, and a column-name
-- repair that had been hiding the farm owner's name.
--
-- ---------------------------------------------------------------------------
-- The repair
-- ---------------------------------------------------------------------------
--
-- The role merge renamed farm_owner_directory and farm_owner_track_record to
-- customer_directory and customer_track_record, but renaming a view does not
-- rename its columns: both still exposed farm_owners_id. Every query in the
-- app asks for customers_id, so each one failed quietly -- Browse Projects
-- showed no owner name, no weather line, and the recommender scored every farm
-- as having no track record.

alter view public.customer_directory rename column farm_owners_id to customers_id;
alter view public.customer_track_record rename column farm_owners_id to customers_id;

-- ---------------------------------------------------------------------------
-- The directory gains the barangay
-- ---------------------------------------------------------------------------
--
-- Name, barangay, city and province: enough for an investor to know whose farm
-- it is and roughly where, not enough to find the house. The street address,
-- the government ID and the documents stay behind their policies.

create or replace view public.customer_directory as
select
  c.customers_id,
  u.name,
  nullif(c.farm_city, 'None') as farm_city,
  nullif(c.farm_province, 'None') as farm_province,
  nullif(c.farm_barangay, 'None') as farm_barangay
from public.customers c
join public.users u on u.users_id = c.customers_id;

comment on view public.customer_directory is
  'Public half of a customer profile for browsing: name, barangay, city and province. The street address, the government ID and the documents stay behind their policies.';

grant select on public.customer_directory to authenticated;

-- ---------------------------------------------------------------------------
-- Which requirements a project was approved on, without the files
-- ---------------------------------------------------------------------------
--
-- project_documents is closed to investors because the files carry names,
-- addresses and registration numbers (Data Privacy Act of 2012). What an
-- investor needs is the fact that each requirement was attached and reviewed,
-- so this view gives the document types only, for projects that passed review.

create or replace view public.project_credentials as
select distinct d.projects_id, d.doc_type
from public.project_documents d
join public.projects p on p.projects_id = d.projects_id
where p.status not in ('Pending Approval', 'Rejected');

comment on view public.project_credentials is
  'The document types a reviewed project was posted with -- never the files, names or numbers inside them.';

grant select on public.project_credentials to authenticated;
