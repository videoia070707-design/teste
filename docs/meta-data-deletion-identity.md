# Meta Data Deletion — identity mapping gate

Status: **EXTERNAL VALIDATION REQUIRED**

## Why this exists

The product intentionally stores two provider identities on a channel connection:

- `external_account_id`: identity used by Instagram API operations and messaging;
- `provider_subject_id`: exact app-scoped identity used to resolve signed provider data-deletion callbacks.

They must not be assumed equivalent without provider evidence.

## Current safe behavior

`instagram-data-deletion` verifies the provider `signed_request` with the Meta App Secret and extracts the exact `user_id` from the verified payload.

The deletion routine only erases data when that verified subject matches `channel_connections.provider_subject_id` for the same provider.

If there are existing Instagram connections without a proven `provider_subject_id` mapping, a signed deletion request with no exact match converges to `MANUAL_REVIEW` instead of deleting by username, display name, approximate ID, phone number, or any other fuzzy heuristic.

Public deletion status treats `MANUAL_REVIEW` as pending, never completed.

## What is still unproven

The current Meta documentation available to this development session did not provide a reliable, primary-source statement proving that the `user_id` in the App Dashboard Data Deletion `signed_request` is identical to the Instagram user/account identifier returned by the Instagram Login token exchange.

The direct Meta documentation endpoint was also rate-limited during verification. Because of that, the OAuth callback does **not** currently copy `external_account_id` into `provider_subject_id`.

## What closes this gate

One of the following must be obtained from current primary Meta documentation or a reproducible real App test:

1. explicit documentation defining the signed deletion `user_id` and its relationship to Instagram Login identity; or
2. a real signed deletion callback from the configured Meta App where the verified subject can be compared to the identity obtained during the same app/account OAuth flow.

Only after that evidence exists may the mapping be persisted automatically.

## Non-negotiable invariant

Never replace this gate with fuzzy matching or a best-effort deletion based on usernames/names. A false negative may require manual review; a false positive could erase the wrong tenant/channel data.

This gate is operational/compliance readiness. It does not fabricate or substitute G3 HOST PASS evidence.