import type { DatabaseClient } from "./index";

export type StoredDeliveryState =
  | "CREATED"
  | "QUEUED"
  | "PROCESSING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "RETRYING"
  | "DEAD"
  | "SEND_RESULT_UNKNOWN";

export type OutboundConflictKind = "idempotency" | "idempotency_mismatch" | "resource_claim";

export interface StoredOutboundMessage {
  id: string;
  workspaceId: string;
  connectionId: string;
  providerMessageId: string | null;
  idempotencyKey: string;
  correlationId: string;
  messageType: string;
  dedupeResourceKey: string | null;
  deliveryState: StoredDeliveryState;
  reconciliationRequired: boolean;
  lastProviderTimestamp: string | null;
  lastErrorCode: string | null;
  payload: unknown;
}

export class PostgresMessageStore {
  constructor(private readonly sql: DatabaseClient) {}

  async createOutbound(input: {
    workspaceId: string;
    connectionId: string;
    idempotencyKey: string;
    correlationId: string;
    payload: unknown;
    messageType?: string;
    dedupeResourceKey?: string;
  }): Promise<{ message: StoredOutboundMessage; created: boolean; conflictKind?: OutboundConflictKind }> {
    const messageType = input.messageType ?? "text";
    const dedupeResourceKey = input.dedupeResourceKey ?? null;

    const [created] = await this.sql<MessageRow[]>`
      insert into app_private.messages (
        workspace_id,
        connection_id,
        idempotency_key,
        correlation_id,
        direction,
        message_type,
        dedupe_resource_key,
        delivery_state,
        reconciliation_required,
        payload
      ) values (
        ${input.workspaceId},
        ${input.connectionId},
        ${input.idempotencyKey},
        ${input.correlationId},
        'outbound',
        ${messageType},
        ${dedupeResourceKey},
        'QUEUED',
        false,
        ${this.sql.json(asJsonValue(input.payload))}
      )
      on conflict do nothing
      returning
        id,
        workspace_id,
        connection_id,
        provider_message_id,
        idempotency_key,
        correlation_id,
        message_type,
        dedupe_resource_key,
        delivery_state,
        reconciliation_required,
        last_provider_timestamp,
        last_error_code,
        payload
    `;

    if (created) return { message: mapMessage(created), created: true };

    const byIdempotency = await this.getByIdempotencyKey(input.connectionId, input.idempotencyKey);
    if (byIdempotency) {
      const sameIntent = byIdempotency.messageType === messageType
        && byIdempotency.dedupeResourceKey === dedupeResourceKey
        && stableJson(byIdempotency.payload) === stableJson(input.payload);

      return {
        message: byIdempotency,
        created: false,
        conflictKind: sameIntent ? "idempotency" : "idempotency_mismatch"
      };
    }

    if (dedupeResourceKey) {
      const byClaim = await this.getByResourceClaim(input.connectionId, messageType, dedupeResourceKey);
      if (byClaim) return { message: byClaim, created: false, conflictKind: "resource_claim" };
    }

    throw new Error("MESSAGE_CONFLICT_WITHOUT_RESOLVABLE_ROW");
  }

  async markProcessing(messageId: string): Promise<StoredOutboundMessage> {
    const [row] = await this.sql<MessageRow[]>`
      update app_private.messages
      set
        delivery_state = 'PROCESSING',
        reconciliation_required = false,
        updated_at = now()
      where id = ${messageId}
        and delivery_state in ('CREATED','QUEUED','RETRYING')
      returning
        id,
        workspace_id,
        connection_id,
        provider_message_id,
        idempotency_key,
        correlation_id,
        message_type,
        dedupe_resource_key,
        delivery_state,
        reconciliation_required,
        last_provider_timestamp,
        last_error_code,
        payload
    `;

    if (!row) throw new Error("MESSAGE_NOT_SENDABLE");
    return mapMessage(row);
  }

  async applyProviderOutcome(input: {
    messageId: string;
    deliveryState: StoredDeliveryState;
    providerMessageId?: string;
    providerTimestamp?: string;
    errorCode?: string;
    reconciliationRequired: boolean;
  }): Promise<StoredOutboundMessage> {
    const [row] = await this.sql<MessageRow[]>`
      update app_private.messages
      set
        delivery_state = ${input.deliveryState},
        provider_message_id = coalesce(${input.providerMessageId ?? null}, provider_message_id),
        last_provider_timestamp = coalesce(${input.providerTimestamp ?? null}, last_provider_timestamp),
        last_error_code = ${input.errorCode ?? null},
        reconciliation_required = ${input.reconciliationRequired},
        updated_at = now()
      where id = ${input.messageId}
      returning
        id,
        workspace_id,
        connection_id,
        provider_message_id,
        idempotency_key,
        correlation_id,
        message_type,
        dedupe_resource_key,
        delivery_state,
        reconciliation_required,
        last_provider_timestamp,
        last_error_code,
        payload
    `;

    if (!row) throw new Error("MESSAGE_NOT_FOUND");
    return mapMessage(row);
  }

  async getByIdempotencyKey(connectionId: string, idempotencyKey: string): Promise<StoredOutboundMessage | null> {
    const [row] = await this.sql<MessageRow[]>`
      select
        id,
        workspace_id,
        connection_id,
        provider_message_id,
        idempotency_key,
        correlation_id,
        message_type,
        dedupe_resource_key,
        delivery_state,
        reconciliation_required,
        last_provider_timestamp,
        last_error_code,
        payload
      from app_private.messages
      where connection_id = ${connectionId}
        and idempotency_key = ${idempotencyKey}
      limit 1
    `;

    return row ? mapMessage(row) : null;
  }

  async getByResourceClaim(
    connectionId: string,
    messageType: string,
    dedupeResourceKey: string
  ): Promise<StoredOutboundMessage | null> {
    const [row] = await this.sql<MessageRow[]>`
      select
        id,
        workspace_id,
        connection_id,
        provider_message_id,
        idempotency_key,
        correlation_id,
        message_type,
        dedupe_resource_key,
        delivery_state,
        reconciliation_required,
        last_provider_timestamp,
        last_error_code,
        payload
      from app_private.messages
      where connection_id = ${connectionId}
        and message_type = ${messageType}
        and dedupe_resource_key = ${dedupeResourceKey}
      limit 1
    `;

    return row ? mapMessage(row) : null;
  }
}

interface MessageRow {
  id: string;
  workspace_id: string;
  connection_id: string;
  provider_message_id: string | null;
  idempotency_key: string;
  correlation_id: string;
  message_type: string;
  dedupe_resource_key: string | null;
  delivery_state: StoredDeliveryState;
  reconciliation_required: boolean;
  last_provider_timestamp: string | null;
  last_error_code: string | null;
  payload: unknown;
}

function mapMessage(row: MessageRow): StoredOutboundMessage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    connectionId: row.connection_id,
    providerMessageId: row.provider_message_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    messageType: row.message_type,
    dedupeResourceKey: row.dedupe_resource_key,
    deliveryState: row.delivery_state,
    reconciliationRequired: row.reconciliation_required,
    lastProviderTimestamp: row.last_provider_timestamp,
    lastErrorCode: row.last_error_code,
    payload: row.payload
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) sorted[key] = sortJson(child);
  }
  return sorted;
}

function asJsonValue(value: unknown): never {
  return value as never;
}
