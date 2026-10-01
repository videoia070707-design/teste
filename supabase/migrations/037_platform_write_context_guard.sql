-- Prevent privileged server-side callers from bypassing the platform-operator
-- boundary by invoking legacy global write bridges directly. Actor-aware wrappers
-- validate the operator, set a transaction-local context, then enter the legacy
-- implementation. Calls without that context fail closed.

create or replace function app_private.require_platform_write_context()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, app_private
as $$
declare
  actor_text text := nullif(current_setting('automation.platform_actor_user_id', true), '');
  actor_id uuid;
begin
  if actor_text is null then
    raise exception 'PLATFORM_OPERATOR_CONTEXT_REQUIRED'
      using errcode = '42501';
  end if;

  begin
    actor_id := actor_text::uuid;
  exception when invalid_text_representation then
    raise exception 'PLATFORM_OPERATOR_CONTEXT_INVALID'
      using errcode = '42501';
  end;

  perform app_private.require_platform_operator(actor_id);
  return actor_id;
end
$$;

revoke all on function app_private.require_platform_write_context() from public;

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
  perform app_private.require_platform_write_context();

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
  perform app_private.require_platform_write_context();

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

create or replace function app_private.set_meta_app_secret(
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app_private, vault
as $$
declare
  normalized_secret text := nullif(btrim(p_secret), '');
  existing_secret_id uuid;
begin
  perform app_private.require_platform_write_context();

  if normalized_secret is null then
    raise exception 'META_APP_SECRET_REQUIRED';
  end if;

  if char_length(normalized_secret) < 16 or char_length(normalized_secret) > 512 then
    raise exception 'META_APP_SECRET_INVALID_LENGTH';
  end if;

  select id
  into existing_secret_id
  from vault.secrets
  where name = 'meta_app_secret'
  limit 1;

  if existing_secret_id is null then
    perform vault.create_secret(
      normalized_secret,
      'meta_app_secret',
      'Meta App Secret for Instagram Login OAuth and webhook HMAC verification.'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      normalized_secret,
      'meta_app_secret',
      'Meta App Secret for Instagram Login OAuth and webhook HMAC verification.'
    );
  end if;
end
$$;

-- Actor-aware wrappers establish the only supported write context.
create or replace function app_private.set_platform_public_config(
  p_actor_user_id uuid,
  p_key text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_platform_operator(p_actor_user_id);
  perform set_config('automation.platform_actor_user_id', p_actor_user_id::text, true);
  perform app_private.set_platform_public_config(p_key, p_value);
end
$$;

create or replace function app_private.set_instagram_platform_config(
  p_actor_user_id uuid,
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
begin
  perform app_private.require_platform_operator(p_actor_user_id);
  perform set_config('automation.platform_actor_user_id', p_actor_user_id::text, true);
  perform app_private.set_instagram_platform_config(
    p_app_id,
    p_graph_api_version,
    p_oauth_authorize_url,
    p_oauth_token_url,
    p_oauth_token_encoding,
    p_long_lived_token_url,
    p_identity_probe_path
  );
end
$$;

create or replace function app_private.set_meta_app_secret(
  p_actor_user_id uuid,
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_platform_operator(p_actor_user_id);
  perform set_config('automation.platform_actor_user_id', p_actor_user_id::text, true);
  perform app_private.set_meta_app_secret(p_secret);
end
$$;

revoke all on function app_private.require_platform_write_context() from public;
revoke all on function app_private.set_platform_public_config(text, text) from public;
revoke all on function app_private.set_instagram_platform_config(text, text, text, text, text, text, text) from public;
revoke all on function app_private.set_instagram_platform_config(text, text, text, text, text, text) from public;
revoke all on function app_private.set_meta_app_secret(text) from public;
revoke all on function app_private.set_platform_public_config(uuid, text, text) from public;
revoke all on function app_private.set_instagram_platform_config(uuid, text, text, text, text, text, text, text) from public;
revoke all on function app_private.set_meta_app_secret(uuid, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'automation_web') then
    grant execute on function app_private.set_platform_public_config(uuid, text, text) to automation_web;
    grant execute on function app_private.set_instagram_platform_config(uuid, text, text, text, text, text, text, text) to automation_web;
    grant execute on function app_private.set_meta_app_secret(uuid, text) to automation_web;

    revoke execute on function app_private.set_platform_public_config(text, text) from automation_web;
    revoke execute on function app_private.set_instagram_platform_config(text, text, text, text, text, text, text) from automation_web;
    revoke execute on function app_private.set_instagram_platform_config(text, text, text, text, text, text) from automation_web;
    revoke execute on function app_private.set_meta_app_secret(text) from automation_web;
  end if;
end
$$;

comment on function app_private.require_platform_write_context() is
  'Fail-closed guard for legacy global write bridges. Only actor-aware wrappers may establish the transaction-local platform operator context.';
