-- Portable contract for non-secret provider runtime configuration.
-- Supabase introduced this table in adapter migrations 015/023; the portable
-- fallback needs the same final shape so Setup Center/runtime code does not
-- depend on the hosting provider.

create table if not exists app_private.provider_runtime_config (
  provider_key text primary key,
  graph_base_url text not null,
  graph_api_version text not null,
  updated_at timestamptz not null default now(),
  app_id text,
  oauth_authorize_url text,
  oauth_token_url text,
  oauth_token_encoding text,
  long_lived_token_url text,
  identity_probe_path text
);

alter table app_private.provider_runtime_config
  add column if not exists app_id text,
  add column if not exists oauth_authorize_url text,
  add column if not exists oauth_token_url text,
  add column if not exists oauth_token_encoding text,
  add column if not exists long_lived_token_url text,
  add column if not exists identity_probe_path text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'provider_runtime_config_oauth_token_encoding_check'
      and conrelid = 'app_private.provider_runtime_config'::regclass
  ) then
    alter table app_private.provider_runtime_config
      add constraint provider_runtime_config_oauth_token_encoding_check
      check (
        oauth_token_encoding is null
        or oauth_token_encoding in ('multipart', 'urlencoded')
      );
  end if;
end
$$;

insert into app_private.provider_runtime_config (
  provider_key,
  graph_base_url,
  graph_api_version,
  oauth_token_encoding
) values (
  'instagram.meta.official',
  'https://graph.instagram.com/',
  'v26.0',
  'multipart'
)
on conflict (provider_key) do nothing;

comment on table app_private.provider_runtime_config is
  'Server-only non-secret provider configuration shared by portable and hosted runtimes.';
comment on column app_private.provider_runtime_config.app_id is
  'Non-secret Meta App ID. Null until configured against the real Meta App.';
comment on column app_private.provider_runtime_config.oauth_authorize_url is
  'Validated Instagram Login authorization endpoint. Null until confirmed.';
comment on column app_private.provider_runtime_config.oauth_token_url is
  'Validated authorization-code token endpoint. Null until confirmed.';
comment on column app_private.provider_runtime_config.long_lived_token_url is
  'Validated long-lived token exchange endpoint. Null until confirmed.';
comment on column app_private.provider_runtime_config.identity_probe_path is
  'Explicit identity/health probe path. Null prevents false HEALTHY state.';
