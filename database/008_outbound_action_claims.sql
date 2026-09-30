-- Provider side-effect claim key.
-- Some provider actions have stronger constraints than HTTP request idempotency.
-- Example: Instagram private reply permits only one automated private reply per
-- source comment. A resource claim prevents two different workflows/requests
-- from racing with different idempotency keys.

alter table app_private.messages
  add column if not exists dedupe_resource_key text;

create unique index if not exists messages_provider_action_claim_idx
  on app_private.messages(connection_id, message_type, dedupe_resource_key)
  where direction = 'outbound'
    and dedupe_resource_key is not null;

comment on column app_private.messages.dedupe_resource_key is
  'Optional provider-resource claim. Non-null keys enforce one outbound side effect per connection/message type/resource.';
