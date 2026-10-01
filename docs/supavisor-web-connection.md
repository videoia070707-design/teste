# Supavisor web connection — validated G3 profile

This note records the **sanitized** connection profile that passed a real login/permission self-test on the Supabase Free project. It contains no password or Vault value.

## Validated profile

- Project ref: `cqtrigqlktekczbbsxiy`
- Pooler host: `aws-0-sa-east-1.pooler.supabase.com`
- Port: `5432`
- Database: `postgres`
- Username: `automation_web.cqtrigqlktekczbbsxiy`
- Mode: Supavisor **Session**
- TLS: `sslmode=require`
- Current low-traffic pool cap: `DATABASE_POOL_MAX=3`

Secret template only:

```text
postgresql://automation_web.cqtrigqlktekczbbsxiy:<VAULT_PASSWORD>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

`<VAULT_PASSWORD>` is the value stored as `automation_web_db_password` in Supabase Vault. Never commit, log, or paste that value into documentation/chat.

## Real self-test evidence

A temporary protected Edge diagnostic connected through the profile above and confirmed all four invariants:

- `current_user = automation_web`;
- `app_private` is readable with the granted least-privilege policy;
- `app_private.get_platform_secret(...)` works through the allowlisted SECURITY DEFINER bridge;
- direct access to `vault.decrypted_secrets` is denied.

After PASS, the deployed diagnostic was retired with HTTP 410 and JWT protection.

## Why not the direct database hostname

The Free project direct hostname `db.<project-ref>.supabase.co:5432` is IPv6. An IPv4-only host must use the shared Supavisor pooler instead. For a persistent web/container process use Session mode on port 5432. Transaction mode on 6543 remains an optional serverless/short-lived profile, not the validated G3 web profile.

## Scope

This connection profile is **not required to keep G3 callbacks/runtime alive**. The primary G3 runtime, webhook, OAuth callback, legal endpoints and operational console already run on Supabase Free. This profile exists for the optional full Next.js dashboard deployment and future portable hosts.
