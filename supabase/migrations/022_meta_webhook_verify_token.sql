-- Hosted configuration primitive: generate the Meta webhook verification token
-- inside Supabase Vault so no external paid secret manager/manual secret is needed.
-- The Meta App Secret remains external and must never be replaced by a placeholder.

do $$
declare
  generated_token text;
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'meta_webhook_verify_token'
  ) then
    generated_token := encode(gen_random_bytes(32), 'hex');

    perform vault.create_secret(
      generated_token,
      'meta_webhook_verify_token',
      'Random verification token for the public Instagram webhook challenge.'
    );
  end if;
end
$$;
