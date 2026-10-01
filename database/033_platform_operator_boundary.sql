-- Global provider/legal configuration belongs to the platform operator, not to
-- arbitrary workspace owners. This table is intentionally outside tenant RBAC.

create table if not exists app_private.platform_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin'
    check (role in ('owner', 'admin')),
  granted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on app_private.platform_operators from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on app_private.platform_operators from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on app_private.platform_operators from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on app_private.platform_operators from service_role;
  end if;
end
$$;

create or replace function app_private.is_platform_operator(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, app_private
as $$
  select exists (
    select 1
    from app_private.platform_operators operator
    where operator.user_id = p_user_id
  );
$$;

create or replace function app_private.require_platform_operator(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, app_private
as $$
begin
  if p_user_id is null or not app_private.is_platform_operator(p_user_id) then
    raise exception 'PLATFORM_OPERATOR_REQUIRED'
      using errcode = '42501';
  end if;
end
$$;

-- Actor-aware wrappers. The legacy signatures remain available to postgres for
-- migrations/maintenance but are revoked from the public web database role.
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

revoke all on function app_private.is_platform_operator(uuid) from public;
revoke all on function app_private.require_platform_operator(uuid) from public;
revoke all on function app_private.set_platform_public_config(uuid, text, text) from public;
revoke all on function app_private.set_instagram_platform_config(uuid, text, text, text, text, text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'automation_web') then
    -- Read-only operator lookup; the web role cannot grant itself platform access.
    grant select on app_private.platform_operators to automation_web;
    grant execute on function app_private.is_platform_operator(uuid) to automation_web;
    grant execute on function app_private.require_platform_operator(uuid) to automation_web;
    grant execute on function app_private.set_platform_public_config(uuid, text, text) to automation_web;
    grant execute on function app_private.set_instagram_platform_config(uuid, text, text, text, text, text, text, text) to automation_web;

    revoke execute on function app_private.set_platform_public_config(text, text) from automation_web;
    revoke execute on function app_private.set_instagram_platform_config(text, text, text, text, text, text) from automation_web;
    revoke execute on function app_private.set_instagram_platform_config(text, text, text, text, text, text, text) from automation_web;
  end if;
end
$$;

comment on table app_private.platform_operators is
  'Global control-plane operators. Tenant workspace roles cannot mutate platform-wide provider configuration.';
comment on function app_private.is_platform_operator(uuid) is
  'Returns whether an authenticated user is explicitly authorized for global platform configuration.';
comment on function app_private.set_platform_public_config(uuid, text, text) is
  'Actor-aware platform-operator bridge for global public/legal configuration.';
comment on function app_private.set_instagram_platform_config(uuid, text, text, text, text, text, text, text) is
  'Actor-aware platform-operator bridge for global Instagram provider configuration and Graph-version confirmation.';
