-- Generalize the heartbeat registry so short-lived Supabase Edge/Cron
-- executions and the legacy long-lived Docker workers can coexist.

alter table app_private.worker_heartbeats
  add column if not exists worker_kind text;

update app_private.worker_heartbeats
set worker_kind = service
where worker_kind is null;

alter table app_private.worker_heartbeats
  drop constraint if exists worker_heartbeats_pkey;

alter table app_private.worker_heartbeats
  alter column service drop not null;

create or replace function app_private.normalize_worker_heartbeat_kind()
returns trigger
language plpgsql
as $$
begin
  new.worker_kind := coalesce(new.worker_kind, new.service);
  if new.worker_kind is null or btrim(new.worker_kind) = '' then
    raise exception 'worker_kind is required';
  end if;
  return new;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'worker_heartbeat_normalize_kind'
      and tgrelid = 'app_private.worker_heartbeats'::regclass
  ) then
    execute 'create trigger worker_heartbeat_normalize_kind
      before insert or update on app_private.worker_heartbeats
      for each row execute function app_private.normalize_worker_heartbeat_kind()';
  end if;
end
$$;

alter table app_private.worker_heartbeats
  alter column worker_kind set not null;

create unique index if not exists worker_heartbeats_kind_worker_uq
  on app_private.worker_heartbeats(worker_kind, worker_id);

create unique index if not exists worker_heartbeats_service_worker_uq
  on app_private.worker_heartbeats(service, worker_id)
  where service is not null;

create index if not exists worker_heartbeats_kind_recent_idx
  on app_private.worker_heartbeats(worker_kind, last_seen_at desc);

comment on column app_private.worker_heartbeats.worker_kind is
  'Generic runtime identity. Legacy Docker workers mirror service; Supabase Edge uses supabase_g3_runtime.';