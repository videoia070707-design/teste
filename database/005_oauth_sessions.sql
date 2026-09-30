-- Hardening for the OAuth session table introduced in 002_provider_ingress.sql.
-- Raw OAuth state is never stored; only a SHA-256 hash is persisted.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'oauth_sessions_state_hash_length'
      and conrelid = 'app_private.oauth_sessions'::regclass
  ) then
    alter table app_private.oauth_sessions
      add constraint oauth_sessions_state_hash_length
      check (length(state_hash) = 64);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'oauth_sessions_redirect_is_relative'
      and conrelid = 'app_private.oauth_sessions'::regclass
  ) then
    alter table app_private.oauth_sessions
      add constraint oauth_sessions_redirect_is_relative
      check (
        redirect_after is null
        or (
          redirect_after like '/%'
          and redirect_after not like '//%'
          and position(E'\\' in redirect_after) = 0
        )
      );
  end if;
end
$$;

create index if not exists oauth_sessions_workspace_idx
  on app_private.oauth_sessions(workspace_id, created_at desc);

comment on table app_private.oauth_sessions is
  'Short-lived, single-use provider OAuth state. Raw OAuth state values are never persisted.';
