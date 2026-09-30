-- Single-use OAuth state storage for provider connection flows.
-- Only a SHA-256 hash of the browser-visible state is persisted.

create table if not exists app_private.oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  provider text not null,
  state_hash text not null,
  redirect_after text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint oauth_sessions_state_hash_length check (length(state_hash) = 64),
  constraint oauth_sessions_redirect_is_relative check (
    redirect_after is null
    or (
      redirect_after like '/%'
      and redirect_after not like '//%'
      and position(E'\\' in redirect_after) = 0
    )
  ),
  unique (provider, state_hash)
);

create index if not exists oauth_sessions_active_idx
  on app_private.oauth_sessions(provider, expires_at)
  where consumed_at is null;

create index if not exists oauth_sessions_workspace_idx
  on app_private.oauth_sessions(workspace_id, created_at desc);

comment on table app_private.oauth_sessions is
  'Short-lived, single-use provider OAuth state. Raw OAuth state values are never persisted.';
