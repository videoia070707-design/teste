-- Cover the granted_by_user_id foreign key reported by the Supabase performance advisor.
create index if not exists platform_operators_granted_by_user_id_idx
  on app_private.platform_operators(granted_by_user_id)
  where granted_by_user_id is not null;
