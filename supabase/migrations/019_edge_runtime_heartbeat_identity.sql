-- Supabase Edge executions are short-lived and receive a unique execution ID.
-- Normalize them to one logical runtime identity so the heartbeat registry does
-- not grow by one row every Cron invocation.

create or replace function app_private.normalize_worker_heartbeat_kind()
returns trigger
language plpgsql
set search_path = pg_catalog, app_private
as $$
begin
  new.worker_kind := coalesce(new.worker_kind, new.service);
  if new.worker_kind is null or btrim(new.worker_kind) = '' then
    raise exception 'worker_kind is required';
  end if;

  if new.worker_kind = 'supabase_g3_runtime' then
    new.worker_id := 'edge:g3-runtime';
    new.service := null;
  end if;

  return new;
end
$$;

-- Collapse any heartbeat rows produced before the stable identity rule.
delete from app_private.worker_heartbeats
where worker_kind = 'supabase_g3_runtime';

comment on function app_private.normalize_worker_heartbeat_kind() is
  'Normalizes legacy Docker worker identity and collapses short-lived Edge executions into one logical G3 runtime heartbeat.';
