-- Restore an explicit primary key after the Supabase runtime generalized the
-- heartbeat registry from service-specific workers to generic worker_kind.
-- The unique index already enforces the same identity; reusing it avoids a
-- redundant index and keeps existing heartbeat rows untouched.

alter table app_private.worker_heartbeats
  add constraint worker_heartbeats_pkey
  primary key using index worker_heartbeats_kind_worker_uq;
