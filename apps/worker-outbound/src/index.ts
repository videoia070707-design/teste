import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { ConnectionId } from "@automation/core";
import {
  InstagramOfficialProvider,
  type InstagramCredentialResolver,
  type InstagramCredentials
} from "@automation/provider-instagram-official";
import { applyProviderSendResult, type MessageDeliverySnapshot } from "@automation/reliability";
import { AesGcmSecretCipher, StaticSecretKeyring } from "@automation/secrets";
import { createDatabaseClient, type DatabaseClient } from "@automation/storage-postgres";
import { PostgresEncryptedSecretVault } from "@automation/storage-postgres/secrets";
import { EXPIRED_PROCESSING_RECOVERY, retryDelayForClaimedAttempt } from "./policy";

const PROVIDER_KEY = "instagram.meta.official";
const SECRET_PURPOSE = "instagram.credentials";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_POLL_MS = 750;
const DEFAULT_LEASE_SECONDS = 45;

interface ClaimedMessage {
  id: string;
  workspaceId: string;
  connectionId: string;
  idempotencyKey: string;
  correlationId: string;
  attemptCount: number;
  payload: unknown;
}

interface OutboundPayload {
  channel: "instagram";
  recipientExternalId: string;
  text: string;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const batchSize = readPositiveInt("OUTBOUND_WORKER_BATCH_SIZE", DEFAULT_BATCH_SIZE, 1, 100);
  const pollMs = readPositiveInt("OUTBOUND_WORKER_POLL_MS", DEFAULT_POLL_MS, 100, 60_000);
  const leaseSeconds = readPositiveInt("OUTBOUND_WORKER_LEASE_SECONDS", DEFAULT_LEASE_SECONDS, 10, 600);
  const workerId = process.env.OUTBOUND_WORKER_ID?.trim() || `${hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
  const sql = createDatabaseClient(databaseUrl);
  const provider = createInstagramProvider(sql);

  let stopping = false;
  const stop = () => {
    stopping = true;
  };

  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  try {
    while (!stopping) {
      await quarantineExpiredProcessing(sql);
      const batch = await claimBatch(sql, workerId, batchSize, leaseSeconds);

      if (batch.length === 0) {
        await sleep(pollMs);
        continue;
      }

      for (const message of batch) {
        if (stopping) break;
        await processMessage(sql, provider, message);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function quarantineExpiredProcessing(sql: DatabaseClient): Promise<void> {
  await sql`
    update app_private.messages
    set
      delivery_state = ${EXPIRED_PROCESSING_RECOVERY.deliveryState},
      reconciliation_required = ${EXPIRED_PROCESSING_RECOVERY.reconciliationRequired},
      last_error_code = ${EXPIRED_PROCESSING_RECOVERY.errorCode},
      locked_at = null,
      locked_until = null,
      locked_by = null,
      updated_at = now()
    where direction = 'outbound'
      and delivery_state = 'PROCESSING'
      and locked_until is not null
      and locked_until <= now()
  `;
}

async function claimBatch(
  sql: DatabaseClient,
  workerId: string,
  limit: number,
  leaseSeconds: number
): Promise<ClaimedMessage[]> {
  const rows = await sql<{
    id: string;
    workspace_id: string;
    connection_id: string;
    idempotency_key: string;
    correlation_id: string;
    attempt_count: number;
    payload: unknown;
  }[]>`
    with candidates as (
      select id
      from app_private.messages
      where direction = 'outbound'
        and delivery_state in ('QUEUED','RETRYING')
        and available_at <= now()
      order by available_at asc, created_at asc
      for update skip locked
      limit ${limit}
    )
    update app_private.messages message
    set
      delivery_state = 'PROCESSING',
      attempt_count = message.attempt_count + 1,
      locked_at = now(),
      locked_until = now() + (${leaseSeconds} * interval '1 second'),
      locked_by = ${workerId},
      updated_at = now()
    from candidates
    where message.id = candidates.id
    returning
      message.id,
      message.workspace_id,
      message.connection_id,
      message.idempotency_key,
      message.correlation_id,
      message.attempt_count,
      message.payload
  `;

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    connectionId: row.connection_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    attemptCount: row.attempt_count,
    payload: row.payload
  }));
}

async function processMessage(
  sql: DatabaseClient,
  provider: InstagramOfficialProvider,
  message: ClaimedMessage
): Promise<void> {
  let payload: OutboundPayload;
  try {
    payload = parseOutboundPayload(message.payload);
  } catch (error) {
    await finishDefinitiveFailure(
      sql,
      message.id,
      error instanceof Error ? error.message : "INVALID_OUTBOUND_PAYLOAD"
    );
    return;
  }

  let providerResult;
  try {
    providerResult = await provider.sendText({
      connectionId: message.connectionId as ConnectionId,
      recipientExternalId: payload.recipientExternalId,
      text: payload.text,
      idempotencyKey: message.idempotencyKey,
      correlationId: message.correlationId
    });
  } catch (error) {
    // The provider adapter only throws for failures before it can safely report
    // a transport outcome (for example credential decryption/configuration).
    await finishDefinitiveFailure(
      sql,
      message.id,
      error instanceof Error ? error.message : "PROVIDER_PRE_DISPATCH_FAILURE"
    );
    return;
  }

  const snapshot = applyProviderSendResult(
    { state: "PROCESSING", reconciliationRequired: false },
    providerResult
  );

  try {
    if (snapshot.state === "RETRYING") {
      const delay = retryDelayForClaimedAttempt(message.attemptCount);
      if (delay === null) {
        await finishDead(sql, message.id, snapshot.lastErrorCode ?? "RETRY_LIMIT_EXHAUSTED");
        return;
      }

      await scheduleRetry(
        sql,
        message.id,
        delay,
        snapshot.lastErrorCode ?? "PROVIDER_RETRYABLE_REJECTION"
      );
      return;
    }

    await persistSnapshot(sql, message.id, snapshot);
  } catch (error) {
    // The provider call already happened. We deliberately keep PROCESSING and
    // the lease intact. Expiry converts the message to SEND_RESULT_UNKNOWN,
    // preventing an unsafe duplicate retry after a post-dispatch DB failure.
    console.error("Failed to persist outbound provider outcome; preserving PROCESSING lease", {
      messageId: message.id,
      correlationId: message.correlationId,
      providerState: snapshot.state,
      error: error instanceof Error ? error.message : "UNKNOWN_PERSISTENCE_FAILURE"
    });
  }
}

async function persistSnapshot(
  sql: DatabaseClient,
  messageId: string,
  snapshot: MessageDeliverySnapshot
): Promise<void> {
  await sql`
    update app_private.messages
    set
      delivery_state = ${snapshot.state},
      provider_message_id = coalesce(${snapshot.providerMessageId ?? null}, provider_message_id),
      last_provider_timestamp = coalesce(${snapshot.lastProviderTimestamp ?? null}, last_provider_timestamp),
      last_error_code = ${snapshot.lastErrorCode ?? null},
      reconciliation_required = ${snapshot.reconciliationRequired},
      locked_at = null,
      locked_until = null,
      locked_by = null,
      updated_at = now()
    where id = ${messageId}
  `;
}

async function scheduleRetry(
  sql: DatabaseClient,
  messageId: string,
  delaySeconds: number,
  errorCode: string
): Promise<void> {
  await sql`
    update app_private.messages
    set
      delivery_state = 'RETRYING',
      reconciliation_required = false,
      last_error_code = ${errorCode},
      available_at = now() + (${delaySeconds} * interval '1 second'),
      locked_at = null,
      locked_until = null,
      locked_by = null,
      updated_at = now()
    where id = ${messageId}
  `;
}

async function finishDefinitiveFailure(sql: DatabaseClient, messageId: string, errorCode: string): Promise<void> {
  await sql`
    update app_private.messages
    set
      delivery_state = 'FAILED',
      reconciliation_required = false,
      last_error_code = ${truncate(errorCode, 500)},
      locked_at = null,
      locked_until = null,
      locked_by = null,
      updated_at = now()
    where id = ${messageId}
  `;
}

async function finishDead(sql: DatabaseClient, messageId: string, errorCode: string): Promise<void> {
  await sql`
    update app_private.messages
    set
      delivery_state = 'DEAD',
      reconciliation_required = false,
      last_error_code = ${truncate(errorCode, 500)},
      locked_at = null,
      locked_until = null,
      locked_by = null,
      updated_at = now()
    where id = ${messageId}
  `;
}

function createInstagramProvider(sql: DatabaseClient): InstagramOfficialProvider {
  const graphBaseUrl = requireUrl("INSTAGRAM_GRAPH_BASE_URL").toString();
  const apiVersion = requireEnv("INSTAGRAM_GRAPH_API_VERSION");
  const vault = createSecretVault(sql);
  const resolver: InstagramCredentialResolver = {
    resolve: async (connectionId) => resolveInstagramCredential(sql, vault, connectionId)
  };

  return new InstagramOfficialProvider(
    {
      graphBaseUrl,
      apiVersion
    },
    resolver
  );
}

function createSecretVault(sql: DatabaseClient): PostgresEncryptedSecretVault {
  const currentVersion = requireEnv("PROVIDER_SECRET_CURRENT_KEY_VERSION");
  const serializedKeys = requireEnv("PROVIDER_SECRET_KEYS_JSON");

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedKeys) as unknown;
  } catch {
    throw new Error("PROVIDER_SECRET_KEYS_JSON must be valid JSON.");
  }

  if (!isStringRecord(parsed) || Object.keys(parsed).length === 0) {
    throw new Error("PROVIDER_SECRET_KEYS_JSON must map key versions to base64 keys.");
  }

  const keyring = new StaticSecretKeyring(
    currentVersion,
    Object.entries(parsed).map(([version, keyBase64]) => ({ version, keyBase64 }))
  );

  return new PostgresEncryptedSecretVault(sql, new AesGcmSecretCipher(keyring));
}

async function resolveInstagramCredential(
  sql: DatabaseClient,
  vault: PostgresEncryptedSecretVault,
  connectionId: ConnectionId
): Promise<InstagramCredentials | null> {
  const [connection] = await sql<{
    workspace_id: string;
    external_account_id: string | null;
    auth_valid: boolean;
  }[]>`
    select workspace_id, external_account_id, auth_valid
    from app_private.channel_connections
    where id = ${connectionId}
      and provider_key = ${PROVIDER_KEY}
      and channel = 'instagram'
    limit 1
  `;

  if (!connection?.auth_valid || !connection.external_account_id) return null;

  const reference = await vault.getConnectionReference(connectionId);
  if (!reference) return null;

  const plaintext = await vault.get({
    workspaceId: connection.workspace_id,
    purpose: SECRET_PURPOSE,
    ref: reference.ref
  });
  const credential = parseStoredCredential(plaintext);

  if (credential.igUserId !== connection.external_account_id) {
    throw new Error("INSTAGRAM_CREDENTIAL_IDENTITY_MISMATCH");
  }
  if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now()) return null;

  return {
    accessToken: credential.accessToken,
    igUserId: credential.igUserId
  };
}

function parseStoredCredential(value: string): {
  accessToken: string;
  igUserId: string;
  expiresAt: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("INSTAGRAM_CREDENTIAL_INVALID_JSON");
  }

  if (!isRecord(parsed)) throw new Error("INSTAGRAM_CREDENTIAL_INVALID");
  if (parsed.schemaVersion !== 1) throw new Error("INSTAGRAM_CREDENTIAL_UNSUPPORTED_VERSION");
  if (typeof parsed.accessToken !== "string" || !parsed.accessToken) throw new Error("INSTAGRAM_CREDENTIAL_TOKEN_MISSING");
  if (typeof parsed.igUserId !== "string" || !parsed.igUserId) throw new Error("INSTAGRAM_CREDENTIAL_USER_MISSING");
  if (parsed.expiresAt !== null && typeof parsed.expiresAt !== "string") throw new Error("INSTAGRAM_CREDENTIAL_EXPIRY_INVALID");

  return {
    accessToken: parsed.accessToken,
    igUserId: parsed.igUserId,
    expiresAt: parsed.expiresAt
  };
}

function parseOutboundPayload(value: unknown): OutboundPayload {
  if (!isRecord(value)) throw new Error("INVALID_OUTBOUND_PAYLOAD");
  if (value.channel !== "instagram") throw new Error("UNSUPPORTED_OUTBOUND_CHANNEL");
  if (typeof value.recipientExternalId !== "string" || !value.recipientExternalId) {
    throw new Error("RECIPIENT_EXTERNAL_ID_MISSING");
  }
  if (typeof value.text !== "string" || !value.text) throw new Error("OUTBOUND_TEXT_MISSING");

  return {
    channel: "instagram",
    recipientExternalId: value.recipientExternalId,
    text: value.text
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requireUrl(name: string): URL {
  return new URL(requireEnv(name));
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

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error("Outbound worker terminated", error);
  process.exitCode = 1;
});
