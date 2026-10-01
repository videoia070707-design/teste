# Migration state — G3 Free runtime

Last verified against the real Supabase project: 2026-10-01 UTC.

## Portable PostgreSQL stream

The provider-independent stream under `database/` currently includes the original core plus the later portable/shared migrations, through:

- `028_provider_runtime_config_portability.sql`

Migration 028 gives the portable fallback the same final non-secret `provider_runtime_config` contract used by the Supabase adapter. Its Supabase mirror has the same Git SHA/content.

## Supabase adapter stream

The real Supabase project has applied adapter/shared migrations through:

- `028_provider_runtime_config_portability`

The native Supabase migration history is authoritative for this hosted project. The portable `app_private.schema_migrations` checksum ledger belongs to the Docker/self-hosted migration runner and must not be retroactively adopted in the hosted project without an explicit reconciliation procedure.

## Historical duplicate migration names

The native Supabase history contains multiple entries named `meta_compliance` from bootstrap iterations. Do not delete or rewrite those native migration-history rows manually.

The underlying migration was intentionally idempotent. A live schema verification confirmed there is exactly one of each relevant final object:

- `app_private.data_deletion_requests` table;
- `app_private.delete_provider_subject_data(text,text)` function;
- `channel_connections_provider_subject_idx`;
- `data_deletion_requests_status_idx`.

Therefore the duplicate history names are provenance noise, not duplicated schema objects.

## Rule going forward

Every new schema change gets a new numbered filename and a distinct descriptive migration name. Never reuse an old migration number/name for changed SQL.

Shared portable/Supabase migrations should remain byte-for-byte identical where the CI declares them mirrored. Supabase-specific extensions/Vault/Cron/PGMQ changes remain in `supabase/migrations` only.