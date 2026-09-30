-- Invoke the Supabase Free Edge runtime immediately when new work arrives.
-- A 15-second Cron remains as a recovery/retry sweep, so correctness never
-- depends on the best-effort HTTP wake-up succeeding.

create or replace function app_private.invoke_g3_edge_runtime(source text)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, app_private, net, vault
as $$
declare
  runtime_token text;
  request_id bigint;
begin
  select decrypted_secret
  into runtime_token
  from vault.decrypted_secrets
  where name = 'g3_runtime_cron_token'
  order by created_at desc
  limit 1;

  if runtime_token is null then
    raise exception 'g3 runtime invocation token is unavailable';
  end if;

  select net.http_post(
    url := 'https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/g3-runtime',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-runtime-token', runtime_token
    ),
    body := jsonb_build_object('source', source),
    timeout_milliseconds := 10000
  ) into request_id;

  return request_id;
end
$$;

revoke all on function app_private.invoke_g3_edge_runtime(text) from anon, authenticated;

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
  perform app_private.invoke_g3_edge_runtime('ingress');
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
    perform app_private.invoke_g3_edge_runtime('outbound');
  end if;
  return new;
end
$$;

select cron.schedule(
  'g3-runtime-recovery',
  '15 seconds',
  $$select app_private.invoke_g3_edge_runtime('cron-recovery');$$
);

comment on function app_private.invoke_g3_edge_runtime(text) is
  'Async pg_net wake-up for the G3 Edge runtime. Cron recovery makes wake-up delivery non-critical.';