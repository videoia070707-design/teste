import { randomBytes } from "node:crypto";
import { can, type WorkspaceRole } from "@automation/core";
import { buildInstagramAuthorizationUrl } from "@automation/provider-instagram-official";
import { PostgresOAuthSessionStore } from "@automation/storage-postgres/oauth";
import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { getInstagramServerConfig } from "@/lib/server/instagram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { membership } = await requireWorkspaceContext();

    if (!can(membership.role as WorkspaceRole, "connections.manage")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const config = getInstagramServerConfig();
    const state = randomBytes(32).toString("base64url");
    const sessions = new PostgresOAuthSessionStore(getDatabase());

    await sessions.create({
      workspaceId: membership.workspaceId,
      provider: "instagram.meta.official",
      state,
      redirectAfter: "/connections",
      ttlSeconds: 600
    });

    const authorizationUrl = buildInstagramAuthorizationUrl(config.oauth, state);
    const response = NextResponse.redirect(authorizationUrl, { status: 302 });
    response.headers.set("cache-control", "no-store, private");
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    return NextResponse.json({ error: "instagram_oauth_unavailable" }, { status: 503 });
  }
}
