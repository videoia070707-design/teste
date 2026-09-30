-- Non-secret provider runtime configuration shared by the web app and the
-- Supabase Free Edge runtime. Keeping it in Postgres avoids host-specific env drift.

create table if not exists app_private.provider_runtime_config (
  provider_key text primary key,
  graph_base_url text not null,
  graph_api_version text not null,
  updated_at timestamptz not null default now()
);

revoke all on app_private.provider_runtime_config from anon, authenticated;

insert into app_private.provider_runtime_config (
  provider_key,
  graph_base_url,
  graph_api_version
) values (
  'instagram.meta.official',
  'https://graph.instagram.com/',
  'v26.0'
)
on conflict (provider_key)
do update set
  graph_base_url = excluded.graph_base_url,
  graph_api_version = excluded.graph_api_version,
  updated_at = now();

comment on table app_private.provider_runtime_config is
  'Server-only non-secret provider configuration. API versions are pinned deliberately and never auto-upgraded.';