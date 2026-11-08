-- Investing, as one indivisible step.
--
-- Funding a project is four writes that have to agree: the investment row, the
-- signed contract, the project's running total, and the status flip when the
-- goal is reached. Done from the client they are four round trips with three
-- places to fail in between, and the failures are the expensive kind -- money
-- recorded against a project whose total never moved, or a total moved with no
-- investment behind it.
--
-- Worse, the check that matters cannot be done from the client at all. Two
-- investors reading "PHP 5,000 remaining" at the same moment will both pass
-- their own check and both insert, and the project ends up overfunded. The read
-- and the write have to happen under one lock, which means they have to happen
-- in the database.
--
-- So the whole thing is one function. It locks the project row, re-checks the
-- remaining balance against what it actually is now rather than what the client
-- saw, and either commits all four writes or none of them.

create or replace function public.invest_in_project(
  p_projects_id     uuid,
  p_amount          numeric,
  p_signatory_name  text,
  p_terms_snapshot  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project   public.projects%rowtype;
  v_remaining numeric;
  v_investor  uuid := auth.uid();
  v_new_id    uuid;
begin
  if v_investor is null then
    raise exception 'Sign in to invest.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;

  if coalesce(btrim(p_signatory_name), '') = '' then
    raise exception 'Type your full name to sign the agreement.';
  end if;

  -- Only an approved investor may fund anything. Checked here rather than
  -- trusted from the client, because this function runs as its owner and so
  -- bypasses the row level security that would otherwise catch it.
  if not exists (
    select 1
    from public.investors i
    join public.users u on u.users_id = i.investors_id
    where i.investors_id = v_investor
      and u.account_status = 'Active'
  ) then
    raise exception 'Your investor account is not active yet.';
  end if;

  -- for update is the whole point of doing this in the database: it holds the
  -- row until this transaction commits, so a second investor arriving at the
  -- same moment waits and then re-reads a total that already includes the first.
  select * into v_project
  from public.projects
  where projects_id = p_projects_id
  for update;

  if not found then
    raise exception 'That project no longer exists.';
  end if;

  if v_project.status not in ('Open', 'Funded', 'In Progress') then
    raise exception 'That project is not accepting investment right now.';
  end if;

  if v_project.farm_owners_id = v_investor then
    raise exception 'You cannot invest in your own project.';
  end if;

  v_remaining := v_project.funding_goal - v_project.current_funding;

  if v_remaining <= 0 then
    raise exception 'This project is already fully funded.';
  end if;

  if p_amount > v_remaining then
    raise exception 'Only % remains on this project.', to_char(v_remaining, 'FM999,999,999.00');
  end if;

  insert into public.investments (investors_id, projects_id, amount)
  values (v_investor, p_projects_id, p_amount)
  returning investments_id into v_new_id;

  -- The exact wording the investor accepted, stored with the agreement. The
  -- terms will be edited later and a contract that cannot be reproduced is not
  -- a contract.
  insert into public.contracts (investments_id, signatory_name, terms_snapshot, agreed_amount)
  values (v_new_id, btrim(p_signatory_name), p_terms_snapshot, p_amount);

  update public.projects
  set current_funding = current_funding + p_amount,
      -- Funded means the goal is met and the farm owner can start. Only Open
      -- advances: a project already In Progress keeps taking top-ups without
      -- being dragged backwards.
      status = case
                 when status = 'Open' and current_funding + p_amount >= funding_goal
                   then 'Funded'
                 else status
               end
  where projects_id = p_projects_id;

  return v_new_id;
end;
$$;

comment on function public.invest_in_project(uuid, numeric, text, text) is
  'Records one investment, its signed contract, and the project total as a single transaction. Locks the project row first, so concurrent investors cannot together overfund it.';

revoke all on function public.invest_in_project(uuid, numeric, text, text) from public;
grant execute on function public.invest_in_project(uuid, numeric, text, text) to authenticated;
