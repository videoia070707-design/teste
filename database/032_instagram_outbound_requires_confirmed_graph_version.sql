-- Prevent provider side effects from being queued until the operator has
-- explicitly confirmed the pinned Graph API version. This invariant lives in
-- PostgreSQL so it applies to Edge, Docker fallback, and future API surfaces.

create or replace function app_private.guard_instagram_outbound_graph_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare
  official_instagram boolean := false;
  version_confirmed_at timestamptz;
begin
  if new.direction <> 'outbound' then
    return new;
  end if;

  select (
    connection.channel = 'instagram'
    and connection.provider_key = 'instagram.meta.official'
    and connection.provider_mode = 'official'
  )
  into official_instagram
  from app_private.channel_connections connection
  where connection.id = new.connection_id;

  if not coalesce(official_instagram, false) then
    return new;
  end if;

  select config.graph_api_version_confirmed_at
  into version_confirmed_at
  from app_private.provider_runtime_config config
  where config.provider_key = 'instagram.meta.official'
  limit 1;

  if version_confirmed_at is null then
    raise exception 'INSTAGRAM_GRAPH_API_VERSION_UNCONFIRMED'
      using errcode = '23514';
  end if;

  return new;
end
$$;

revoke all on function app_private.guard_instagram_outbound_graph_version() from public;

drop trigger if exists messages_require_confirmed_instagram_graph_version
  on app_private.messages;

create trigger messages_require_confirmed_instagram_graph_version
before insert on app_private.messages
for each row
execute function app_private.guard_instagram_outbound_graph_version();

comment on function app_private.guard_instagram_outbound_graph_version() is
  'Blocks new Instagram Official outbound messages until Graph API version confirmation is recorded.';
