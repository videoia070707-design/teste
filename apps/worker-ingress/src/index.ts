import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  normalizeInstagramCommentWebhook,
  normalizeInstagramMessageWebhook
} from "@automation/provider-instagram-official/webhooks";
import { createDatabaseClient, type DatabaseClient } from "@automation/storage-postgres";

const PROVIDER_KEY = "instagram.meta.official";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 8;

interface ClaimedIngress {
  id: string;
  provider: string;
  signatureValid: boolean;
  bodySha256: string;
  headers: unknown;
  parsedPayload: unknown | null;
  providerAccountIds: string[];
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

class SuspiciousEventCollisionError extends Error {
  constructor() {
    super("SUSPICIOUS_EVENT_COLLISION");
    this.name = "SuspiciousEventCollisionError";
  }
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const batchSize = readPositiveInt("INGRESS_WORKER_BATCH_SIZE", DEFAULT_BATCH_SIZE, 1, 100);
  const pollMs = readPositiveInt("INGRESS_WORKER_POLL_MS", DEFAULT_POLL_MS, 100, 60_000);
  const leaseSeconds = readPositiveInt("INGRESS_WORKER_LEASE_SECONDS", DEFAULT_LEASE_SECONDS, 10, 600);
  const workerId = process.env.INGRESS_WORKER_ID?.trim() || `${hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
  const sql = createDatabaseClient(databaseUrl);

  let stopping = false;
  const stop = () => {
    stopping = true;
  };

  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  try {
    while (!stopping) {
      const batch = await claimBatch(sql, workerId, batchSize, leaseSeconds);

      if (batch.length === 0) {
        await sleep(pollMs);
        continue;
      }

      for (const ingress of batch) {
        if (stopping) break;
        await processIngress(sql, ingress);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function claimBatch(
  sql: DatabaseClient,
  workerId: string,
  limit: number,
  leaseSeconds: number
): Promise<ClaimedIngress[]> {
  const rows = await sql<{
    id: string;
    provider: string;
    signature_valid: boolean;
    body_sha256: string;
    headers: unknown;
    parsed_payload: unknown | null;
    provider_account_ids: string[];
    attempt_count: number;
    first_received_at: string;
  }[]>`
    with candidates as (
      select id
      from app_private.webhook_ingress_events
      where
        attempt_count < ${MAX_ATTEMPTS}
        and (
          (
            processing_state in ('RECEIVED','UNMATCHED','FAILED')
            and available_at <= now()
          )
          or (
            processing_state = 'PROCESSING'
            and locked_until is not null
            and locked_until <= now()
          )
        )
      order by available_at asc, first_received_at asc
      for update skip locked
      limit ${limit}
    )
    update app_private.webhook_ingress_events ingress
    set
      processing_state = 'PROCESSING',
      attempt_count = ingress.attempt_count + 1,
      locked_at = now(),
      locked_until = now() + (${leaseSeconds} * interval '1 second'),
      locked_by = ${workerId},
      last_error = null
    from candidates
    where ingress.id = candidates.id
    returning
      ingress.id,
      ingress.provider,
      ingress.signature_valid,
      ingress.body_sha256,
      ingress.headers,
      ingress.parsed_payload,
      ingress.provider_account_ids,
      ingress.attempt_count,
      ingress.first_received_at
  `;

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    signatureValid: row.signature_valid,
    bodySha256: row.body_sha256,
    headers: row.headers,
    parsedPayload: row.parsed_payload,
    providerAccountIds: row.provider_account_ids,
    attemptCount: row.attempt_count,
    firstReceivedAt: row.first_received_at
  }));
}

async function processIngress(sql: DatabaseClient, ingress: ClaimedIngress): Promise<void> {
  if (ingress.provider !== PROVIDER_KEY) {
    await markDead(sql, ingress.id, `UNSUPPORTED_PROVIDER:${ingress.provider}`);
    return;
  }

  if (!ingress.signatureValid) {
    await markDead(sql, ingress.id, "INVALID_SIGNATURE");
    return;
  }

  if (ingress.parsedPayload === null) {
    await markDead(sql, ingress.id, "INVALID_JSON");
    return;
  }

  try {
    const events = normalizeSupportedEvents(ingress.parsedPayload);

    if (events.length === 0) {
      await markResolved(sql, ingress.id, "NO_SUPPORTED_EVENTS");
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
      await reschedule(sql, ingress, "UNMATCHED", "NO_CONNECTION_FOR_ONE_OR_MORE_ACCOUNTS");
      return;
    }

    await markResolved(sql, ingress.id, null);
  } catch (error) {
    if (error instanceof SuspiciousEventCollisionError) {
      await markDead(sql, ingress.id, error.message);
      return;
    }

    const message = error instanceof Error ? error.message : "UNKNOWN_INGRESS_ERROR";
    await reschedule(sql, ingress, "FAILED", message);
  }
}

function normalizeSupportedEvents(payload: unknown): CanonicalIngressEvent[] {
  const messages: CanonicalIngressEvent[] = normalizeInstagramMessageWebhook(payload).map((event) => ({
    providerEventId: event.providerEventId,
    accountId: event.accountId,
    occurredAt: event.occurredAt,
    eventType: event.isEcho ? "message.sent" : "message.received",
    payload: {
      senderExternalId: event.senderId,
      recipientExternalId: event.recipientId,
      providerMessageId: event.messageId ?? null,
      text: event.text ?? null,
      isEcho: event.isEcho,
      attachments: event.attachments ?? []
    },
    raw: event.raw
  }));

  const comments: CanonicalIngressEvent[] = normalizeInstagramCommentWebhook(payload).map((event) => ({
    providerEventId: event.providerEventId,
    accountId: event.accountId,
    occurredAt: event.occurredAt,
    eventType: "comment.received",
    payload: {
      commentId: event.commentId,
      mediaId: event.mediaId,
      text: event.text ?? null,
      commenterExternalId: event.commenterId ?? null,
      commenterUsername: event.commenterUsername ?? null
    },
    raw: event.raw
  }));

  return [...messages, ...comments];
}

async function resolveConnection(sql: DatabaseClient, accountId: string): Promise<ResolvedConnection | null> {
  const [row] = await sql<{
    id: string;
    workspace_id: string;
    auth_valid: boolean;
  }[]>`
    select id, workspace_id, auth_valid
    from app_private.channel_connections
    where provider_key = ${PROVIDER_KEY}
      and external_account_id = ${accountId}
    order by created_at asc
    limit 1
  `;

  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    authValid: row.auth_valid
  };
}

async function persistCanonicalEvent(
  sql: DatabaseClient,
  ingress: ClaimedIngress,
  connection: ResolvedConnection,
  event: CanonicalIngressEvent
): Promise<void> {
  const fingerprint = createHash("sha256").update(stableJson(event.raw)).digest("hex");

  await sql.begin(async (tx) => {
    const [insertedRaw] = await tx<{ id: string }[]>`
      insert into app_private.raw_events (
        workspace_id,
        connection_id,
        provider,
        provider_event_id,
        signature_valid,
        fingerprint,
        headers,
        payload,
        received_at,
        processing_state
      ) values (
        ${connection.workspaceId},
        ${connection.id},
        ${PROVIDER_KEY},
        ${event.providerEventId},
        true,
        ${fingerprint},
        ${tx.json(asJsonValue(ingress.headers))},
        ${tx.json(asJsonValue(event.raw))},
        ${ingress.firstReceivedAt},
        'VALIDATED'
      )
      on conflict (connection_id, provider_event_id) do nothing
      returning id
    `;

    let rawEventId: string;

    if (insertedRaw) {
      rawEventId = insertedRaw.id;
    } else {
      const [existing] = await tx<{ id: string; fingerprint: string | null }[]>`
        select id, fingerprint
        from app_private.raw_events
        where connection_id = ${connection.id}
          and provider_event_id = ${event.providerEventId}
        limit 1
      `;

      if (!existing) throw new Error("RAW_EVENT_CONFLICT_WITHOUT_ROW");
      if (existing.fingerprint !== fingerprint) throw new SuspiciousEventCollisionError();

      await recordWebhookEvidence(tx, connection, event.occurredAt);
      return;
    }

    const correlationId = randomUUID();
    const [canonical] = await tx<{ id: string }[]>`
      insert into app_private.canonical_events (
        raw_event_id,
        workspace_id,
        connection_id,
        event_type,
        channel,
        provider,
        provider_event_id,
        correlation_id,
        occurred_at,
        received_at,
        payload
      ) values (
        ${rawEventId},
        ${connection.workspaceId},
        ${connection.id},
        ${event.eventType},
        'instagram',
        ${PROVIDER_KEY},
        ${event.providerEventId},
        ${correlationId},
        ${event.occurredAt},
        ${ingress.firstReceivedAt},
        ${tx.json(asJsonValue(event.payload))}
      )
      returning id
    `;

    if (!canonical) throw new Error("CANONICAL_EVENT_INSERT_RETURNED_NO_ROW");

    await tx`
      insert into app_private.outbox_events (
        workspace_id,
        topic,
        aggregate_type,
        aggregate_id,
        payload
      ) values (
        ${connection.workspaceId},
        ${event.eventType},
        'canonical_event',
        ${canonical.id},
        ${tx.json(asJsonValue({
          canonicalEventId: canonical.id,
          eventType: event.eventType,
          connectionId: connection.id,
          correlationId
        }))}
      )
    `;

    await tx`
      update app_private.raw_events
      set processing_state = 'PROCESSED'
      where id = ${rawEventId}
    `;

    await recordWebhookEvidence(tx, connection, event.occurredAt);
  });
}

async function recordWebhookEvidence(
  tx: Parameters<Parameters<DatabaseClient["begin"]>[0]>[0],
  connection: ResolvedConnection,
  occurredAt: string
): Promise<void> {
  await tx`
    insert into app_private.connection_webhook_evidence (
      connection_id,
      last_verified_event_at,
      consecutive_valid_events,
      consecutive_invalid_events,
      updated_at
    ) values (
      ${connection.id},
      ${occurredAt},
      1,
      0,
      now()
    )
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

