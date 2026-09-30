import { randomUUID } from "node:crypto";
import { can, type WorkspaceRole } from "@automation/core";
import { PostgresMessageStore } from "@automation/storage-postgres/messages";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CommentAction = "PUBLIC_REPLY" | "PRIVATE_REPLY";

const MESSAGE_TYPES: Record<CommentAction, string> = {
  PUBLIC_REPLY: "instagram_comment_public_reply",
  PRIVATE_REPLY: "instagram_comment_private_reply"
};

export async function POST(request: Request): Promise<Response> {
  const { userId, membership } = await requireWorkspaceContext();
  if (!can(membership.role as WorkspaceRole, "conversation.reply")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return Response.json({ error: "valid_x_idempotency_key_required" }, { status: 400 });
  }

  let input: CommentActionBody;
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

  const [observed] = await database<{ id: string }[]>`
    select id
    from app_private.canonical_events
    where workspace_id = ${membership.workspaceId}
      and connection_id = ${connection.id}
      and event_type = 'comment.received'
      and payload ->> 'commentId' = ${input.commentId}
    order by occurred_at desc
    limit 1
  `;

  if (!observed) {
    return Response.json({ error: "comment_not_observed_by_verified_webhook" }, { status: 404 });
  }

  const messageType = MESSAGE_TYPES[input.action];
  const correlationId = randomUUID();
  const store = new PostgresMessageStore(database);
  const creation = await store.createOutbound({
    workspaceId: membership.workspaceId,
    connectionId: connection.id,
    idempotencyKey,
    correlationId,
    messageType,
    ...(input.action === "PRIVATE_REPLY" ? { dedupeResourceKey: input.commentId } : {}),
    payload: {
      channel: "instagram",
      commentId: input.commentId,
      text: input.text,
      action: input.action
    }
  });

  if (!creation.created && creation.conflictKind === "resource_claim") {
    return Response.json(
      {
        error: "comment_private_reply_already_claimed",
        duplicateRequest: false,
        message: presentMessage(creation.message)
      },
      { status: 409 }
    );
  }

  if (creation.created) {
    await database`
      insert into app_private.audit_logs (
        workspace_id,
        actor_user_id,
        action,
        resource_type,
        resource_id,
        correlation_id,
        metadata
      ) values (
        ${membership.workspaceId},
        ${userId},
        ${input.action === "PRIVATE_REPLY" ? "instagram.comment.private_reply.queued" : "instagram.comment.public_reply.queued"},
        'message',
        ${creation.message.id},
        ${creation.message.correlationId},
        ${database.json({ provider: "instagram.meta.official", mode: "official", action: input.action })}
      )
    `;
  }

  return Response.json(
    {
      duplicateRequest: !creation.created,
      queued: creation.created,
      action: input.action,
      message: presentMessage(creation.message)
    },
    { status: creation.created ? 202 : 200 }
  );
}

interface CommentActionBody {
  connectionId: string;
  commentId: string;
  action: CommentAction;
  text: string;
}

function parseBody(value: unknown): CommentActionBody {
  if (!isRecord(value)) throw new Error("invalid_json_body");

  const connectionId = stringField(value.connectionId, "connection_id_required", 1, 100);
  const commentId = stringField(value.commentId, "comment_id_required", 1, 300);
  const text = stringField(value.text, "text_required", 1, 1_000);
  const action = value.action;

  if (action !== "PUBLIC_REPLY" && action !== "PRIVATE_REPLY") {
    throw new Error("invalid_comment_action");
  }

  return { connectionId, commentId, action, text };
}

function stringField(value: unknown, error: string, min: number, max: number): string {
  if (typeof value !== "string") throw new Error(error);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error(error);
  return normalized;
}

function presentMessage(message: {
  id: string;
  messageType: string;
  deliveryState: string;
  providerMessageId: string | null;
  correlationId: string;
  reconciliationRequired: boolean;
  lastErrorCode: string | null;
}) {
  return {
    id: message.id,
    type: message.messageType,
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
