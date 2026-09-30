import postgres from "npm:postgres@3.4.9";

const PROVIDER_KEY = "instagram.meta.official";
const INGRESS_QUEUE = "instagram_ingress";
const OUTBOUND_QUEUE = "instagram_outbound";
const INGRESS_MAX_ATTEMPTS = 8;
const OUTBOUND_MAX_ATTEMPTS = 5;
const INGRESS_BATCH = 10;
const OUTBOUND_BATCH = 10;
const INGRESS_LEASE_SECONDS = 60;
const OUTBOUND_LEASE_SECONDS = 45;
const SECRET_PURPOSE = "instagram.credentials";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface ClaimedIngress {
  id: string;
  provider: string;
  signatureValid: boolean;
  headers: unknown;
  parsedPayload: unknown | null;
  attemptCount: number;
  firstReceivedAt: string;
}

interface ResolvedConnection {
  id: string;
  workspaceId: string;
  authValid: boolean;
}

interface CanonicalIngressEvent {
  providerEventId: string;
  accountId: string;
  occurredAt: string;
  eventType: "message.received" | "message.sent" | "comment.received";
  payload: Record<string, unknown>;
  raw: unknown;
}

interface ClaimedMessage {
  id: string;
  workspaceId: string;
  connectionId: string;
  correlationId: string;
  messageType: string;
  attemptCount: number;
  payload: unknown;
}

interface ProviderConfig {
  graphBaseUrl: string;
  graphApiVersion: string;
}

interface InstagramCredentials {
  accessToken: string;
  igUserId: string;
}