  // A valid webhook proves the webhook path, not the provider identity/token
  // probe. Never manufacture HEALTHY from webhook evidence alone.
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

async function markResolved(sql: DatabaseClient, ingressId: string, note: string | null): Promise<void> {
  await sql`
    update app_private.webhook_ingress_events
    set
      processing_state = 'RESOLVED',
      processed_at = now(),
      locked_at = null,
      locked_until = null,
      locked_by = null,
      last_error = ${note}
    where id = ${ingressId}
  `;
}

async function reschedule(
  sql: DatabaseClient,
  ingress: ClaimedIngress,
  state: "UNMATCHED" | "FAILED",
  error: string
): Promise<void> {
  if (ingress.attemptCount >= MAX_ATTEMPTS) {
    await markDead(sql, ingress.id, error);
    return;
  }

  const delaySeconds = Math.min(15 * 2 ** Math.max(0, ingress.attemptCount - 1), 1_800);
  await sql`
    update app_private.webhook_ingress_events
    set
      processing_state = ${state},
      available_at = now() + (${delaySeconds} * interval '1 second'),
      locked_at = null,
      locked_until = null,
      locked_by = null,
      last_error = ${error}
    where id = ${ingress.id}
  `;
}

async function markDead(sql: DatabaseClient, ingressId: string, error: string): Promise<void> {
  await sql`
    update app_private.webhook_ingress_events
    set
      processing_state = 'DEAD',
      processed_at = now(),
      locked_at = null,
      locked_until = null,
      locked_by = null,
      last_error = ${error}
    where id = ${ingressId}
  `;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortJson((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function asJsonValue(value: unknown): never {
  return value as never;
}

function readPositiveInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error("Ingress worker terminated", error);
  process.exitCode = 1;
});
