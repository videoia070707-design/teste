-- Supabase Free runtime adapter for G3.
-- PGMQ provides durable wake-up queues while app_private remains the source of truth.
-- Edge Functions consume these queues and preserve the existing lease/idempotency model.

create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists app_private.runtime_invocation_tokens (
  name text primary key,
  token_sha256 text not null check (length(token_sha256) = 64),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

revoke all on app_private.runtime_invocation_tokens from anon, authenticated;

-- Generate the scheduler token inside Postgres and keep the plaintext only in Vault.
-- The Edge Function compares the SHA-256 of the presented token with this server-only row.
do $$
declare
  generated_token text;
begin
  if not exists (
    select 1 from app_private.runtime_invocation_tokens where name = 'g3_runtime'
  ) then
    generated_token := encode(gen_random_bytes(32), 'hex');

    perform vault.create_secret(
      generated_token,
      'g3_runtime_cron_token',
      'Internal token used by pg_cron/pg_net to invoke the G3 Edge runtime.'
    );

    insert into app_private.runtime_invocation_tokens (name, token_sha256)
    values (
      'g3_runtime',
      encode(extensions.digest(generated_token, 'sha256'), 'hex')
    );
  end if;
end
$$;

-- Durable queues. Creation is guarded because pgmq.create is not a no-op when a queue exists.
do $$
begin
  if to_regclass('pgmq.q_instagram_ingress') is null then
    perform pgmq.create('instagram_ingress');
  end if;

  if to_regclass('pgmq.q_instagram_outbound') is null then
    perform pgmq.create('instagram_outbound');
  end if;
end
$$;

create or replace function app_private.enqueue_instagram_ingress_runtime()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app_private, pgmq
as $$
begin
  perform pgmq.send(
    'instagram_ingress',
    jsonb_build_object('ingress_id', new.id::text)
  );
  return new;
end
$$;

create or replace function app_private.enqueue_instagram_outbound_runtime()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app_private, pgmq
as $$
begin
  if new.direction = 'outbound' and new.delivery_state = 'QUEUED' then
    perform pgmq.send(
      'instagram_outbound',
      jsonb_build_object('message_id', new.id::text)
    );
  end if;
  return new;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'webhook_ingress_enqueue_supabase_runtime'
      and tgrelid = 'app_private.webhook_ingress_events'::regclass
  ) then
    execute 'create trigger webhook_ingress_enqueue_supabase_runtime
      after insert on app_private.webhook_ingress_events
      for each row execute function app_private.enqueue_instagram_ingress_runtime()';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'outbound_message_enqueue_supabase_runtime'
      and tgrelid = 'app_private.messages'::regclass
  ) then
    execute 'create trigger outbound_message_enqueue_supabase_runtime
      after insert on app_private.messages
      for each row execute function app_private.enqueue_instagram_outbound_runtime()';
  end if;
end
$$;

comment on table app_private.runtime_invocation_tokens is
  'Hashes for internal runtime invocation tokens. Plaintext lives only in Supabase Vault.';

comment on function app_private.enqueue_instagram_ingress_runtime() is
  'Wake-up signal only. webhook_ingress_events remains the authoritative durable state.';

comment on function app_private.enqueue_instagram_outbound_runtime() is
  'Wake-up signal only. messages remains the authoritative durable state.';
