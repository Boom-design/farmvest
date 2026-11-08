-- The funding ceiling gains a second route: the collateral itself.
--
-- The ceiling used to come from paperwork alone -- 30,000 with two
-- credentials, 100,000 with three or RSBSA, plus 50,000 per finished project --
-- and the collateral could only lower it. A farm owner pledging land worth
-- 500,000 with two certificates was held to 30,000, which says the asset
-- counted for nothing.
--
-- Now the better of two routes applies: the document allowance, or 70% of the
-- pledged asset's declared value, the loan-to-value ratio banks lend against.
-- Either way the request still never exceeds the asset, so it stays fully
-- secured. src/lib/funding.ts runs the same arithmetic for the posting form;
-- if one changes, change both.

create or replace function public.project_funding_cap(p_projects_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  with evidence as (
    select
      p.customers_id,
      coalesce(p.collateral_value, 0) as collateral,
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
  ),
  routes as (
    select
      e.collateral,
      -- Documents and record.
      (case when e.credentials >= 3 or e.has_rsbsa then 100000 else 30000 end)
        + 50000 * coalesce(
            (
              select count(*)
              from public.projects done
              where done.customers_id = e.customers_id
                and done.status = 'Completed'
            ),
            0
          ) as by_documents,
      -- The asset on its own.
      floor(e.collateral * 0.70) as by_collateral
    from evidence e
  )
  select least(greatest(r.by_documents, r.by_collateral), r.collateral)
  from routes r;
$$;

comment on function public.project_funding_cap(uuid) is
  'The most this project may ask for: the better of the document allowance (credentials plus completed projects) and 70% of the pledged collateral, never more than the collateral itself.';
