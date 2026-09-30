-- Least-privilege database identity for the public web application.
-- The role gets only the product-table permissions used by the current Next.js app.
-- It receives no direct Vault access and no access to internal runtime token hashes.

create or replace function app_private.get_platform_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, vault
as $$
declare
  secret_value text;
begin
  if p_name not in (
    'provider_secret_keyring',
    'meta_app_secret',
    'meta_webhook_verify_token',
    'meta_webhook_signature_header'
  ) then
    raise exception 'platform secret is not allowlisted';
  end if;

  select decrypted_secret
  into secret_value
  from vault.decrypted_secrets
  where name = p_name
  order by created_at desc
  limit 1;

  return secret_value;
end
$$;

revoke all on function app_private.get_platform_secret(text) from public;

-- Generate a dedicated login credential inside Postgres and keep its plaintext
-- only in Supabase Vault. Re-running this migration logic does not rotate a
-- healthy existing credential; if the Vault entry is missing, it fails closed
-- by rotating the database password and recreating the Vault secret together.
do $$
declare
  generated_password text;
begin
  if not exists (select 1 from pg_roles where rolname = 'automation_web') then
    generated_password := encode(gen_random_bytes(32), 'hex');
    execute format(
      'create role automation_web with login password %L nosuperuser nocreatedb nocreaterole noinherit noreplication',
      generated_password
    );

    perform vault.create_secret(
      generated_password,
      'automation_web_db_password',
      'Least-privilege PostgreSQL password for the Automation Platform web service.'
    );
  elsif not exists (select 1 from vault.secrets where name = 'automation_web_db_password') then
    generated_password := encode(gen_random_bytes(32), 'hex');
    execute format('alter role automation_web with password %L', generated_password);

    perform vault.create_secret(
      generated_password,
      'automation_web_db_password',
      'Least-privilege PostgreSQL password for the Automation Platform web service.'
    );
  end if;
end
$$;

alter role automation_web set search_path = pg_catalog, app_private;
alter role automation_web set statement_timeout = '15s';
alter role automation_web set lock_timeout = '5s';
alter role automation_web set idle_in_transaction_session_timeout = '15s';

grant connect on database postgres to automation_web;
grant usage on schema app_private to automation_web;
grant execute on function app_private.get_platform_secret(text) to automation_web;

-- Tenant/bootstrap/auth-adjacent state used by the web application.
grant select, insert, update on app_private.workspaces to automation_web;
grant select, insert, update on app_private.workspace_members to automation_web;
grant select, insert, update on app_private.channel_connections to automation_web;
grant select, insert, update on app_private.connection_capabilities to automation_web;

-- OAuth state and encrypted provider credential lifecycle.
grant select, insert, update, delete on app_private.oauth_sessions to automation_web;
grant select, insert, update, delete on app_private.connection_secret_refs to automation_web;
grant select, insert, update, delete on app_private.secret_envelopes to automation_web;

-- User-triggered outbound actions and evidence/audit views.
grant select, insert, update on app_private.messages to automation_web;
grant select, insert on app_private.audit_logs to automation_web;
grant select, insert, update on app_private.provider_readiness_attestations to automation_web;

-- Fallback Next.js webhook remains available, but the primary Meta callback is
-- the Supabase Edge webhook. Upsert requires INSERT + UPDATE.
grant select, insert, update on app_private.webhook_ingress_events to automation_web;

-- Operational/evidence data is read-only from the web process.
grant select on app_private.raw_events to automation_web;
grant select on app_private.canonical_events to automation_web;
grant select on app_private.outbox_events to automation_web;
grant select on app_private.connection_webhook_evidence to automation_web;
grant select on app_private.worker_heartbeats to automation_web;
grant select on app_private.provider_runtime_config to automation_web;

-- Explicitly protect runtime authentication material even if grants change later.
revoke all on app_private.runtime_invocation_tokens from automation_web;
revoke all on schema vault from automation_web;

comment on function app_private.get_platform_secret(text) is
  'Allowlisted SECURITY DEFINER bridge for web-owned secrets. The web role has no direct Vault privileges.';
