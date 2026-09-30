-- Cover foreign keys reported by the Supabase performance advisor.
-- These indexes reduce parent-row update/delete checks and common workspace joins
-- without changing application semantics.

create index if not exists audit_logs_actor_user_id_idx
  on app_private.audit_logs(actor_user_id);

create index if not exists audit_logs_workspace_id_idx
  on app_private.audit_logs(workspace_id);

create index if not exists canonical_events_connection_id_idx
  on app_private.canonical_events(connection_id);

create index if not exists canonical_events_raw_event_id_idx
  on app_private.canonical_events(raw_event_id);

create index if not exists canonical_events_workspace_id_idx
  on app_private.canonical_events(workspace_id);

create index if not exists messages_workspace_id_idx
  on app_private.messages(workspace_id);

create index if not exists outbox_events_workspace_id_idx
  on app_private.outbox_events(workspace_id);

create index if not exists provider_readiness_confirmed_by_user_idx
  on app_private.provider_readiness_attestations(confirmed_by_user_id);

create index if not exists raw_events_workspace_id_idx
  on app_private.raw_events(workspace_id);

create index if not exists workspace_members_user_id_idx
  on app_private.workspace_members(user_id);
