-- Setup Center uses PATCH semantics: omitted/blank values preserve the current
-- configuration. Destructive clearing must be an explicit future operation,
-- never an accidental consequence of submitting a partial form.

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
    config_value = coalesce(excluded.config_value, app_private.platform_public_config.config_value),
    updated_at = case
      when excluded.config_value is null then app_private.platform_public_config.updated_at
      else excluded.updated_at
    end;
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
  token_encoding_value text := nullif(btrim(p_oauth_token_encoding), '');
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
    oauth_authorize_url = coalesce(authorize_url_value, oauth_authorize_url),
    oauth_token_url = coalesce(token_url_value, oauth_token_url),
    oauth_token_encoding = coalesce(token_encoding_value, oauth_token_encoding),
    long_lived_token_url = coalesce(long_lived_url_value, long_lived_token_url),
    identity_probe_path = coalesce(probe_path_value, identity_probe_path),
    updated_at = case
      when app_id_value is null
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
  'Allowlisted operator PATCH bridge for public legal/App Review configuration; blank values preserve existing state.';
comment on function app_private.set_instagram_platform_config(text, text, text, text, text, text) is
  'Allowlisted operator PATCH bridge for non-secret Instagram config; blank values preserve existing state.';
