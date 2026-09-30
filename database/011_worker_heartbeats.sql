-- Runtime heartbeat registry for long-lived workers.
-- Server-only operational state; never exposed through Supabase Data API.

create table if not exists app_private.worker_heartbeats (
  service text not null check (service in ('worker-ingress','worker-outbound')),
  worker_id text not null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  stopped_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  primary key (service, worker_id)
);

create index if not exists worker_heartbeats_recent_idx
  on app_private.worker_heartbeats(service, last_seen_at desc);

revoke all on app_private.worker_heartbeats from anon, authenticated;

comment on table app_private.worker_heartbeats is
  'Ephemeral operational evidence that durable workers are alive. Rows are not HOST PASS evidence.';