type ProviderResult =
  | { kind: "accepted"; providerMessageId: string; acceptedAt: string }
  | { kind: "rejected"; code: string; retryable: boolean }
  | { kind: "unknown"; reason: string };

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const databaseUrl = Deno.env.get("SUPABASE_DB_URL")?.trim();
  if (!databaseUrl) {
    return Response.json({ error: "database_not_configured" }, { status: 503 });
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 10
  });

  const startedAt = Date.now();
  const workerId = `edge:${Deno.env.get("SB_EXECUTION_ID") ?? crypto.randomUUID()}`;

  try {
    const presentedToken = request.headers.get("x-runtime-token") ?? "";
    if (!(await verifyRuntimeToken(sql, presentedToken))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    await quarantineExpiredOutbound(sql);

    const ingressSignals = await readQueueSignals(sql, INGRESS_QUEUE, INGRESS_BATCH);
    const outboundSignals = await readQueueSignals(sql, OUTBOUND_QUEUE, OUTBOUND_BATCH);

    const ingressIds = ingressSignals
      .map((signal) => readString(signal.message, "ingress_id"))
      .filter((value): value is string => Boolean(value));
    const outboundIds = outboundSignals
      .map((signal) => readString(signal.message, "message_id"))
      .filter((value): value is string => Boolean(value));

    const ingressProcessed = await processIngressIds(sql, ingressIds, workerId);
    const outboundProcessed = await processOutboundIds(sql, outboundIds, workerId);

    await deleteQueueSignals(sql, INGRESS_QUEUE, ingressSignals.map((signal) => signal.msgId));
    await deleteQueueSignals(sql, OUTBOUND_QUEUE, outboundSignals.map((signal) => signal.msgId));

    // Recovery sweep is deliberate: PGMQ is a wake-up accelerator, while the
    // authoritative work state remains in app_private. If a trigger/signal is
    // ever missed, Cron still recovers ready rows without losing work.
    const ingressRecovery = await findReadyIngressIds(sql, Math.max(0, INGRESS_BATCH - ingressProcessed));
    const outboundRecovery = await findReadyOutboundIds(sql, Math.max(0, OUTBOUND_BATCH - outboundProcessed));

    const ingressRecovered = await processIngressIds(sql, ingressRecovery, workerId);
    const outboundRecovered = await processOutboundIds(sql, outboundRecovery, workerId);

    await writeRuntimeHeartbeat(sql, workerId);

    return Response.json({
      ok: true,
      ingressProcessed: ingressProcessed + ingressRecovered,
      outboundProcessed: outboundProcessed + outboundRecovered,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    console.error("g3-runtime invocation failed", error);
    return Response.json(
      { error: "runtime_failure" },
      { status: 500 }
    );
  } finally {
    await sql.end({ timeout: 3 });
  }
});

async function verifyRuntimeToken(sql: ReturnType<typeof postgres>, token: string): Promise<boolean> {
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const [row] = await sql<{ token_sha256: string }[]>`
    select token_sha256
    from app_private.runtime_invocation_tokens
    where name = 'g3_runtime'
    limit 1
  `;
  return Boolean(row && row.token_sha256 === tokenHash);
}

async function readQueueSignals(
  sql: ReturnType<typeof postgres>,
  queueName: string,
  quantity: number
): Promise<Array<{ msgId: string; message: unknown }>> {
  const rows = await sql<{ msg_id: string | number; message: unknown }[]>`
    select msg_id, message
    from pgmq.read(${queueName}, 60, ${quantity})
  `;
  return rows.map((row) => ({ msgId: String(row.msg_id), message: row.message }));
}

async function deleteQueueSignals(
  sql: ReturnType<typeof postgres>,
  queueName: string,
  messageIds: string[]
): Promise<void> {
  for (const messageId of messageIds) {
    await sql`select pgmq.delete(${queueName}, ${messageId}::bigint)`;
  }
}

async function findReadyIngressIds(sql: ReturnType<typeof postgres>, limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await sql<{ id: string }[]>`
    select id
    from app_private.webhook_ingress_events
    where attempt_count < ${INGRESS_MAX_ATTEMPTS}
      and (
        (processing_state in ('RECEIVED','UNMATCHED','FAILED') and available_at <= now())
        or (processing_state = 'PROCESSING' and locked_until is not null and locked_until <= now())
      )
    order by available_at asc, first_received_at asc
    limit ${limit}
  `;
  return rows.map((row) => row.id);
}

async function processIngressIds(
  sql: ReturnType<typeof postgres>,
  ids: string[],
  workerId: string
): Promise<number> {
  let processed = 0;
  for (const id of [...new Set(ids)]) {
    const ingress = await claimIngress(sql, id, workerId);
    if (!ingress) continue;
    processed += 1;
    await processIngress(sql, ingress);
  }
  return processed;
}

async function claimIngress(
  sql: ReturnType<typeof postgres>,
  id: string,
  workerId: string
): Promise<ClaimedIngress | null> {
  const [row] = await sql<{
    id: string;
    provider: string;
    signature_valid: boolean;
    headers: unknown;
    parsed_payload: unknown | null;
    attempt_count: number;
    first_received_at: string;
  }[]>`
    update app_private.webhook_ingress_events
    set
      processing_state = 'PROCESSING',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      locked_until = now() + (${INGRESS_LEASE_SECONDS} * interval '1 second'),
      locked_by = ${workerId},
      last_error = null
    where id = ${id}
      and attempt_count < ${INGRESS_MAX_ATTEMPTS}
      and (
        (processing_state in ('RECEIVED','UNMATCHED','FAILED') and available_at <= now())
        or (processing_state = 'PROCESSING' and locked_until is not null and locked_until <= now())
      )
    returning id, provider, signature_valid, headers, parsed_payload, attempt_count, first_received_at
  `;

  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    signatureValid: row.signature_valid,
    headers: row.headers,
    parsedPayload: row.parsed_payload,
    attemptCount: row.attempt_count,
    firstReceivedAt: row.first_received_at
  };
}

