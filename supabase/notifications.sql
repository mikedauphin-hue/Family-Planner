-- Run AFTER the original setup.sql. This does not change plans or memberships.
begin;
create table if not exists public.planner_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  updated_at timestamptz not null default now(),
  last_test_at timestamptz
);
create table if not exists public.planner_notification_deliveries (
  subscription_id uuid not null references public.planner_push_subscriptions(id) on delete cascade,
  plan_date date not null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  primary key (subscription_id, plan_date)
);
alter table public.planner_push_subscriptions enable row level security;
alter table public.planner_notification_deliveries enable row level security;
-- Subscription endpoints/keys must not be readable by either client or the public.
revoke all on public.planner_push_subscriptions from anon, authenticated;
revoke all on public.planner_notification_deliveries from anon, authenticated;
grant all on public.planner_push_subscriptions to service_role;
grant all on public.planner_notification_deliveries to service_role;
create or replace function public.claim_planner_notification(subscription_id uuid, plan_date date)
returns boolean language sql security definer set search_path = '' as $$
  with claim as (
    insert into public.planner_notification_deliveries(subscription_id, plan_date)
    values ($1, $2)
    on conflict (subscription_id, plan_date) do update set claimed_at = now()
      where planner_notification_deliveries.sent_at is null
        and planner_notification_deliveries.claimed_at < now() - interval '2 minutes'
    returning 1
  ) select exists(select 1 from claim);
$$;
revoke all on function public.claim_planner_notification(uuid,date) from public, anon, authenticated;
grant execute on function public.claim_planner_notification(uuid,date) to service_role;
commit;
