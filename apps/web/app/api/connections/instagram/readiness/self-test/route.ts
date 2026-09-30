import { randomUUID } from "node:crypto";
import { can, type WorkspaceRole } from "@automation/core";
import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { buildInstagramReadinessReport } from "@/lib/server/instagram-readiness";
import { getPlatformSecret } from "@/lib/server/platform-secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const { userId, membership } = await requireWorkspaceContext();
  if (!can(membership.role as WorkspaceRole, "connections.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sql = getDatabase();
  const report = await buildInstagramReadinessReport(sql, membership.workspaceId);
  const verifyToken = await getPlatformSecret("meta_webhook_verify_token", sql);

  const challengeValue = `local-preflight-${randomUUID()}`;
  const challengeReady = report.urls.webhookCallback && verifyToken
    ? await verifyPublicEdgeChallenge(
        report.urls.webhookCallback,
        verifyToken,
        challengeValue
      )
    : false;

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
        webhookTarget: report.urls.webhookCallback ? "supabase-edge" : "unavailable",
        hostPassAtRun: report.hostPass,
        hostPassEvidenceMutated: false
      })}
    )
  `;

  const target = new URL("/connections/instagram/readiness", new URL(request.url).origin);
  target.searchParams.set("preflight", preflightReady ? "ready" : "blocked");
  return NextResponse.redirect(target, { status: 303 });
}

async function verifyPublicEdgeChallenge(
  webhookUrl: string,
  verifyToken: string,
  challenge: string
): Promise<boolean> {
  const target = new URL(webhookUrl);
  target.searchParams.set("hub.mode", "subscribe");
  target.searchParams.set("hub.verify_token", verifyToken);
  target.searchParams.set("hub.challenge", challenge);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return false;
    return (await response.text()) === challenge;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
