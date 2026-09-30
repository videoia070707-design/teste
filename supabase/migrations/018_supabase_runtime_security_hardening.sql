-- Security hardening after enabling the Supabase Free runtime.
-- pg_net is non-relocatable; Supabase recommends dropping and recreating it in
-- extensions when Security Advisor reports installation in public.

select cron.unschedule('g3-runtime-recovery')
where exists (
  select 1 from cron.job where jobname = 'g3-runtime-recovery'
);

-- No production traffic is enabled yet. Operational procedure verifies
-- net.http_request_queue is empty immediately before this migration.
drop extension if exists pg_net;
create extension pg_net with schema extensions;

alter function app_private.normalize_worker_heartbeat_kind()
  set search_path = pg_catalog, app_private;

select cron.schedule(
  'g3-runtime-recovery',
  '15 seconds',
  $$select app_private.invoke_g3_edge_runtime('cron-recovery');$$
);
