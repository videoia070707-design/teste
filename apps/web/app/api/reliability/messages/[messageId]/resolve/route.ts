import { can, type WorkspaceRole } from "@automation/core";
import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { isTrustedMutationRequest } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResolutionAction = "CONFIRM_SENT" | "CONFIRM_FAILED";

export async function POST(
  request: Request,
  context: { params: Promise<{ messageId: string }> }
): Promise<Response> {
  if (!isTrustedMutationRequest(request, process.env.APP_ORIGIN)) {
    return Response.json(
      { error: "cross_origin_request_forbidden" },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }

  const { userId, membership } = await requireWorkspaceContext();
  if (!can(membership.role as WorkspaceRole, "reliability.resolve")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { messageId } = await context.params;
  if (!messageId) return Response.json({ error: "message_id_required" }, { status: 400 });

  const form = await request.formData();
  const action = normalizeAction(form.get("action"));
  const evidenceNote = normalizeEvidence(form.get("evidenceNote"));
  const providerMessageId = normalizeOptionalString(form.get("providerMessageId"), 300);

  if (!action) return Response.json({ error: "invalid_resolution_action" }, { status: 400 });
  if (!evidenceNote) {
    return Response.json(
      { error: "evidence_note_required", minimumLength: 12 },
      { status: 400 }
    );
  }

  const sql = getDatabase();
  const result = await sql.begin(async (tx) => {
    const [message] = await tx<{
      id: string;
      correlation_id: string;
      delivery_state: string;
      provider_message_id: string | null;
    }[]>`
      select id, correlation_id, delivery_state, provider_message_id
      from app_private.messages
      where id = ${messageId}
        and workspace_id = ${membership.workspaceId}
        and direction = 'outbound'
      for update
    `;

    if (!message) return { kind: "not_found" as const };
    if (message.delivery_state !== "SEND_RESULT_UNKNOWN") {
      return { kind: "not_unknown" as const, state: message.delivery_state };
    }

    const nextState = action === "CONFIRM_SENT" ? "SENT" : "FAILED";
    const [updated] = await tx<{
      id: string;
      delivery_state: string;
      provider_message_id: string | null;
      reconciliation_required: boolean;
    }[]>`
      update app_private.messages
      set
        delivery_state = ${nextState},
        provider_message_id = case
          when ${providerMessageId} is not null then ${providerMessageId}
          else provider_message_id
        end,
        reconciliation_required = false,
        last_error_code = null,
        updated_at = now()
      where id = ${message.id}
        and delivery_state = 'SEND_RESULT_UNKNOWN'
      returning id, delivery_state, provider_message_id, reconciliation_required
    `;

    if (!updated) throw new Error("RECONCILIATION_UPDATE_LOST_LOCK");

    await tx`
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
        'message.reconciliation.resolved',
        'message',
        ${message.id},
        ${message.correlation_id},
        ${tx.json(asJsonValue({
          resolution: action,
          previousState: "SEND_RESULT_UNKNOWN",
          nextState,
          evidenceNote,
          providerMessageId: providerMessageId ?? message.provider_message_id,
          automaticRetryPerformed: false
        }))}
      )
    `;

    return { kind: "resolved" as const, state: updated.delivery_state };
  });

  if (result.kind === "not_found") {
    return Response.json({ error: "message_not_found" }, { status: 404 });
  }
  if (result.kind === "not_unknown") {
    return Response.json({ error: "message_not_awaiting_reconciliation", state: result.state }, { status: 409 });
  }

  const target = new URL("/reliability", getAppOrigin());
  target.searchParams.set("resolved", result.state.toLowerCase());
  return NextResponse.redirect(target, { status: 303 });
}

function normalizeAction(value: FormDataEntryValue | null): ResolutionAction | null {
  return value === "CONFIRM_SENT" || value === "CONFIRM_FAILED" ? value : null;
}

function normalizeEvidence(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 12 && normalized.length <= 1000 ? normalized : null;
}

function normalizeOptionalString(value: FormDataEntryValue | null, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length <= max ? normalized : null;
}

function getAppOrigin(): string {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new Error("APP_ORIGIN is not configured.");
  return new URL(configured).origin;
}

function asJsonValue(value: unknown): never {
  return value as never;
}
