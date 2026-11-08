-- The expected sales of a project, stated when it is posted.
--
-- The budget said what the money buys; nothing said what the harvest is
-- expected to bring in. With the price a head is expected to sell for, the
-- head count and the expected mortality give the harvest and the sales, and
-- the investor and the Admin can see the cycle covers what it costs and what
-- it owes back before anyone funds it.

alter table public.projects
  add column if not exists expected_price_per_head numeric(12, 2)
    check (expected_price_per_head is null or expected_price_per_head > 0);

comment on column public.projects.expected_price_per_head is
  'What the farm owner expects one head to sell for at harvest. With estimated_heads and expected_mortality_percent it gives the expected sales.';
