-- Allow the least-privilege web control plane to provision only the Meta App
-- Secret into Supabase Vault. The secret is write-only from the Setup Center:
-- it is never returned to the browser and this bridge cannot modify the provider
-- keyring, runtime invocation token, webhook verify token or arbitrary Vault rows.

create or replace function app_private.set_meta_app_secret(
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, vault
as $$
declare
  normalized_secret text := nullif(btrim(p_secret), '');
  existing_secret_id uuid;
begin
  if normalized_secret is null then
    raise exception 'META_APP_SECRET_REQUIRED';
  end if;

  if char_length(normalized_secret) < 16 or char_length(normalized_secret) > 512 then
    raise exception 'META_APP_SECRET_INVALID_LENGTH';
  end if;

  select id
  into existing_secret_id
  from vault.secrets
  where name = 'meta_app_secret'
  limit 1;

  if existing_secret_id is null then
    perform vault.create_secret(
      normalized_secret,
      'meta_app_secret',
      'Meta App Secret for Instagram Login OAuth and webhook HMAC verification.'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      normalized_secret,
      'meta_app_secret',
      'Meta App Secret for Instagram Login OAuth and webhook HMAC verification.'
    );
  end if;
end
$$;

revoke all on function app_private.set_meta_app_secret(text) from public;
revoke all on function app_private.set_meta_app_secret(text) from anon;
revoke all on function app_private.set_meta_app_secret(text) from authenticated;
revoke all on function app_private.set_meta_app_secret(text) from service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'automation_web') then
    grant execute on function app_private.set_meta_app_secret(text) to automation_web;
  end if;
end
$$;

comment on function app_private.set_meta_app_secret(text) is
  'Write-only allowlisted bridge for provisioning the Meta App Secret into Vault from the authenticated operator Setup Center.';
