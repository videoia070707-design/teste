# G3 HOST PASS — zero-cost local dashboard path

Status: **preferred path for development / HOST PASS**

## Goal

Close G3 without provisioning a paid worker or a public web-dashboard host.

The public Meta-facing surfaces already live on Supabase Edge Free:

- OAuth callback: `/functions/v1/instagram-oauth-callback`
- webhook callback: `/functions/v1/instagram-webhook`
- data deletion callback: `/functions/v1/instagram-data-deletion`
- privacy/data-deletion documents: `/functions/v1/platform-legal`
- asynchronous ingress/outbound runtime: `g3-runtime` + PGMQ + pg_net + pg_cron

Because those surfaces are independent from `APP_ORIGIN`, the Next.js dashboard may run on `http://localhost:3000` during G3 HOST PASS.

## Local dashboard contract

Start from the committed template:

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

The template pins the safe/public values and leaves only the least-privilege database password as a local placeholder. The resulting `.env.local` is ignored by Git and must never be committed.

The effective contract is:

```text
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://cqtrigqlktekczbbsxiy.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<project publishable key>
GOOGLE_AUTH_ENABLED=false
DATABASE_URL=postgresql://automation_web.cqtrigqlktekczbbsxiy:<local-password>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

Provider secrets are deliberately absent from the local env. `META_APP_SECRET`, webhook verify token and provider AES keyring live in Supabase Vault.

Before starting Next.js, run:

```bash
pnpm hostpass:check
```

The checker fails closed when:

- the password placeholder was not replaced;
- a different project/role/pooler is used;
- TLS is missing;
- `APP_ORIGIN` is not the expected local origin;
- a Vault-owned provider secret leaked back into `.env.local`.

Then start the dashboard:

```bash
pnpm dev
```

For a normal long-lived local Node process, Session Pooler `5432` is appropriate. If the dashboard is later moved to a serverless host, use Supavisor Transaction Pooler `6543`; the web database client already disables prepared statements and defaults to a one-connection application pool for transaction mode.

## Setup Center

After authenticating, open:

`Settings → Setup Center`

Owner/Admin can configure:

- legal/operator name;
- support/privacy email;
- Meta App ID;
- OAuth authorize/token URLs after they are confirmed against the real Meta App/current official documentation;
- token encoding;
- long-lived token URL;
- identity probe path;
- **Meta App Secret through a password/write-only field**.

The Meta App Secret is sent server-side directly to the allowlisted `app_private.set_meta_app_secret()` bridge and stored in Supabase Vault. It is never pre-filled or rendered back. Leaving the field blank preserves the current secret. AuditLog records only that the secret field changed, never the secret value.

## Important consequence

A public Render/Netlify/Vercel deployment is **not a prerequisite for G3 HOST PASS**.

A public dashboard host may still be added later for beta/product access, but it must not be confused with provider reliability. Meta webhooks, OAuth return, deletion callbacks and the asynchronous provider runtime remain available even when the dashboard is offline.

## HOST PASS evidence remains unchanged

Local UI does not weaken the gate. PASS still requires persisted real evidence in the same workspace:

1. real Instagram OAuth completed and encrypted provider credential attached;
2. real signed Meta webhook normalized into `message.received`;
3. real outbound text reply accepted with a provider message ID.

No fixture, self-test, readiness attestation, localhost action or Edge heartbeat can substitute these three facts.

## Free-first rule

During G3 development:

- Supabase Free is the primary backend/runtime;
- do not provision paid background workers;
- do not require a paid dashboard host;
- Docker workers remain fallback/portability assets only;
- a hosted dashboard is a later product-access decision, not a provider gate dependency.