async function processIngress(sql: ReturnType<typeof postgres>, ingress: ClaimedIngress): Promise<void> {
  if (ingress.provider !== PROVIDER_KEY) return markIngressDead(sql, ingress.id, `UNSUPPORTED_PROVIDER:${ingress.provider}`);
  if (!ingress.signatureValid) return markIngressDead(sql, ingress.id, "INVALID_SIGNATURE");
  if (ingress.parsedPayload === null) return markIngressDead(sql, ingress.id, "INVALID_JSON");

  try {
    const events = await normalizeSupportedEvents(ingress.parsedPayload);
    if (events.length === 0) {
      await markIngressResolved(sql, ingress.id, "NO_SUPPORTED_EVENTS");
      return;
    }

    let unmatched = false;
    for (const event of events) {
      const connection = await resolveConnection(sql, event.accountId);
      if (!connection) {
        unmatched = true;
        continue;
      }
      await persistCanonicalEvent(sql, ingress, connection, event);
    }

    if (unmatched) {
      await rescheduleIngress(sql, ingress, "UNMATCHED", "NO_CONNECTION_FOR_ONE_OR_MORE_ACCOUNTS");
      return;
    }

    await markIngressResolved(sql, ingress.id, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_INGRESS_ERROR";
    if (message === "SUSPICIOUS_EVENT_COLLISION") {
      await markIngressDead(sql, ingress.id, message);
      return;
    }
    await rescheduleIngress(sql, ingress, "FAILED", message);
  }
}

async function resolveConnection(
  sql: ReturnType<typeof postgres>,
  accountId: string
): Promise<ResolvedConnection | null> {
  const [row] = await sql<{ id: string; workspace_id: string; auth_valid: boolean }[]>`
    select id, workspace_id, auth_valid
    from app_private.channel_connections
    where provider_key = ${PROVIDER_KEY}
      and external_account_id = ${accountId}
    order by created_at asc
    limit 1
  `;
  return row ? { id: row.id, workspaceId: row.workspace_id, authValid: row.auth_valid } : null;
}

async function persistCanonicalEvent(
  sql: ReturnType<typeof postgres>,
  ingress: ClaimedIngress,
  connection: ResolvedConnection,
  event: CanonicalIngressEvent
): Promise<void> {
  const fingerprint = await sha256Hex(stableJson(event.raw));

  await sql.begin(async (tx) => {
    const [insertedRaw] = await tx<{ id: string }[]>`
      insert into app_private.raw_events (
        workspace_id, connection_id, provider, provider_event_id,
        signature_valid, fingerprint, headers, payload, received_at, processing_state
      ) values (
        ${connection.workspaceId}, ${connection.id}, ${PROVIDER_KEY}, ${event.providerEventId},
        true, ${fingerprint}, ${tx.json(ingress.headers as never)}, ${tx.json(event.raw as never)},
        ${ingress.firstReceivedAt}, 'VALIDATED'
      )
      on conflict (connection_id, provider_event_id) do nothing
      returning id
    `;

    if (!insertedRaw) {
      const [existing] = await tx<{ id: string; fingerprint: string | null }[]>`
        select id, fingerprint
        from app_private.raw_events
        where connection_id = ${connection.id}
          and provider_event_id = ${event.providerEventId}
        limit 1
      `;
      if (!existing) throw new Error("RAW_EVENT_CONFLICT_WITHOUT_ROW");
      if (existing.fingerprint !== fingerprint) throw new Error("SUSPICIOUS_EVENT_COLLISION");
      await recordWebhookEvidence(tx, connection, event.occurredAt);
      return;
    }

    const correlationId = crypto.randomUUID();
    const [canonical] = await tx<{ id: string }[]>`
      insert into app_private.canonical_events (
        raw_event_id, workspace_id, connection_id, event_type, channel, provider,
        provider_event_id, correlation_id, occurred_at, received_at, payload
      ) values (
        ${insertedRaw.id}, ${connection.workspaceId}, ${connection.id}, ${event.eventType},
        'instagram', ${PROVIDER_KEY}, ${event.providerEventId}, ${correlationId},
        ${event.occurredAt}, ${ingress.firstReceivedAt}, ${tx.json(event.payload as never)}
      )
      returning id
    `;
    if (!canonical) throw new Error("CANONICAL_EVENT_INSERT_RETURNED_NO_ROW");

    await tx`
      insert into app_private.outbox_events (
        workspace_id, topic, aggregate_type, aggregate_id, payload
      ) values (
        ${connection.workspaceId}, ${event.eventType}, 'canonical_event', ${canonical.id},
        ${tx.json({
          canonicalEventId: canonical.id,
          eventType: event.eventType,
          connectionId: connection.id,
          correlationId
        } as never)}
      )
    `;

    await tx`update app_private.raw_events set processing_state = 'PROCESSED' where id = ${insertedRaw.id}`;
    await recordWebhookEvidence(tx, connection, event.occurredAt);
  });
}

async function recordWebhookEvidence(tx: any, connection: ResolvedConnection, occurredAt: string): Promise<void> {
  await tx`
    insert into app_private.connection_webhook_evidence (
      connection_id, last_verified_event_at, consecutive_valid_events,
      consecutive_invalid_events, updated_at
    ) values (${connection.id}, ${occurredAt}, 1, 0, now())
    on conflict (connection_id)
    do update set
      last_verified_event_at = greatest(
        coalesce(app_private.connection_webhook_evidence.last_verified_event_at, excluded.last_verified_event_at),
        excluded.last_verified_event_at
      ),
      consecutive_valid_events = app_private.connection_webhook_evidence.consecutive_valid_events + 1,
      consecutive_invalid_events = 0,
      updated_at = now()
  `;

  await tx`
    update app_private.channel_connections
    set
      webhook_healthy = true,
      last_event_at = greatest(coalesce(last_event_at, ${occurredAt}), ${occurredAt}),
      health_state = case
        when not auth_valid then 'AUTH_EXPIRED'
        when health_state = 'AUTH_EXPIRED' then 'STALE'
        else health_state
      end,
      updated_at = now()
    where id = ${connection.id}
  `;
}

async function markIngressResolved(sql: ReturnType<typeof postgres>, id: string, note: string | null): Promise<void> {
  await sql`
    update app_private.webhook_ingress_events
    set processing_state = 'RESOLVED', processed_at = now(), locked_at = null,
        locked_until = null, locked_by = null, last_error = ${note}
    where id = ${id}
  `;
}

async function rescheduleIngress(
  sql: ReturnType<typeof postgres>,
  ingress: ClaimedIngress,
  state: "UNMATCHED" | "FAILED",
  error: string
): Promise<void> {
  if (ingress.attemptCount >= INGRESS_MAX_ATTEMPTS) {
    await markIngressDead(sql, ingress.id, error);
    return;
  }
  const delaySeconds = Math.min(15 * 2 ** Math.max(0, ingress.attemptCount - 1), 1800);
  await sql`
    update app_private.webhook_ingress_events
    set processing_state = ${state},
        available_at = now() + (${delaySeconds} * interval '1 second'),
        locked_at = null, locked_until = null, locked_by = null,
        last_error = ${truncate(error, 500)}
    where id = ${ingress.id}
  `;
}

async function markIngressDead(sql: ReturnType<typeof postgres>, id: string, error: string): Promise<void> {
  await sql`
    update app_private.webhook_ingress_events
    set processing_state = 'DEAD', processed_at = now(), locked_at = null,
        locked_until = null, locked_by = null, last_error = ${truncate(error, 500)}
    where id = ${id}
  `;
}

async function findReadyOutboundIds(sql: ReturnType<typeof postgres>, limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await sql<{ id: string }[]>`
    select id
    from app_private.messages
    where direction = 'outbound'
      and delivery_state in ('QUEUED','RETRYING')
      and available_at <= now()
    order by available_at asc, created_at asc
    limit ${limit}
  `;
  return rows.map((row) => row.id);
}

async function processOutboundIds(
  sql: ReturnType<typeof postgres>,
  ids: string[],
  workerId: string
): Promise<number> {
  let processed = 0;
  for (const id of [...new Set(ids)]) {
    const message = await claimOutbound(sql, id, workerId);
    if (!message) continue;
    processed += 1;
    await processOutbound(sql, message);
  }
  return processed;
}

async function claimOutbound(
  sql: ReturnType<typeof postgres>,
  id: string,
  workerId: string
): Promise<ClaimedMessage | null> {
  const [row] = await sql<{
    id: string;
    workspace_id: string;
    connection_id: string;
    correlation_id: string;
    message_type: string;
    attempt_count: number;
    payload: unknown;
  }[]>`
    update app_private.messages
    set delivery_state = 'PROCESSING',
        attempt_count = attempt_count + 1,
        locked_at = now(),
        locked_until = now() + (${OUTBOUND_LEASE_SECONDS} * interval '1 second'),
        locked_by = ${workerId},
        updated_at = now()
    where id = ${id}
      and direction = 'outbound'
      and delivery_state in ('QUEUED','RETRYING')
      and available_at <= now()
    returning id, workspace_id, connection_id, correlation_id, message_type, attempt_count, payload
  `;

  return row ? {
    id: row.id,
    workspaceId: row.workspace_id,
    connectionId: row.connection_id,
    correlationId: row.correlation_id,
    messageType: row.message_type,
    attemptCount: row.attempt_count,
    payload: row.payload
  } : null;
}

async function quarantineExpiredOutbound(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql`
    update app_private.messages
    set delivery_state = 'SEND_RESULT_UNKNOWN',
        reconciliation_required = true,
        last_error_code = 'EDGE_LEASE_EXPIRED_AFTER_DISPATCH_POSSIBLE',
        locked_at = null, locked_until = null, locked_by = null,
        updated_at = now()
    where direction = 'outbound'
      and delivery_state = 'PROCESSING'
      and locked_until is not null
      and locked_until <= now()
  `;
}

async function processOutbound(sql: ReturnType<typeof postgres>, message: ClaimedMessage): Promise<void> {
  let result: ProviderResult;
  try {
    result = await dispatchProviderMutation(sql, message);
  } catch (error) {
    await finishOutboundFailure(
      sql,
      message.id,
      error instanceof Error ? error.message : "PROVIDER_PRE_DISPATCH_FAILURE"
    );
    return;
  }

  try {
    if (result.kind === "accepted") {
      await sql`
        update app_private.messages
        set delivery_state = 'SENT', provider_message_id = ${result.providerMessageId},
            last_provider_timestamp = ${result.acceptedAt}, last_error_code = null,
            reconciliation_required = false, locked_at = null, locked_until = null,
            locked_by = null, updated_at = now()
        where id = ${message.id}
      `;
      return;
    }

    if (result.kind === "unknown") {
      await sql`
        update app_private.messages
        set delivery_state = 'SEND_RESULT_UNKNOWN', reconciliation_required = true,
            last_error_code = ${truncate(result.reason, 500)}, locked_at = null,
            locked_until = null, locked_by = null, updated_at = now()
        where id = ${message.id}
      `;
      return;
    }

    if (!result.retryable) {
      await finishOutboundFailure(sql, message.id, result.code);
      return;
    }

    const delay = retryDelayForAttempt(message.attemptCount);
    if (delay === null) {
      await sql`
        update app_private.messages
        set delivery_state = 'DEAD', reconciliation_required = false,
            last_error_code = ${truncate(result.code, 500)}, locked_at = null,
            locked_until = null, locked_by = null, updated_at = now()
        where id = ${message.id}
      `;
      return;
    }

    await sql`
      update app_private.messages
      set delivery_state = 'RETRYING', reconciliation_required = false,
          last_error_code = ${truncate(result.code, 500)},
          available_at = now() + (${delay} * interval '1 second'),
          locked_at = null, locked_until = null, locked_by = null, updated_at = now()
      where id = ${message.id}
    `;
  } catch (error) {
    // Provider dispatch already happened. Deliberately preserve PROCESSING and
    // its lease so the next invocation quarantines the outcome as UNKNOWN.
    console.error("provider outcome persistence failed", {
      messageId: message.id,
      correlationId: message.correlationId,
      error: error instanceof Error ? error.message : "UNKNOWN_PERSISTENCE_FAILURE"
    });
  }
}

async function finishOutboundFailure(sql: ReturnType<typeof postgres>, id: string, code: string): Promise<void> {
  await sql`
    update app_private.messages
    set delivery_state = 'FAILED', reconciliation_required = false,
        last_error_code = ${truncate(code, 500)}, locked_at = null,
        locked_until = null, locked_by = null, updated_at = now()
    where id = ${id}
  `;
}

function retryDelayForAttempt(attemptCount: number): number | null {
  if (attemptCount >= OUTBOUND_MAX_ATTEMPTS) return null;
  const delays = [15, 60, 300, 1800];
  return delays[Math.min(attemptCount - 1, delays.length - 1)] ?? null;
}

async function dispatchProviderMutation(
  sql: ReturnType<typeof postgres>,
  message: ClaimedMessage
): Promise<ProviderResult> {
  const credentials = await resolveInstagramCredentials(sql, message.connectionId);
  if (!credentials) {
    return { kind: "rejected", code: "AUTH_CREDENTIALS_MISSING", retryable: false };
  }

  const config = await getProviderConfig(sql);
  let url: URL;
  let body: unknown;

  if (message.messageType === "text") {
    const payload = parseTextPayload(message.payload);
    url = new URL(
      `${encodeURIComponent(config.graphApiVersion)}/${encodeURIComponent(credentials.igUserId)}/messages`,
      ensureTrailingSlash(config.graphBaseUrl)
    );
    body = { recipient: { id: payload.recipientExternalId }, message: { text: payload.text } };
  } else if (message.messageType === "instagram_comment_public_reply") {
    const payload = parseCommentPayload(message.payload);
    url = new URL(
      `${encodeURIComponent(config.graphApiVersion)}/${encodeURIComponent(payload.commentId)}/replies`,
      ensureTrailingSlash(config.graphBaseUrl)
    );
    body = { message: payload.text };
  } else if (message.messageType === "instagram_comment_private_reply") {
    const payload = parseCommentPayload(message.payload);
    url = new URL(
      `${encodeURIComponent(config.graphApiVersion)}/${encodeURIComponent(credentials.igUserId)}/messages`,
      ensureTrailingSlash(config.graphBaseUrl)
    );
    body = { recipient: { comment_id: payload.commentId }, message: { text: payload.text } };
  } else {
    throw new Error(`UNSUPPORTED_OUTBOUND_MESSAGE_TYPE:${message.messageType}`);
  }

  return postProviderMutation(url, credentials.accessToken, body, message.messageType);
}

async function postProviderMutation(
  url: URL,
  accessToken: string,
  body: unknown,
  messageType: string
): Promise<ProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    let payload: any = null;
    try { payload = await response.json(); } catch { payload = null; }

    if (response.ok) {
      const successId = messageType === "instagram_comment_public_reply"
        ? typeof payload?.id === "string" ? payload.id : null
        : typeof payload?.message_id === "string" ? payload.message_id : null;

      return successId
        ? { kind: "accepted", providerMessageId: successId, acceptedAt: new Date().toISOString() }
        : { kind: "unknown", reason: "AMBIGUOUS_PROVIDER_SUCCESS_WITHOUT_ID" };
    }

    if (response.status >= 500) {
      return { kind: "unknown", reason: `HTTP_${response.status}_AMBIGUOUS` };
    }

    const code = payload?.error?.code ? String(payload.error.code) : `HTTP_${response.status}`;
    return { kind: "rejected", code, retryable: response.status === 429 };
  } catch (error) {
    return {
      kind: "unknown",
      reason: error instanceof DOMException && error.name === "AbortError"
        ? "PROVIDER_TIMEOUT_AFTER_DISPATCH"
        : "PROVIDER_TRANSPORT_CLOSED_AFTER_DISPATCH"
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getProviderConfig(sql: ReturnType<typeof postgres>): Promise<ProviderConfig> {
  const [row] = await sql<{ graph_base_url: string; graph_api_version: string }[]>`
    select graph_base_url, graph_api_version
    from app_private.provider_runtime_config
    where provider_key = ${PROVIDER_KEY}
    limit 1
  `;
  if (!row) throw new Error("INSTAGRAM_RUNTIME_CONFIG_MISSING");
  return { graphBaseUrl: row.graph_base_url, graphApiVersion: row.graph_api_version };
}

async function resolveInstagramCredentials(
  sql: ReturnType<typeof postgres>,
  connectionId: string
): Promise<InstagramCredentials | null> {
  const [row] = await sql<any[]>`
    select
      c.workspace_id,
      c.external_account_id,
      c.auth_valid,
      e.id as secret_id,
      e.algorithm,
      e.key_version,
      e.iv,
      e.ciphertext,
      e.auth_tag,
      e.aad
    from app_private.channel_connections c
    left join app_private.connection_secret_refs r on r.connection_id = c.id
    left join app_private.secret_envelopes e on e.id = r.secret_ref::uuid
    where c.id = ${connectionId}
      and c.provider_key = ${PROVIDER_KEY}
      and c.channel = 'instagram'
    limit 1
  `;

  if (!row?.auth_valid || !row.external_account_id || !row.secret_id) return null;
  if (row.algorithm !== "aes-256-gcm") throw new Error("UNSUPPORTED_SECRET_ALGORITHM");

  const keyring = await loadProviderKeyring(sql);
  const keyBase64 = keyring.keys[row.key_version];
  if (!keyBase64) throw new Error("SECRET_KEY_VERSION_UNAVAILABLE");

  const expectedAad = `automation-secret:v1:${row.workspace_id}:${SECRET_PURPOSE}:${row.secret_id}`;
  if (row.aad !== expectedAad) throw new Error("SECRET_AAD_MISMATCH");

  const plaintext = await decryptAesGcm({
    keyBase64,
    iv: toUint8Array(row.iv),
    ciphertext: toUint8Array(row.ciphertext),
    authTag: toUint8Array(row.auth_tag),
    aad: expectedAad
  });

  const parsed = JSON.parse(plaintext) as any;
  if (parsed?.schemaVersion !== 1 || typeof parsed.accessToken !== "string" || typeof parsed.igUserId !== "string") {
    throw new Error("INSTAGRAM_CREDENTIAL_INVALID");
  }
  if (parsed.igUserId !== row.external_account_id) throw new Error("INSTAGRAM_CREDENTIAL_IDENTITY_MISMATCH");
  if (typeof parsed.expiresAt === "string" && Date.parse(parsed.expiresAt) <= Date.now()) return null;

  return { accessToken: parsed.accessToken, igUserId: parsed.igUserId };
}

let providerKeyringCache: { currentVersion: string; keys: Record<string, string> } | null = null;
async function loadProviderKeyring(sql: ReturnType<typeof postgres>): Promise<{ currentVersion: string; keys: Record<string, string> }> {
  if (providerKeyringCache) return providerKeyringCache;
  const [row] = await sql<{ decrypted_secret: string }[]>`
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'provider_secret_keyring'
    order by created_at desc
    limit 1
  `;
  if (!row) throw new Error("PROVIDER_SECRET_KEYRING_MISSING");
  const parsed = JSON.parse(row.decrypted_secret) as any;
  if (typeof parsed?.currentVersion !== "string" || typeof parsed?.keys !== "object" || !parsed.keys) {
    throw new Error("PROVIDER_SECRET_KEYRING_INVALID");
  }
  providerKeyringCache = { currentVersion: parsed.currentVersion, keys: parsed.keys };
  return providerKeyringCache;
}

async function decryptAesGcm(input: {
  keyBase64: string;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  authTag: Uint8Array;
  aad: string;
}): Promise<string> {
  const rawKey = base64ToBytes(input.keyBase64);
  if (rawKey.byteLength !== 32) throw new Error("AES_KEY_LENGTH_INVALID");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const combined = new Uint8Array(input.ciphertext.byteLength + input.authTag.byteLength);
  combined.set(input.ciphertext, 0);
  combined.set(input.authTag, input.ciphertext.byteLength);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: input.iv,
      additionalData: textEncoder.encode(input.aad),
      tagLength: 128
    },
    key,
    combined
  );
  return textDecoder.decode(plaintext);
}

