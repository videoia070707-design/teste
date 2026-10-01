-- A pinned Graph API version is not evidence that the operator validated it
-- against the current Meta App. Keep the stored value for deterministic runtime
-- behavior, but require an explicit confirmation before readiness can trust it.

alter table app_private.provider_runtime_config
  add column if not exists graph_api_version_confirmed_at timestamptz;

create or replace function app_private.set_instagram_platform_config(
  p_app_id text,
  p_graph_api_version text,
  p_oauth_authorize_url text,
  p_oauth_token_url text,
  p_oauth_token_encoding text,
  p_long_lived_token_url text,
  p_identity_probe_path text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare
  app_id_value text := nullif(btrim(p_app_id), '');
  graph_version_value text := nullif(btrim(p_graph_api_version), '');
  authorize_url_value text := nullif(btrim(p_oauth_authorize_url), '');
  token_url_value text := nullif(btrim(p_oauth_token_url), '');
  token_encoding_value text := nullif(btrim(p_oauth_token_encoding), '');
  long_lived_url_value text := nullif(btrim(p_long_lived_token_url), '');
  probe_path_value text := nullif(btrim(p_identity_probe_path), '');
begin
  if app_id_value is not null and app_id_value !~ '^[0-9]{4,40}$' then
    raise exception 'META_APP_ID_INVALID';
  end if;

  if graph_version_value is not null and graph_version_value !~ '^v[0-9]{1,3}\.[0-9]{1,3}$' then
    raise exception 'GRAPH_API_VERSION_INVALID';
  end if;

  if authorize_url_value is not null and authorize_url_value !~ '^https://[^[:space:]]+$' then
    raise exception 'OAUTH_AUTHORIZE_URL_INVALID';
  end if;

  if token_url_value is not null and token_url_value !~ '^https://[^[:space:]]+$' then
    raise exception 'OAUTH_TOKEN_URL_INVALID';
  end if;

  if long_lived_url_value is not null and long_lived_url_value !~ '^https://[^[:space:]]+$' then
    raise exception 'LONG_LIVED_TOKEN_URL_INVALID';
  end if;

  if token_encoding_value is not null and token_encoding_value not in ('multipart', 'urlencoded') then
    raise exception 'OAUTH_TOKEN_ENCODING_INVALID';
  end if;

  if probe_path_value is not null and (
    left(probe_path_value, 1) <> '/'
    or left(probe_path_value, 2) = '//'
    or position('\\' in probe_path_value) > 0
    or char_length(probe_path_value) > 500
  ) then
    raise exception 'IDENTITY_PROBE_PATH_INVALID';
  end if;

  update app_private.provider_runtime_config
  set
    app_id = coalesce(app_id_value, app_id),
    graph_api_version = coalesce(graph_version_value, graph_api_version),
    graph_api_version_confirmed_at = case
      when graph_version_value is null then graph_api_version_confirmed_at
      else now()
    end,
    oauth_authorize_url = coalesce(authorize_url_value, oauth_authorize_url),
    oauth_token_url = coalesce(token_url_value, oauth_token_url),
    oauth_token_encoding = coalesce(token_encoding_value, oauth_token_encoding),
    long_lived_token_url = coalesce(long_lived_url_value, long_lived_token_url),
    identity_probe_path = coalesce(probe_path_value, identity_probe_path),
    updated_at = case
      when app_id_value is null
       and graph_version_value is null
       and authorize_url_value is null
       and token_url_value is null
       and token_encoding_value is null
       and long_lived_url_value is null
       and probe_path_value is null
      then updated_at
      else now()
    end
  where provider_key = 'instagram.meta.official';

  if not found then
    raise exception 'INSTAGRAM_PROVIDER_CONFIG_NOT_FOUND';
  end if;
end
$$;

-- Backwards-compatible PATCH wrapper for callers that do not yet expose Graph
-- version confirmation. It deliberately cannot mark a seeded version confirmed.
create or replace function app_private.set_instagram_platform_config(
  p_app_id text,
  p_oauth_authorize_url text,
  p_oauth_token_url text,
  p_oauth_token_encoding text,
  p_long_lived_token_url text,
  p_identity_probe_path text
)
returns void
language sql
security definer
set search_path = pg_catalog, app_private
as $$
  select app_private.set_instagram_platform_config(
    p_app_id,
    null,
    p_oauth_authorize_url,
    p_oauth_token_url,
    p_oauth_token_encoding,
    p_long_lived_token_url,
    p_identity_probe_path
  );
$$;

revoke all on function app_private.set_instagram_platform_config(text, text, text, text, text, text, text) from public;
revoke all on function app_private.set_instagram_platform_config(text, text, text, text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'automation_web') then
    grant execute on function app_private.set_instagram_platform_config(text, text, text, text, text, text, text) to automation_web;
    grant execute on function app_private.set_instagram_platform_config(text, text, text, text, text, text) to automation_web;
  end if;
end
$$;

comment on column app_private.provider_runtime_config.graph_api_version_confirmed_at is
  'Operator confirmation timestamp for the pinned Graph API version. Seeded values remain unconfirmed until explicitly saved.';
comment on function app_private.set_instagram_platform_config(text, text, text, text, text, text, text) is
  'Allowlisted operator PATCH bridge including explicit Graph API version confirmation.';
