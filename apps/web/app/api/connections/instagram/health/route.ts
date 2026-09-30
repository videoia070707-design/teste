import { can, type ConnectionId, type ProviderMode, type WorkspaceId, type WorkspaceRole } from "@automation/core";
import type { ConnectionHealthState, ProviderConnection } from "@automation/providers";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { getInstagramServerConfig } from "@/lib/server/instagram";
import { getInstagramOfficialProvider } from "@/lib/server/instagram-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const { membership } = await requireWorkspaceContext();
  if (!can(membership.role as WorkspaceRole, "connections.manage")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json_body" }, { status: 400 });
  }

  if (!isRecord(body) || typeof body.connectionId !== "string" || !body.connectionId) {
    return Response.json({ error: "connection_id_required" }, { status: 400 });
  }

  const sql = getDatabase();
  const [connection] = await sql<{
    id: string;
    workspace_id: string;
    channel: "instagram";
    provider_key: string;
    provider_mode: ProviderMode;
    external_account_id: string | null;
    display_name: string | null;
    webhook_healthy: boolean | null;
    last_event_at: string | null;
  }[]>`
    select
      id,
      workspace_id,
      channel,
      provider_key,
      provider_mode,
      external_account_id,
      display_name,
      webhook_healthy,
      last_event_at
    from app_private.channel_connections
    where id = ${body.connectionId}
      and workspace_id = ${membership.workspaceId}
      and channel = 'instagram'
      and provider_key = 'instagram.meta.official'
      and provider_mode = 'official'
    limit 1
  `;

  if (!connection) return Response.json({ error: "connection_not_found" }, { status: 404 });

  const providerConnection: ProviderConnection = {
    id: connection.id as ConnectionId,
    workspaceId: connection.workspace_id as WorkspaceId,
    channel: "instagram",
    provider: connection.provider_key,
    mode: connection.provider_mode,
    ...(connection.external_account_id ? { externalAccountId: connection.external_account_id } : {}),
    ...(connection.display_name ? { displayName: connection.display_name } : {})
  };

  const provider = getInstagramOfficialProvider();
  const probe = await provider.verifyConnection(providerConnection);
  const config = getInstagramServerConfig();
  const finalState = combineHealth({
    probeState: probe.state,
    authValid: probe.authValid,
    webhookHealthy: connection.webhook_healthy,
    identityProbeConfigured: Boolean(config.identityProbePathTemplate)
  });

  await sql.begin(async (tx) => {
    await tx`
      update app_private.channel_connections
      set
        health_state = ${finalState},
        auth_valid = ${probe.authValid},
        last_verified_at = ${probe.checkedAt},
        updated_at = now()
      where id = ${connection.id}
    `;

    for (const capability of probe.capabilities) {
      await tx`
        insert into app_private.connection_capabilities (
          connection_id,
          capability_key,
          state,
          reason,
          checked_at
        ) values (
          ${connection.id},
          ${capability.key},
          ${capability.state},
          ${capability.reason ?? null},
          ${probe.checkedAt}
        )
        on conflict (connection_id, capability_key)
        do update set
          state = excluded.state,
          reason = excluded.reason,
          checked_at = excluded.checked_at
      `;
    }
  });

  return Response.json({
    connectionId: connection.id,
    state: finalState,
    authValid: probe.authValid,
    webhookHealthy: connection.webhook_healthy,
    lastEventAt: connection.last_event_at,
    checkedAt: probe.checkedAt,
    capabilities: probe.capabilities,
    diagnostics: probe.diagnostics
  });
}

function combineHealth(input: {
  probeState: ConnectionHealthState;
  authValid: boolean;
  webhookHealthy: boolean | null;
  identityProbeConfigured: boolean;
}): ConnectionHealthState {
  if (!input.authValid || input.probeState === "AUTH_EXPIRED") return "AUTH_EXPIRED";
  if (input.probeState === "DISCONNECTED") return "DISCONNECTED";
  if (input.probeState === "DEGRADED_PARTIAL") return "DEGRADED_PARTIAL";
  if (!input.identityProbeConfigured) return "STALE";
  if (input.webhookHealthy === false) return "DEGRADED_PARTIAL";
  if (input.webhookHealthy === null) return "STALE";
  return "HEALTHY";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
