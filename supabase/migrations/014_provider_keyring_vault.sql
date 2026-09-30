-- Keep the provider AES keyring inside Supabase Vault so the free runtime does
-- not depend on an external secret manager. The plaintext key never lives in
-- application tables or source control.

do $$
declare
  keyring_json text;
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'provider_secret_keyring'
  ) then
    keyring_json := jsonb_build_object(
      'currentVersion', 'v1',
      'keys', jsonb_build_object(
        'v1', encode(gen_random_bytes(32), 'base64')
      )
    )::text;

    perform vault.create_secret(
      keyring_json,
      'provider_secret_keyring',
      'AES-256-GCM keyring for encrypted provider credentials.'
    );
  end if;
end
$$;