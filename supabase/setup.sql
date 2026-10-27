-- First create and confirm BOTH app accounts. Replace the two emails below.
-- This script is intentionally for ONE shared planner with EXACTLY TWO members.
begin;
create table if not exists public.planner_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.planner_entries (
  id text primary key check (length(id) between 1 and 200),
  value text not null check (length(value) <= 20000)
);
alter table public.planner_members enable row level security;
alter table public.planner_entries enable row level security;
revoke all on public.planner_members from anon, authenticated;
revoke all on public.planner_entries from anon, authenticated;
grant select on public.planner_members to authenticated;
grant select, insert, update on public.planner_entries to authenticated;
drop policy if exists "Read own membership" on public.planner_members;
create policy "Read own membership" on public.planner_members
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Two members read planner" on public.planner_entries;
create policy "Two members read planner" on public.planner_entries
  for select to authenticated using (
    exists (select 1 from public.planner_members where user_id = (select auth.uid()))
  );
drop policy if exists "Two members insert planner" on public.planner_entries;
create policy "Two members insert planner" on public.planner_entries
  for insert to authenticated with check (
    exists (select 1 from public.planner_members where user_id = (select auth.uid()))
  );
drop policy if exists "Two members update planner" on public.planner_entries;
create policy "Two members update planner" on public.planner_entries
  for update to authenticated using (
    exists (select 1 from public.planner_members where user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.planner_members where user_id = (select auth.uid()))
  );
-- Replace these two addresses with the CONFIRMED app account emails.
do $$
declare
  first_email text := 'REPLACE-FIRST@example.com';
  second_email text := 'REPLACE-SECOND@example.com';
  matched integer;
begin
  if lower(first_email) = lower(second_email) then
    raise exception 'Use two different email addresses.';
  end if;
  select count(*) into matched from auth.users
    where lower(email) in (lower(first_email), lower(second_email))
      and email_confirmed_at is not null;
  if matched <> 2 then
    raise exception 'Both people must create and confirm their accounts first. Check the two emails in this script.';
  end if;
  delete from public.planner_members;
  insert into public.planner_members(user_id)
    select id from auth.users where lower(email) in (lower(first_email), lower(second_email))
      and email_confirmed_at is not null;
end $$;
commit;
