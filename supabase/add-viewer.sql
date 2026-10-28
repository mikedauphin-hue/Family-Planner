-- Create/confirm the viewer's Authentication user first, then replace the ONE email below.
-- This adds private read-only access. Existing editors, plans, and notifications are unchanged.
begin;
create table if not exists public.planner_viewers (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.planner_viewers enable row level security;
revoke all on public.planner_viewers from anon, authenticated;
grant select on public.planner_viewers to authenticated;
grant all on public.planner_viewers to service_role;
drop policy if exists "Read own viewer access" on public.planner_viewers;
create policy "Read own viewer access" on public.planner_viewers
  for select to authenticated using (user_id = (select auth.uid()));
-- SELECT only: existing write policies continue to require membership in planner_members.
drop policy if exists "Approved viewers read planner" on public.planner_entries;
create policy "Approved viewers read planner" on public.planner_entries
  for select to authenticated using (
    exists (select 1 from public.planner_viewers where user_id = (select auth.uid()))
  );
do $$
declare
  viewer_email text := 'REPLACE-VIEWER@example.com';
  viewer_id uuid;
begin
  select id into viewer_id from auth.users
    where lower(email) = lower(trim(viewer_email)) and email_confirmed_at is not null;
  if viewer_id is null then
    raise exception 'Create and confirm the viewer account first, then replace REPLACE-VIEWER@example.com with its email.';
  end if;
  if exists (select 1 from public.planner_members where user_id = viewer_id) then
    raise exception 'This email belongs to an existing editor. Use a different account; editor access was not changed.';
  end if;
  insert into public.planner_viewers(user_id) values (viewer_id) on conflict do nothing;
end $$;
commit;
