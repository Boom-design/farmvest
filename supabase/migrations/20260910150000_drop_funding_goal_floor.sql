-- The minimum belongs to the investor, not to the goal.
--
-- A PHP 500 floor was put on funding_goal on the reasoning that a goal under
-- the minimum investment could not be met by a single ordinary commitment. That
-- reasoning was wrong, because invest_in_project already waives the minimum for
-- an amount that exactly closes the remaining balance: a PHP 300 project is
-- funded by one PHP 300 investment, and always was.
--
-- So the floor protected nothing and only stopped a farm owner from asking for
-- what they actually needed. The minimum stays where it belongs, on the
-- investment, where it exists to keep a signed contract worth more than the
-- paperwork behind it.

alter table public.projects drop constraint if exists projects_funding_goal_floor;

-- The original check from create_core_tables stands: a goal still has to be
-- greater than zero.
