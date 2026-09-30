import type { DatabaseClient } from "./index";

export interface StoredConnectionRecord {
  id: string;
  workspaceId: string;
  channel: "instagram" | "whatsapp";
  providerKey: string;
  providerMode: "official" | "experimental" | "browser_lab";
  externalAccountId: string | null;
  displayName: string | null;
  healthState: "HEALTHY" | "DEGRADED_PARTIAL" | "STALE" | "AUTH_EXPIRED" | "DISCONNECTED";
  authValid: boolean;
  webhookHealthy: boolean | null;
}

export class PostgresConnectionStore {
  constructor(private readonly sql: DatabaseClient) {}

  async upsertAuthorizedConnection(input: {
    workspaceId: string;
    channel: "instagram" | "whatsapp";
    providerKey: string;
    providerMode: "official" | "experimental" | "browser_lab";
    externalAccountId: string;
    displayName?: string;
  }): Promise<StoredConnectionRecord> {
    const [row] = await this.sql<{
      id: string;
      workspace_id: string;
      channel: StoredConnectionRecord["channel"];
      provider_key: string;
      provider_mode: StoredConnectionRecord["providerMode"];
      external_account_id: string | null;
      display_name: string | null;
      health_state: StoredConnectionRecord["healthState"];
      auth_valid: boolean;
      webhook_healthy: boolean | null;
    }[]>`
      insert into app_private.channel_connections (
        workspace_id,
        channel,
        provider_key,
        provider_mode,
        external_account_id,
        display_name,
        health_state,
        auth_valid,
        webhook_healthy,
        last_verified_at,
        updated_at
      ) values (
        ${input.workspaceId},
        ${input.channel},
        ${input.providerKey},
        ${input.providerMode},
        ${input.externalAccountId},
        ${input.displayName ?? null},
        'STALE',
        true,
        null,
        now(),
        now()
      )
      on conflict (workspace_id, provider_key, external_account_id)
        where external_account_id is not null
      do update set
        channel = excluded.channel,
        provider_mode = excluded.provider_mode,
        display_name = coalesce(excluded.display_name, app_private.channel_connections.display_name),
        health_state = 'STALE',
        auth_valid = true,
        webhook_healthy = null,
        last_verified_at = now(),
        updated_at = now()
      returning
        id,
        workspace_id,
        channel,
        provider_key,
        provider_mode,
        external_account_id,
        display_name,
        health_state,
        auth_valid,
        webhook_healthy
    `;

    if (!row) throw new Error("CONNECTION_UPSERT_RETURNED_NO_ROW");

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      channel: row.channel,
      providerKey: row.provider_key,
      providerMode: row.provider_mode,
      externalAccountId: row.external_account_id,
      displayName: row.display_name,
      healthState: row.health_state,
      authValid: row.auth_valid,
      webhookHealthy: row.webhook_healthy
    };
  }

  async listWorkspaceConnections(workspaceId: string): Promise<StoredConnectionRecord[]> {
    const rows = await this.sql<{
      id: string;
      workspace_id: string;
      channel: StoredConnectionRecord["channel"];
      provider_key: string;
      provider_mode: StoredConnectionRecord["providerMode"];
      external_account_id: string | null;
      display_name: string | null;
      health_state: StoredConnectionRecord["healthState"];
      auth_valid: boolean;
      webhook_healthy: boolean | null;
    }[]>`
      select
        id,
        workspace_id,
        channel,
        provider_key,
        provider_mode,
        external_account_id,
        display_name,
        health_state,
        auth_valid,
        webhook_healthy
      from app_private.channel_connections
      where workspace_id = ${workspaceId}
      order by created_at asc
    `;

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      channel: row.channel,
      providerKey: row.provider_key,
      providerMode: row.provider_mode,
      externalAccountId: row.external_account_id,
      displayName: row.display_name,
      healthState: row.health_state,
      authValid: row.auth_valid,
      webhookHealthy: row.webhook_healthy
    }));
  }
}
