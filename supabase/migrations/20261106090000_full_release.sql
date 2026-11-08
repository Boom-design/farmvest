-- Funds now reach the farm owner in one full release once the project is
-- funded: the whole raise, less FarmVest's 5% commission. The staged
-- Initial/Midterm/Final values stay allowed so earlier records still read.
alter table public.fund_releases drop constraint if exists fund_releases_stage_check;
alter table public.fund_releases add constraint fund_releases_stage_check
  check (stage in ('Full', 'Initial', 'Midterm', 'Final'));

alter table public.investments drop constraint if exists investments_milestone_stage_check;
alter table public.investments add constraint investments_milestone_stage_check
  check (milestone_stage in ('Full', 'Initial', 'Midterm', 'Final'));
