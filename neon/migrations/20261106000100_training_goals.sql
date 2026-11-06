-- =============================================================================
-- Training goals: weekly targets a person sets for themselves (rounds, wins,
-- takedowns, submission attempts, guard passes, sweeps). One target per kind.
-- Only the person can see or change their goals; the app works out the
-- progress and streaks from their own matches, which RLS already limits to
-- them.
-- =============================================================================

create table public.training_goals (
  user_id uuid not null default app.uid() references app.users (id) on delete cascade,
  kind text not null
    constraint goal_kind check (kind in ('rounds', 'wins', 'takedowns', 'submission_attempts', 'guard_passes', 'sweeps')),
  target integer not null
    constraint goal_target check (target between 1 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.training_goals enable row level security;
revoke all on public.training_goals from public, anon, anonymous, authenticated;
grant select, insert, update, delete on public.training_goals to authenticated;
grant all on public.training_goals to service_role;

-- Your own goals only. Banned and suspended accounts can read but not change them.
create policy training_goals_select on public.training_goals
  for select to authenticated
  using (user_id = (select app.uid()));

create policy training_goals_insert on public.training_goals
  for insert to authenticated
  with check (
    user_id = (select app.uid())
    and not private.is_banned((select app.uid()))
    and not private.is_suspended((select app.uid()))
  );

create policy training_goals_update on public.training_goals
  for update to authenticated
  using (user_id = (select app.uid()))
  with check (
    user_id = (select app.uid())
    and not private.is_banned((select app.uid()))
    and not private.is_suspended((select app.uid()))
  );

create policy training_goals_delete on public.training_goals
  for delete to authenticated
  using (user_id = (select app.uid()));

-- updated_at follows every change.
create or replace function private.touch_training_goal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger training_goals_touch
  before update on public.training_goals
  for each row execute function private.touch_training_goal();
