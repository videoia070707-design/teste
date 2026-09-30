-- Hosted platform-level Instagram configuration. Values in this row are
-- operator configuration, not tenant/workspace settings. Secrets remain in Vault.

alter table app_private.provider_runtime_config
  add column if not exists app_id text,
  add column if not exists oauth_authorize_url text,
  add column if not exists oauth_token_url text,
  add column if not exists oauth_token_encoding text,
  add column if not exists long_lived_token_url text,
  add column if not exists identity_probe_path text;

alter table app_private.provider_runtime_config
  drop constraint if exists provider_runtime_config_oauth_token_encoding_check;

alter table app_private.provider_runtime_config
  add constraint provider_runtime_config_oauth_token_encoding_check
  check (
    oauth_token_encoding is null
    or oauth_token_encoding in ('multipart', 'urlencoded')
  );

-- Keep configuration deliberately incomplete until values are validated against
-- the real Meta App. Never seed Basic Display OAuth endpoints by assumption.
update app_private.provider_runtime_config
set
  oauth_token_encoding = coalesce(oauth_token_encoding, 'multipart'),
  updated_at = now()
where provider_key = 'instagram.meta.official';

comment on column app_private.provider_runtime_config.app_id is
  'Non-secret Meta App ID used by the hosted Instagram OAuth flow.';
comment on column app_private.provider_runtime_config.oauth_authorize_url is
  'Validated Instagram Login authorization endpoint. Null until confirmed for the real Meta App.';
comment on column app_private.provider_runtime_config.oauth_token_url is
  'Validated authorization-code token endpoint. Null until confirmed for the real Meta App.';
comment on column app_private.provider_runtime_config.long_lived_token_url is
  'Validated long-lived token exchange endpoint. Null until confirmed for the real Meta App.';
comment on column app_private.provider_runtime_config.identity_probe_path is
  'Explicit provider identity/health probe path. Null prevents false HEALTHY state.';
