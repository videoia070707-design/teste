-- Controlled write bridge for operator-facing setup screens.
-- The web role keeps no direct UPDATE privilege on configuration tables.

create or replace function app_private.set_platform_public_config(
  p_key text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare
  normalized_value text := nullif(btrim(p_value), '');
begin
  if p_key not in ('legal_entity_name', 'support_email') then
    raise exception 'PLATFORM_CONFIG_KEY_NOT_ALLOWED';
  end if;

  if p_key = 'legal_entity_name' and normalized_value is not null
     and char_length(normalized_value) > 200 then
    raise exception 'LEGAL_ENTITY_NAME_TOO_LONG';
  end if;

  if p_key = 'support_email' and normalized_value is not null then
    if char_length(normalized_value) > 320
       or normalized_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'SUPPORT_EMAIL_INVALID';
    end if;
  end if;

  insert into app_private.platform_public_config (config_key, config_value, updated_at)
  values (p_key, normalized_value, now())
  on conflict (config_key)
  do update set
    config_value = excluded.config_value,
    updated_at = excluded.updated_at;
end
$$;

create or replace function app_private.set_instagram_platform_config(
  p_app_id text,
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
  authorize_url_value text := nullif(btrim(p_oauth_authorize_url), '');
  token_url_value text := nullif(btrim(p_oauth_token_url), '');
  token_encoding_value text := coalesce(nullif(btrim(p_oauth_token_encoding), ''), 'multipart');
  long_lived_url_value text := nullif(btrim(p_long_lived_token_url), '');
  probe_path_value text := nullif(btrim(p_identity_probe_path), '');
begin
  if app_id_value is not null and app_id_value !~ '^[0-9]{4,40}$' then
    raise exception 'META_APP_ID_INVALID';
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

  if token_encoding_value not in ('multipart', 'urlencoded') then
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
    app_id = app_id_value,
    oauth_authorize_url = authorize_url_value,
    oauth_token_url = token_url_value,
    oauth_token_encoding = token_encoding_value,
    long_lived_token_url = long_lived_url_value,
    identity_probe_path = probe_path_value,
    updated_at = now()
  where provider_key = 'instagram.meta.official';

  if not found then
    raise exception 'INSTAGRAM_PROVIDER_CONFIG_NOT_FOUND';
  end if;
end
$$;

revoke all on function app_private.set_platform_public_config(text, text) from public;
revoke all on function app_private.set_instagram_platform_config(text, text, text, text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'automation_web') then
    grant execute on function app_private.set_platform_public_config(text, text) to automation_web;
    grant execute on function app_private.set_instagram_platform_config(text, text, text, text, text, text) to automation_web;
  end if;
end
$$;

comment on function app_private.set_platform_public_config(text, text) is
  'Allowlisted operator write bridge for public legal/App Review configuration.';
comment on function app_private.set_instagram_platform_config(text, text, text, text, text, text) is
  'Allowlisted operator write bridge for non-secret Instagram platform configuration.';
