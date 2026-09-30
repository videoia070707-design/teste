-- Align persisted connection health with the domain model.
-- NULL means webhook health is not yet known/proven.

alter table app_private.channel_connections
  alter column webhook_healthy drop not null,
  alter column webhook_healthy drop default;

create unique index if not exists channel_connection_external_identity_uq
  on app_private.channel_connections(workspace_id, provider_key, external_account_id)
  where external_account_id is not null;

comment on column app_private.channel_connections.webhook_healthy is
  'TRUE = verified healthy, FALSE = verified unhealthy, NULL = not yet proven/unknown.';