async function writeRuntimeHeartbeat(sql: ReturnType<typeof postgres>, workerId: string): Promise<void> {
  await sql`
    insert into app_private.worker_heartbeats (
      worker_kind, worker_id, started_at, last_seen_at, stopped_at, metadata
    ) values (
      'supabase_g3_runtime', ${workerId}, now(), now(), now(),
      ${sql.json({ runtime: "supabase-edge", mode: "cron-batch" } as never)}
    )
    on conflict (worker_kind, worker_id)
    do update set last_seen_at = now(), stopped_at = now(), metadata = excluded.metadata
  `;
}

async function normalizeSupportedEvents(payload: unknown): Promise<CanonicalIngressEvent[]> {
  const messages = await normalizeInstagramMessageWebhook(payload);
  const comments = await normalizeInstagramCommentWebhook(payload);
  return [...messages, ...comments];
}

async function normalizeInstagramMessageWebhook(payload: unknown): Promise<CanonicalIngressEvent[]> {
  if (!isRecord(payload) || payload.object !== "instagram" || !Array.isArray(payload.entry)) return [];
  const results: CanonicalIngressEvent[] = [];

  for (const entry of payload.entry) {
    if (!isRecord(entry)) continue;
    const accountId = typeof entry.id === "string" ? entry.id : "";
    const candidates: unknown[] = [];
    if (Array.isArray(entry.messaging)) candidates.push(...entry.messaging);
    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (isRecord(change) && change.field === "messages" && isRecord(change.value)) candidates.push(change.value);
      }
    }

    for (const rawEvent of candidates) {
      if (!isRecord(rawEvent)) continue;
      const sender = isRecord(rawEvent.sender) ? rawEvent.sender : null;
      const recipient = isRecord(rawEvent.recipient) ? rawEvent.recipient : null;
      const message = isRecord(rawEvent.message) ? rawEvent.message : null;
      const senderId = sender && typeof sender.id === "string" ? sender.id : "";
      const recipientId = recipient && typeof recipient.id === "string" ? recipient.id : accountId;
      if (!senderId || !recipientId || !message) continue;

      const messageId = typeof message.mid === "string" && message.mid ? message.mid : null;
      const occurredAt = normalizeTimestamp(rawEvent.timestamp);
      const effectiveAccountId = accountId || recipientId;
      const fallbackHash = await sha256Hex(JSON.stringify({ effectiveAccountId, senderId, recipientId, occurredAt, message }));
      const isEcho = message.is_echo === true;

      results.push({
        providerEventId: messageId ? `ig-message:${messageId}` : `ig-message-fallback:${fallbackHash}`,
        accountId: effectiveAccountId,
        occurredAt,
        eventType: isEcho ? "message.sent" : "message.received",
        payload: {
          senderExternalId: senderId,
          recipientExternalId: recipientId,
          providerMessageId: messageId,
          text: typeof message.text === "string" ? message.text : null,
          isEcho,
          attachments: Array.isArray(message.attachments) ? message.attachments : []
        },
        raw: rawEvent
      });
    }
  }
  return results;
}

