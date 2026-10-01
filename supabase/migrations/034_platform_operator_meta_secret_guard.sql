-- Vault writes are global control-plane operations. Require an explicitly
-- registered platform operator in addition to the least-privilege web role.

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
  perform app_private.set_meta_app_secret(p_secret);
end
$$;

revoke all on function app_private.set_meta_app_secret(uuid, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'automation_web') then
    grant execute on function app_private.set_meta_app_secret(uuid, text) to automation_web;
    revoke execute on function app_private.set_meta_app_secret(text) from automation_web;
  end if;
end
$$;

comment on function app_private.set_meta_app_secret(uuid, text) is
  'Actor-aware write-only bridge for Meta App Secret. Requires explicit platform-operator authorization before Vault mutation.';
