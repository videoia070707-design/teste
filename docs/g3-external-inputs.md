# G3 — External inputs required for real Meta HOST PASS

This checklist starts only after the internal G3 runtime is healthy. It must not be satisfied with guessed values, legacy Instagram Basic Display endpoints, fixtures, or direct database edits.

## Already provided by the platform

These values are generated/hosted by the current Supabase Free project and do not need a paid host:

- OAuth callback: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-oauth-callback`
- Webhook callback: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-webhook`
- Data deletion: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-data-deletion`
- Privacy policy: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/platform-legal?document=privacy`
- Webhook Verify Token: generated/rotated by G3 Console and stored in Supabase Vault
- Provider credential AES keyring: stored in Supabase Vault
- Runtime: Supabase Edge + queues + Cron

## Operator/public identity

Enter in G3 Console:

- `legalEntityName`: real operator/legal name to display on privacy/deletion pages
- `supportEmail`: real support/privacy contact address

Do not invent these values. Public legal pages remain unavailable until they are configured.

## Meta App values

Create/use the real Meta app intended for **Instagram API with Instagram Login** and collect:

- Meta App ID
- Meta App Secret
- OAuth authorization URL confirmed for this product/setup
- OAuth authorization-code token URL confirmed for this product/setup
- long-lived token exchange URL confirmed for this product/setup
- token encoding if the current Meta setup requires a specific encoding

### Secret handling

Enter the Meta App Secret directly in G3 Console. It is write-only and is stored in Supabase Vault through the allowlisted control-plane function. Do not commit it to GitHub and do not paste it into issue text/logs.

## Graph API version

The runtime is currently pinned to `v26.0`, but a seeded value is intentionally **not** readiness evidence.

Confirm the currently supported Graph API version against the real Meta developer documentation/App Dashboard before entering it in G3 Console. Saving the version sets `graph_api_version_confirmed_at` and is an explicit operator attestation.

## Identity health probe

`identityProbePath` is a health diagnostic, **not an OAuth/HOST PASS precondition**.

Do not copy `/me?fields=id,username` or other paths from Instagram Basic Display examples by assumption. Configure a probe only after a supported endpoint is validated for the real Instagram Login token/account. Until then the connection may remain `STALE` rather than falsely `HEALTHY`, while OAuth/inbound/outbound HOST PASS can still proceed.

## Permissions used by G3

The product requests only the capabilities implemented in this gate:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

Publishing permission is not requested until publishing is actually implemented.

## Real-account requirements

Use an Instagram professional **Business or Creator** account supported by Instagram Login. Configure the Meta test roles/testers required by the app while it is not public.

For messaging HOST PASS, use a second Instagram account to initiate a real conversation with the connected professional account. The platform must observe that inbound conversation before allowing the corresponding outbound reply.

## HOST PASS evidence

G3 does not pass because configuration is saved. The same workspace must contain:

1. real OAuth + encrypted credential reference;
2. a real signed webhook normalized to `message.received`;
3. a real outbound text message accepted by Meta with `provider_message_id`.

Only then may the dashboard derive `G3 PASS`.
