-- Portable Meta compliance primitives shared by self-hosting and Supabase.
-- 013-020 are reserved for the Supabase adapter; 021 resumes the portable
-- product schema without copying Supabase-only extensions into database/.

alter table app_private.channel_connections
  add column if not exists provider_subject_id text;

create index if not exists channel_connections_provider_subject_idx
  on app_private.channel_connections(provider_key, provider_subject_id)
  where provider_subject_id is not null;

comment on column app_private.channel_connections.provider_subject_id is
  'Provider app-scoped subject used for signed provider callbacks. Keep separate from external_account_id, which is the channel account identity used by provider APIs.';

create table if not exists app_private.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  request_fingerprint text not null,
  provider_subject_hash text not null,
  confirmation_code text not null unique,
  status text not null default 'PENDING'
    check (status in ('PENDING','PROCESSING','COMPLETED','FAILED','MANUAL_REVIEW')),
  matched_connections integer not null default 0 check (matched_connections >= 0),
  deleted_connections integer not null default 0 check (deleted_connections >= 0),
  deleted_ingress_events integer not null default 0 check (deleted_ingress_events >= 0),
  deleted_secret_envelopes integer not null default 0 check (deleted_secret_envelopes >= 0),
  deleted_outbox_events integer not null default 0 check (deleted_outbox_events >= 0),
  provider_issued_at timestamptz,
  requested_at timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  unique (provider_key, request_fingerprint),
  check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  check (provider_subject_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists data_deletion_requests_status_idx
  on app_private.data_deletion_requests(status, requested_at);

comment on table app_private.data_deletion_requests is
  'Minimal receipt for provider-initiated deletion. Raw signed requests and provider subject IDs are never retained; only SHA-256 hashes and a random confirmation code remain.';

create or replace function app_private.delete_provider_subject_data(
  p_provider_key text,
  p_provider_subject_id text
)
returns table (
  matched_connections integer,
  deleted_connections integer,
  deleted_ingress_events integer,
  deleted_secret_envelopes integer,
  deleted_outbox_events integer
)
language plpgsql
set search_path = pg_catalog, app_private
as $$
declare
  v_connection_ids uuid[] := '{}'::uuid[];
  v_message_ids uuid[] := '{}'::uuid[];
  v_external_account_ids text[] := '{}'::text[];
  v_secret_ids uuid[] := '{}'::uuid[];
  v_matched_connections integer := 0;
  v_deleted_connections integer := 0;
  v_deleted_ingress_events integer := 0;
  v_deleted_secret_envelopes integer := 0;
  v_deleted_outbox_events integer := 0;
begin
  if nullif(btrim(p_provider_key), '') is null then
    raise exception 'provider key is required';
  end if;
  if nullif(btrim(p_provider_subject_id), '') is null then
    raise exception 'provider subject id is required';
  end if;

  select
    coalesce(array_agg(c.id), '{}'::uuid[]),
    coalesce(
      array_agg(c.external_account_id) filter (where c.external_account_id is not null),
      '{}'::text[]
    )
  into v_connection_ids, v_external_account_ids
  from app_private.channel_connections c
  where c.provider_key = p_provider_key
    and c.provider_subject_id = p_provider_subject_id;

  v_matched_connections := cardinality(v_connection_ids);

  if v_matched_connections = 0 then
    return query select 0, 0, 0, 0, 0;
    return;
  end if;

  -- Lock the matched connections so OAuth/reconciliation cannot mutate the
  -- same provider identities while their data is being erased.
  perform 1
  from app_private.channel_connections c
  where c.id = any(v_connection_ids)
  for update;

  select coalesce(array_agg(m.id), '{}'::uuid[])
  into v_message_ids
  from app_private.messages m
  where m.connection_id = any(v_connection_ids);

  select coalesce(array_agg(r.secret_ref::uuid), '{}'::uuid[])
  into v_secret_ids
  from app_private.connection_secret_refs r
  where r.connection_id = any(v_connection_ids)
    and r.secret_store = 'postgres-aesgcm-v1'
    and r.secret_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  delete from app_private.outbox_events o
  where o.aggregate_id = any(v_connection_ids)
     or o.aggregate_id = any(v_message_ids);
  get diagnostics v_deleted_outbox_events = row_count;

  if cardinality(v_external_account_ids) > 0 then
    delete from app_private.webhook_ingress_events w
    where w.provider = p_provider_key
      and w.provider_account_ids && v_external_account_ids;
    get diagnostics v_deleted_ingress_events = row_count;
  end if;

  -- Remove connection/message-specific audit payloads. The deletion receipt
  -- itself remains separately in data_deletion_requests with only hashes.
  delete from app_private.audit_logs a
  where a.resource_id in (
    select resource_id::text
    from unnest(v_connection_ids || v_message_ids) as resource(resource_id)
  );

  delete from app_private.secret_envelopes s
  where s.id = any(v_secret_ids);
  get diagnostics v_deleted_secret_envelopes = row_count;

  -- Capades remove capabilities, secret refs, webhook evidence, raw/canonical
  -- events and messages through the existing foreign keys.
  delete from app_private.channel_connections c
  where c.id = any(v_connection_ids);
  get diagnostics v_deleted_connections = row_count;

  return query
  select
    v_matched_connections,
    v_deleted_connections,
    v_deleted_ingress_events,
    v_deleted_secret_envelopes,
    v_deleted_outbox_events;
end
$$;

revoke all on function app_private.delete_provider_subject_data(text, text) from public;

comment on function app_private.delete_provider_subject_data(text, text) is
  'Erases data for an exact provider app-scoped subject without deleting the SaaS workspace or unrelated channels. Intended for verified provider deletion callbacks only.';
