-- Durable outbound execution leases.
-- A crashed PROCESSING lease is deliberately not retried: recovery moves it to
-- SEND_RESULT_UNKNOWN because the provider may already have applied the side effect.

alter table app_private.messages
  add column if not exists attempt_count integer not null default 0,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_until timestamptz,
  add column if not exists locked_by text;

create index if not exists messages_outbound_ready_idx
  on app_private.messages(available_at, created_at)
  where direction = 'outbound'
    and delivery_state in ('QUEUED','RETRYING');

create index if not exists messages_outbound_expired_lease_idx
  on app_private.messages(locked_until)
  where direction = 'outbound'
    and delivery_state = 'PROCESSING';

comment on column app_private.messages.locked_until is
  'Finite outbound worker lease. Expired PROCESSING rows must reconcile before any retry.';
