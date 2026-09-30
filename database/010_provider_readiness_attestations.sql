-- External provider readiness facts that cannot be proven from runtime traffic.
-- These attestations are operational checklists only. They MUST NOT be used as
-- substitutes for live HOST PASS evidence (OAuth, signed webhook, provider-acked send).

create table if not exists app_private.provider_readiness_attestations (
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  provider_key text not null,
  check_key text not null,
  status text not null check (status in ('confirmed','blocked','not_applicable')),
  note text,
  confirmed_by_user_id uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider_key, check_key)
);

create index if not exists provider_readiness_provider_idx
  on app_private.provider_readiness_attestations(workspace_id, provider_key, updated_at desc);

comment on table app_private.provider_readiness_attestations is
  'Manual operational readiness confirmations. Never treat these rows as evidence that provider traffic works.';
