-- Enable pg_cron and pg_net in Supabase Database → Extensions before running.
-- Replace the TWO placeholders. Keep PLANNER_CRON_SECRET private.
-- This stores the scheduler credential in Supabase Vault, never in public tables.
begin;
do $$
declare
  project_url text := 'REPLACE_WITH_PROJECT_URL';
  cron_secret text := 'REPLACE_WITH_PLANNER_CRON_SECRET';
begin
  if project_url !~ '^https://[a-z0-9-]+\.supabase\.co$' or length(cron_secret) < 32 or cron_secret like 'REPLACE%' then
    raise exception 'Replace the project URL (no trailing slash) and private cron secret first.';
  end if;
  if exists(select 1 from vault.secrets where name='planner_notification_url') then
    perform vault.update_secret((select id from vault.secrets where name='planner_notification_url'), project_url || '/functions/v1/planner-notifications');
  else
    perform vault.create_secret(project_url || '/functions/v1/planner-notifications', 'planner_notification_url');
  end if;
  if exists(select 1 from vault.secrets where name='planner_notification_cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name='planner_notification_cron_secret'), cron_secret);
  else
    perform vault.create_secret(cron_secret, 'planner_notification_cron_secret');
  end if;
  if exists(select 1 from cron.job where jobname='planner-nightly-eastern') then
    perform cron.unschedule('planner-nightly-eastern');
  end if;
end $$;
-- 01:00 UTC is 9 p.m. Eastern in summer; 02:00 UTC is 9 p.m. in winter.
-- Three attempts per candidate hour; the handler checks New York time and deduplicates.
select cron.schedule('planner-nightly-eastern', '0,5,10 1,2 * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='planner_notification_url'),
    headers := jsonb_build_object('Content-Type','application/json','X-Planner-Cron-Secret',
      (select decrypted_secret from vault.decrypted_secrets where name='planner_notification_cron_secret')),
    body := '{"action":"send-nightly"}'::jsonb,
    timeout_milliseconds := 20000
  );
$job$);
commit;
