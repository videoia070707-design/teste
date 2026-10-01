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

Use:

```text
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
DATABASE_URL=<Supavisor connection using automation_web role>
```

For a normal long-lived local Node process, Session Pooler `5432` is appropriate. If the dashboard is later moved to a serverless host, use Supavisor Transaction Pooler `6543`; the web database client already disables prepared statements and defaults to a one-connection application pool for transaction mode.

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
