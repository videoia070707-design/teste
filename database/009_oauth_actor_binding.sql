-- Bind each OAuth state to the authenticated user who initiated it.
-- OAuth sessions are ephemeral. Any pre-migration session without an actor is
-- discarded instead of being allowed to cross the stronger authorization boundary.

alter table app_private.oauth_sessions
  add column if not exists initiated_by_user_id uuid references auth.users(id) on delete cascade;

delete from app_private.oauth_sessions
where initiated_by_user_id is null;

alter table app_private.oauth_sessions
  alter column initiated_by_user_id set not null;

create index if not exists oauth_sessions_actor_active_idx
  on app_private.oauth_sessions(initiated_by_user_id, provider, expires_at)
  where consumed_at is null;

comment on column app_private.oauth_sessions.initiated_by_user_id is
  'Verified Supabase user that created the OAuth state. State consumption must match this actor.';
