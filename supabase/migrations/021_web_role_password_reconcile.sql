-- Reconcile the dedicated web login password with the canonical Vault secret.
-- Migration 020 could leave an already-existing role and an already-existing
-- secret out of sync. This migration makes Vault canonical without exposing the
-- plaintext outside Postgres.

do $$
declare
  canonical_password text;
begin
  select decrypted_secret
  into canonical_password
  from vault.decrypted_secrets
  where name = 'automation_web_db_password'
  order by created_at desc
  limit 1;

  if canonical_password is null then
    canonical_password := encode(gen_random_bytes(32), 'hex');

    perform vault.create_secret(
      canonical_password,
      'automation_web_db_password',
      'Least-privilege PostgreSQL password for the Automation Platform web service.'
    );
  end if;

  if not exists (select 1 from pg_roles where rolname = 'automation_web') then
    execute format(
      'create role automation_web with login password %L nosuperuser nocreatedb nocreaterole noinherit noreplication',
      canonical_password
    );
  else
    execute format('alter role automation_web with login password %L', canonical_password);
  end if;
end
$$;

comment on role automation_web is
  'Least-privilege login used by the public web service; password is canonicalized from Supabase Vault.';
