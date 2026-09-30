import "server-only";
import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@automation/storage-postgres";
import { PostgresMessageStore, type StoredOutboundMessage } from "@automation/storage-postgres/messages";

const PROVIDER_KEY = "instagram.meta.official";

export type QueueInstagramReplyResult =
  | { kind: "queued"; message: StoredOutboundMessage }
  | { kind: "duplicate"; message: StoredOutboundMessage }
  | { kind: "idempotency_mismatch"; message: StoredOutboundMessage }
  | { kind: "connection_not_found" }
  | { kind: "connection_auth_invalid"; healthState: string }
  | { kind: "recipient_not_observed" };

export async function queueInstagramTextReply(input: {
  sql: DatabaseClient;
  workspaceId: string;
  actorUserId: string;
  connectionId: string;
  recipientExternalId: string;
  text: string;
  idempotencyKey: string;
}): Promise<QueueInstagramReplyResult> {
  const [connection] = await input.sql<{
    id: string;
    auth_valid: boolean;
    health_state: string;
  }[]>`
    select id, auth_valid, health_state
    from app_private.channel_connections
    where id = ${input.connectionId}
      and workspace_id = ${input.workspaceId}
      and channel = 'instagram'
      and provider_key = ${PROVIDER_KEY}
      and provider_mode = 'official'
    limit 1
  `;

  if (!connection) return { kind: "connection_not_found" };
  if (!connection.auth_valid) {
    return { kind: "connection_auth_invalid", healthState: connection.health_state };
  }

  // A text reply may only target an identity that actually initiated a verified
  // inbound conversation on this exact connection. This keeps the internal API
  // aligned with the official conversation capability instead of becoming an
  // arbitrary/cold-DM relay.
  const [observed] = await input.sql<{ id: string }[]>`
    select id
    from app_private.canonical_events
    where workspace_id = ${input.workspaceId}
      and connection_id = ${connection.id}
      and provider = ${PROVIDER_KEY}
      and event_type = 'message.received'
      and payload ->> 'senderExternalId' = ${input.recipientExternalId}
    order by occurred_at desc
    limit 1
  `;

  if (!observed) return { kind: "recipient_not_observed" };

  const store = new PostgresMessageStore(input.sql);
  const correlationId = randomUUID();
  const creation = await store.createOutbound({
    workspaceId: input.workspaceId,
    connectionId: connection.id,
    idempotencyKey: input.idempotencyKey,
    correlationId,
    payload: {
      channel: "instagram",
      recipientExternalId: input.recipientExternalId,
      text: input.text
    }
  });

  if (creation.conflictKind === "idempotency_mismatch") {
    return { kind: "idempotency_mismatch", message: creation.message };
  }

  if (creation.created) {
    await input.sql`
      insert into app_private.audit_logs (
        workspace_id,
        actor_user_id,
        action,
        resource_type,
        resource_id,
        correlation_id,
        metadata
      ) values (
        ${input.workspaceId},
        ${input.actorUserId},
        'instagram.message.queued',
        'message',
        ${creation.message.id},
        ${creation.message.correlationId},
        ${input.sql.json({ provider: PROVIDER_KEY, mode: "official", recipientObserved: true })}
      )
    `;
  }

  return {
    kind: creation.created ? "queued" : "duplicate",
    message: creation.message
  };
}
