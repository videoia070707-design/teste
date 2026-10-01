-- Prevent an OAuth state from being consumed after the initiating actor loses
-- permission to manage connections in the workspace. This guard applies to
-- every callback adapter (Next.js, Supabase Edge, or future portable hosts).

create or replace function app_private.guard_oauth_state_consumption()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
begin
  if old.consumed_at is null and new.consumed_at is not null then
    if not exists (
      select 1
      from app_private.workspace_members member
      where member.workspace_id = old.workspace_id
        and member.user_id = old.initiated_by_user_id
        and member.role in ('owner', 'admin')
    ) then
      return null;
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists oauth_sessions_consume_membership_guard
  on app_private.oauth_sessions;

create trigger oauth_sessions_consume_membership_guard
before update of consumed_at on app_private.oauth_sessions
for each row
execute function app_private.guard_oauth_state_consumption();

revoke all on function app_private.guard_oauth_state_consumption() from public;

comment on function app_private.guard_oauth_state_consumption() is
  'Suppresses OAuth state consumption when the initiating actor no longer has owner/admin connection-management authority.';
