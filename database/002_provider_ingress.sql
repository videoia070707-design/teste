-- G3 ingress foundation.
-- Webhook ingress is persisted before provider ACK so events are never
-- acknowledged and silently discarded when downstream processing is down.

create table if not exists app_private.webhook_ingress_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  signature_valid boolean not null,
  body_sha256 text not null,
  raw_body bytea not null,
  headers jsonb not null default '{}'::jsonb,
  parsed_payload jsonb,
  provider_account_ids text[] not null default '{}',
  processing_state text not null default 'RECEIVED'
    check (processing_state in ('RECEIVED','RESOLVED','UNMATCHED','FAILED','DEAD')),
  receive_count integer not null default 1,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  last_error text,
  unique (provider, body_sha256)
);

create index if not exists webhook_ingress_ready_idx
  on app_private.webhook_ingress_events(first_received_at)
  where processing_state = 'RECEIVED';

create table if not exists app_private.oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  provider text not null,
  state_hash text not null unique,
  redirect_after text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists oauth_sessions_active_idx
  on app_private.oauth_sessions(provider, expires_at)
  where consumed_at is null;

-- Secrets themselves do not live here. The table points to a secret vault
-- implementation (KMS/envelope-encrypted store/etc.), keeping provider tokens
-- out of ordinary relational rows and audit payloads.
create table if not exists app_private.connection_secret_refs (
  connection_id uuid primary key references app_private.channel_connections(id) on delete cascade,
  secret_store text not null,
  secret_ref text not null,
  key_version text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  unique (secret_store, secret_ref)
);

create table if not exists app_private.connection_webhook_evidence (
  connection_id uuid primary key references app_private.channel_connections(id) on delete cascade,
  last_verified_event_at timestamptz,
  last_invalid_signature_at timestamptz,
  consecutive_valid_events integer not null default 0,
  consecutive_invalid_events integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table app_private.webhook_ingress_events is
  'Raw provider webhook envelope persisted before acknowledgement. Apply a short retention policy because payloads may contain personal data.';