async function normalizeInstagramCommentWebhook(payload: unknown): Promise<CanonicalIngressEvent[]> {
  if (!isRecord(payload) || payload.object !== "instagram" || !Array.isArray(payload.entry)) return [];
  const results: CanonicalIngressEvent[] = [];

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    const accountId = typeof entry.id === "string" ? entry.id : "";
    for (const change of entry.changes) {
      if (!isRecord(change) || (change.field !== "comments" && change.field !== "live_comments") || !isRecord(change.value)) continue;
      const value = change.value;
      const commentId = typeof value.id === "string" ? value.id : "";
      const media = isRecord(value.media) ? value.media : null;
      const mediaId = typeof value.media_id === "string" ? value.media_id : media && typeof media.id === "string" ? media.id : "";
      if (!accountId || !commentId || !mediaId) continue;

      const occurredAt = normalizeTimestamp(value.created_time ?? value.timestamp ?? entry.time);
      const timestampKey = occurredAt === new Date(0).toISOString()
        ? (await sha256Hex(stableJson(value))).slice(0, 20)
        : String(Date.parse(occurredAt));
      const from = isRecord(value.from) ? value.from : null;

      results.push({
        providerEventId: `ig-comment:${commentId}:${timestampKey}`,
        accountId,
        occurredAt,
        eventType: "comment.received",
        payload: {
          commentId,
          mediaId,
          text: typeof value.text === "string" ? value.text : null,
          commenterExternalId: from && typeof from.id === "string" ? from.id : null,
          commenterUsername: from && typeof from.username === "string"
            ? from.username
            : typeof value.username === "string" ? value.username : null
        },
        raw: value
      });
    }
  }
  return results;
}

