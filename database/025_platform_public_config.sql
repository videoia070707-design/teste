-- Public/operator configuration used by legal and App Review surfaces.
-- Values are non-secret but remain server-side so hosted and self-hosted paths
-- share one source of truth without duplicating deployment environment variables.

create table if not exists app_private.platform_public_config (
  config_key text primary key,
  config_value text,
  updated_at timestamptz not null default now(),
  check (config_key = btrim(config_key) and config_key <> '')
);

insert into app_private.platform_public_config (config_key, config_value)
values
  ('legal_entity_name', null),
  ('support_email', null)
on conflict (config_key) do nothing;

revoke all on app_private.platform_public_config from anon, authenticated;

grant select on app_private.platform_public_config to automation_web;

comment on table app_private.platform_public_config is
  'Non-secret operator configuration for public legal/App Review surfaces. Null values keep those surfaces fail-closed.';
