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

export interface StoredOutboundMessage {
  id: string;
  workspaceId: string;
  connectionId: string;
  providerMessageId: string | null;
  idempotencyKey: string;
  correlationId: string;
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
  }): Promise<{ message: StoredOutboundMessage; created: boolean }> {
    const [created] = await this.sql<MessageRow[]>`
      insert into app_private.messages (
        workspace_id,
        connection_id,
        idempotency_key,
        correlation_id,
        direction,
        message_type,
        delivery_state,
        reconciliation_required,
        payload
      ) values (
        ${input.workspaceId},
        ${input.connectionId},
        ${input.idempotencyKey},
        ${input.correlationId},
        'outbound',
        'text',
        'CREATED',
        false,
        ${this.sql.json(asJsonValue(input.payload))}
      )
      on conflict (connection_id, idempotency_key) do nothing
      returning ${messageColumns(this.sql)}
    `;

    if (created) return { message: mapMessage(created), created: true };

    const existing = await this.getByIdempotencyKey(input.connectionId, input.idempotencyKey);
    if (!existing) throw new Error("MESSAGE_IDEMPOTENCY_CONFLICT_WITHOUT_ROW");
    return { message: existing, created: false };
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
      returning ${messageColumns(this.sql)}
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
      returning ${messageColumns(this.sql)}
    `;

    if (!row) throw new Error("MESSAGE_NOT_FOUND");
    return mapMessage(row);
  }

  async getByIdempotencyKey(connectionId: string, idempotencyKey: string): Promise<StoredOutboundMessage | null> {
    const [row] = await this.sql<MessageRow[]>`
      select ${messageColumns(this.sql)}
      from app_private.messages
      where connection_id = ${connectionId}
        and idempotency_key = ${idempotencyKey}
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
  delivery_state: StoredDeliveryState;
  reconciliation_required: boolean;
  last_provider_timestamp: string | null;
  last_error_code: string | null;
  payload: unknown;
}

function messageColumns(sql: DatabaseClient): ReturnType<DatabaseClient> {
  return sql`
    id,
    workspace_id,
    connection_id,
    provider_message_id,
    idempotency_key,
    correlation_id,
    delivery_state,
    reconciliation_required,
    last_provider_timestamp,
    last_error_code,
    payload
  `;
}

function mapMessage(row: MessageRow): StoredOutboundMessage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    connectionId: row.connection_id,
    providerMessageId: row.provider_message_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    deliveryState: row.delivery_state,
    reconciliationRequired: row.reconciliation_required,
    lastProviderTimestamp: row.last_provider_timestamp,
    lastErrorCode: row.last_error_code,
    payload: row.payload
  };
}

function asJsonValue(value: unknown): never {
  return value as never;
}
