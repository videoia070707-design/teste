import { randomUUID } from "node:crypto";
import { can, type WorkspaceRole } from "@automation/core";
import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER_KEY = "instagram.meta.official";
const ALLOWED_CHECKS = new Set([
  "meta_business_app_created",
  "instagram_professional_test_account",
  "meta_test_roles_configured",
  "required_permissions_available",
  "webhook_subscriptions_configured",
  "privacy_url_registered",
  "data_deletion_url_registered"
]);
const ALLOWED_STATUSES = new Set(["confirmed", "blocked", "not_applicable"]);

export async function POST(request: Request): Promise<Response> {
  const { userId, membership } = await requireWorkspaceContext();
  if (!can(membership.role as WorkspaceRole, "connections.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const checkKey = stringValue(form.get("checkKey"));
  const status = stringValue(form.get("status"));
  const note = stringValue(form.get("note")).slice(0, 500) || null;

  if (!ALLOWED_CHECKS.has(checkKey) || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "invalid_readiness_attestation" }, { status: 400 });
  }

  const sql = getDatabase();
  const correlationId = randomUUID();

  await sql.begin(async (tx) => {
    await tx`
      insert into app_private.provider_readiness_attestations (
        workspace_id,
        provider_key,
        check_key,
        status,
        note,
        confirmed_by_user_id,
        confirmed_at,
        updated_at
      ) values (
        ${membership.workspaceId},
        ${PROVIDER_KEY},
        ${checkKey},
        ${status},
        ${note},
        ${userId},
        now(),
        now()
      )
      on conflict (workspace_id, provider_key, check_key)
      do update set
        status = excluded.status,
        note = excluded.note,
        confirmed_by_user_id = excluded.confirmed_by_user_id,
        confirmed_at = now(),
        updated_at = now()
    `;

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
        'provider.readiness.attested',
        'provider_readiness',
        ${`${PROVIDER_KEY}:${checkKey}`},
        ${correlationId},
        ${tx.json({ checkKey, status, notePresent: note !== null })}
      )
    `;
  });

  const origin = new URL(request.url).origin;
  return NextResponse.redirect(new URL("/connections/instagram/readiness", origin), { status: 303 });
}

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}
