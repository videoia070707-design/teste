-- G0-G2 core schema. Designed for PostgreSQL/Supabase.
-- Application tables live outside `public` so they are not accidentally exposed by the Data API.

create schema if not exists app_private;

revoke all on schema app_private from anon, authenticated;

create table if not exists app_private.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists app_private.workspace_members (
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','automation_manager','supervisor','agent','analyst','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists app_private.channel_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  channel text not null check (channel in ('instagram','whatsapp')),
  provider_key text not null,
  provider_mode text not null check (provider_mode in ('official','experimental','browser_lab')),
  external_account_id text,
  display_name text,
  health_state text not null default 'DISCONNECTED' check (health_state in ('HEALTHY','DEGRADED_PARTIAL','STALE','AUTH_EXPIRED','DISCONNECTED')),
  auth_valid boolean not null default false,
  webhook_healthy boolean not null default false,
  last_event_at timestamptz,
  last_successful_action_at timestamptz,
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists channel_connections_workspace_idx
  on app_private.channel_connections(workspace_id);

create table if not exists app_private.connection_capabilities (
  connection_id uuid not null references app_private.channel_connections(id) on delete cascade,
  capability_key text not null,
  state text not null check (state in ('available','beta','unavailable','degraded')),
  reason text,
  checked_at timestamptz not null default now(),
  primary key (connection_id, capability_key)
);

create table if not exists app_private.raw_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  connection_id uuid not null references app_private.channel_connections(id) on delete cascade,
  provider text not null,
  provider_event_id text not null,
  signature_valid boolean not null default false,
  fingerprint text,
  headers jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processing_state text not null default 'RECEIVED' check (processing_state in ('RECEIVED','VALIDATED','PROCESSED','DUPLICATE','SUSPICIOUS_COLLISION','FAILED','DEAD')),
  unique (connection_id, provider_event_id)
);

create table if not exists app_private.canonical_events (
  id uuid primary key default gen_random_uuid(),
  raw_event_id uuid references app_private.raw_events(id) on delete set null,
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  connection_id uuid not null references app_private.channel_connections(id) on delete cascade,
  event_type text not null,
  channel text not null check (channel in ('instagram','whatsapp')),
  provider text not null,
  provider_event_id text not null,
  correlation_id uuid not null,
  causation_id uuid,
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists canonical_events_correlation_idx
  on app_private.canonical_events(correlation_id, created_at);

create table if not exists app_private.outbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  topic text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  dead_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists outbox_ready_idx
  on app_private.outbox_events(available_at)
  where processed_at is null and dead_at is null;

create table if not exists app_private.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  connection_id uuid not null references app_private.channel_connections(id) on delete cascade,
  provider_message_id text,
  idempotency_key text not null,
  correlation_id uuid not null,
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'text',
  delivery_state text not null check (delivery_state in ('CREATED','QUEUED','PROCESSING','SENT','DELIVERED','READ','FAILED','RETRYING','DEAD','SEND_RESULT_UNKNOWN')),
  reconciliation_required boolean not null default false,
  last_provider_timestamp timestamptz,
  last_error_code text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, idempotency_key)
);

create index if not exists messages_unknown_idx
  on app_private.messages(connection_id, updated_at)
  where delivery_state = 'SEND_RESULT_UNKNOWN';

create table if not exists app_private.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  correlation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on schema app_private is 'Server-only product data. Do not expose directly through Supabase Data API.';
