import { randomUUID } from "node:crypto";
import { can, type WorkspaceRole } from "@automation/core";
import { verifyWebhookChallenge } from "@automation/provider-instagram-official";
import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { buildInstagramReadinessReport } from "@/lib/server/instagram-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const { userId, membership } = await requireWorkspaceContext();
  if (!can(membership.role as WorkspaceRole, "connections.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sql = getDatabase();
  const report = await buildInstagramReadinessReport(sql, membership.workspaceId);
  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ?? "";
  const challengeValue = `local-preflight-${randomUUID()}`;
  const challengeResult = expectedToken
    ? verifyWebhookChallenge({
        mode: "subscribe",
        token: expectedToken,
        challenge: challengeValue,
        expectedToken
      })
    : null;

  const challengeReady = challengeResult === challengeValue;
  const preflightReady = report.configurationReady && challengeReady;
  const correlationId = randomUUID();

  await sql`
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
      'provider.readiness.self_tested',
      'provider_readiness',
      'instagram.meta.official',
      ${correlationId},
      ${sql.json({
        configurationReady: report.configurationReady,
        webhookChallengeReady: challengeReady,
        hostPassAtRun: report.hostPass,
        hostPassEvidenceMutated: false
      })}
    )
  `;

  const target = new URL("/connections/instagram/readiness", new URL(request.url).origin);
  target.searchParams.set("preflight", preflightReady ? "ready" : "blocked");
  return NextResponse.redirect(target, { status: 303 });
}
