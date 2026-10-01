import { can, type WorkspaceRole } from "@automation/core";
import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import {
  buildInstagramHostPassChallenge,
  INSTAGRAM_HOST_PASS_REPLY_TEXT
} from "@/lib/server/instagram-host-pass";
import { queueInstagramTextReply } from "@/lib/server/instagram-messaging";
import { isTrustedMutationRequest } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER_KEY = "instagram.meta.official";

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedMutationRequest(request, process.env.APP_ORIGIN)) {
    return Response.json(
      { error: "cross_origin_request_forbidden" },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }

  const { userId, membership } = await requireWorkspaceContext();
  const role = membership.role as WorkspaceRole;
  if (!can(role, "connections.manage") || !can(role, "conversation.reply")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sql = getDatabase();
  const challenge = buildInstagramHostPassChallenge(membership.workspaceId);
  const [event] = await sql<{
    id: string;
    connection_id: string;
    recipient_external_id: string;
  }[]>`
    select
      event.id,
      event.connection_id,
      event.payload ->> 'senderExternalId' as recipient_external_id
    from app_private.canonical_events event
    join app_private.channel_connections connection
      on connection.id = event.connection_id
    where event.workspace_id = ${membership.workspaceId}
      and event.provider = ${PROVIDER_KEY}
      and event.event_type = 'message.received'
      and event.payload ->> 'text' = ${challenge}
      and nullif(event.payload ->> 'senderExternalId', '') is not null
      and connection.provider_mode = 'official'
      and connection.auth_valid = true
    order by event.occurred_at desc
    limit 1
  `;

  if (!event) return redirect(request.url, "challenge_not_seen");

  const result = await queueInstagramTextReply({
    sql,
    workspaceId: membership.workspaceId,
    actorUserId: userId,
    connectionId: event.connection_id,
    recipientExternalId: event.recipient_external_id,
    text: INSTAGRAM_HOST_PASS_REPLY_TEXT,
    idempotencyKey: `g3-host-pass:${event.id}`
  });

  if (result.kind === "queued") return redirect(request.url, "reply_queued");
  if (result.kind === "duplicate") return redirect(request.url, "reply_already_queued");
  if (result.kind === "connection_auth_invalid") return redirect(request.url, "auth_invalid");
  if (result.kind === "recipient_not_observed") return redirect(request.url, "recipient_not_observed");
  return redirect(request.url, "connection_not_found");
}

function redirect(requestUrl: string, status: string): NextResponse {
  const target = new URL("/connections/instagram/readiness", new URL(requestUrl).origin);
  target.searchParams.set("hostpass", status);
  return NextResponse.redirect(target, { status: 303 });
}
