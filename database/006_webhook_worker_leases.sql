-- Recoverable webhook processing leases.
-- Workers claim rows with SKIP LOCKED and a finite lease so a crashed process
-- cannot permanently strand an event in PROCESSING.

alter table app_private.webhook_ingress_events
  add column if not exists attempt_count integer not null default 0,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_until timestamptz,
  add column if not exists locked_by text,
  add column if not exists processed_at timestamptz;

alter table app_private.webhook_ingress_events
  drop constraint if exists webhook_ingress_events_processing_state_check;

alter table app_private.webhook_ingress_events
  add constraint webhook_ingress_events_processing_state_check
  check (processing_state in ('RECEIVED','PROCESSING','RESOLVED','UNMATCHED','FAILED','DEAD'));

drop index if exists app_private.webhook_ingress_ready_idx;

create index if not exists webhook_ingress_ready_idx
  on app_private.webhook_ingress_events(available_at, first_received_at)
  where processing_state in ('RECEIVED','UNMATCHED','FAILED');

create index if not exists webhook_ingress_expired_lease_idx
  on app_private.webhook_ingress_events(locked_until)
  where processing_state = 'PROCESSING';

comment on column app_private.webhook_ingress_events.locked_until is
  'Finite worker lease. Expired PROCESSING rows may be reclaimed after a worker crash.';
