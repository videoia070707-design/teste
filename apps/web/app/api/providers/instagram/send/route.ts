import { randomUUID } from "node:crypto";
import { can, type WorkspaceRole } from "@automation/core";
import { PostgresMessageStore } from "@automation/storage-postgres/messages";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const { membership } = await requireWorkspaceContext();
  if (!can(membership.role as WorkspaceRole, "conversation.reply")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return Response.json({ error: "valid_x_idempotency_key_required" }, { status: 400 });
  }

  let input: SendBody;
  try {
    input = parseBody(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid_request" },
      { status: 400 }
    );
  }

  const database = getDatabase();
  const [connection] = await database<{
    id: string;
    auth_valid: boolean;
    health_state: string;
  }[]>`
    select id, auth_valid, health_state
    from app_private.channel_connections
    where id = ${input.connectionId}
      and workspace_id = ${membership.workspaceId}
      and channel = 'instagram'
      and provider_key = 'instagram.meta.official'
      and provider_mode = 'official'
    limit 1
  `;

  if (!connection) return Response.json({ error: "connection_not_found" }, { status: 404 });
  if (!connection.auth_valid) {
    return Response.json({ error: "connection_auth_invalid", healthState: connection.health_state }, { status: 409 });
  }

  const correlationId = randomUUID();
  const store = new PostgresMessageStore(database);
  const creation = await store.createOutbound({
    workspaceId: membership.workspaceId,
    connectionId: connection.id,
    idempotencyKey,
    correlationId,
    payload: {
      channel: "instagram",
      recipientExternalId: input.recipientExternalId,
      text: input.text
    }
  });

  return Response.json(
    {
      duplicateRequest: !creation.created,
      queued: creation.created,
      message: presentMessage(creation.message)
    },
    { status: creation.created ? 202 : 200 }
  );
}

interface SendBody {
  connectionId: string;
  recipientExternalId: string;
  text: string;
}

function parseBody(value: unknown): SendBody {
  if (!isRecord(value)) throw new Error("invalid_json_body");

  const connectionId = stringField(value.connectionId, "connection_id_required", 1, 100);
  const recipientExternalId = stringField(value.recipientExternalId, "recipient_external_id_required", 1, 200);
  const text = stringField(value.text, "text_required", 1, 1_000);

  return { connectionId, recipientExternalId, text };
}

function stringField(value: unknown, error: string, min: number, max: number): string {
  if (typeof value !== "string") throw new Error(error);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error(error);
  return normalized;
}

function presentMessage(message: {
  id: string;
  deliveryState: string;
  providerMessageId: string | null;
  correlationId: string;
  reconciliationRequired: boolean;
  lastErrorCode: string | null;
}) {
  return {
    id: message.id,
    state: message.deliveryState,
    providerMessageId: message.providerMessageId,
    correlationId: message.correlationId,
    reconciliationRequired: message.reconciliationRequired,
    lastErrorCode: message.lastErrorCode
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
