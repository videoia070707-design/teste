-- Provider credentials are encrypted by the application before persistence.
-- The encryption key itself is never stored in PostgreSQL.

create table if not exists app_private.secret_envelopes (
  id uuid primary key,
  workspace_id uuid not null references app_private.workspaces(id) on delete cascade,
  purpose text not null,
  algorithm text not null check (algorithm = 'aes-256-gcm'),
  key_version text not null,
  iv bytea not null,
  ciphertext bytea not null,
  auth_tag bytea not null,
  aad text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create index if not exists secret_envelopes_workspace_idx
  on app_private.secret_envelopes(workspace_id, purpose);

comment on table app_private.secret_envelopes is
  'Application-encrypted provider credentials. Encryption keys live only in the deployment secret manager/KMS layer.';