function parseTextPayload(value: unknown): { recipientExternalId: string; text: string } {
  if (!isRecord(value) || value.channel !== "instagram") throw new Error("INVALID_OUTBOUND_TEXT_PAYLOAD");
  if (typeof value.recipientExternalId !== "string" || !value.recipientExternalId) throw new Error("RECIPIENT_EXTERNAL_ID_MISSING");
  if (typeof value.text !== "string" || !value.text) throw new Error("OUTBOUND_TEXT_MISSING");
  return { recipientExternalId: value.recipientExternalId, text: value.text };
}

function parseCommentPayload(value: unknown): { commentId: string; text: string } {
  if (!isRecord(value) || value.channel !== "instagram") throw new Error("INVALID_COMMENT_ACTION_PAYLOAD");
  if (typeof value.commentId !== "string" || !value.commentId) throw new Error("COMMENT_ID_MISSING");
  if (typeof value.text !== "string" || !value.text) throw new Error("COMMENT_ACTION_TEXT_MISSING");
  return { commentId: value.commentId, text: value.text };
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return normalizeTimestamp(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return new Date(0).toISOString();
  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(milliseconds).toISOString();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortJson(value[key]);
  return sorted;
}

function readString(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" && value[key] ? value[key] as string : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("EXPECTED_BINARY_VALUE");
}
