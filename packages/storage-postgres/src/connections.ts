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

  async upsertPendingCredentialConnection(input: {
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
        'AUTH_EXPIRED',
        false,
        null,
        null,
        now()
      )
      on conflict (workspace_id, provider_key, external_account_id)
        where external_account_id is not null
      do update set
        channel = excluded.channel,
        provider_mode = excluded.provider_mode,
        display_name = coalesce(excluded.display_name, app_private.channel_connections.display_name),
        health_state = 'AUTH_EXPIRED',
        auth_valid = false,
        webhook_healthy = null,
        last_verified_at = null,
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
    return mapConnection(row);
  }

  async markCredentialsAttached(connectionId: string): Promise<StoredConnectionRecord> {
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
      update app_private.channel_connections
      set
        health_state = 'STALE',
        auth_valid = true,
        webhook_healthy = null,
        last_verified_at = now(),
        updated_at = now()
      where id = ${connectionId}
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

    if (!row) throw new Error("CONNECTION_NOT_FOUND");
    return mapConnection(row);
  }

  async markCredentialFailure(connectionId: string): Promise<void> {
    await this.sql`
      update app_private.channel_connections
      set
        health_state = 'AUTH_EXPIRED',
        auth_valid = false,
        updated_at = now()
      where id = ${connectionId}
    `;
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

    return rows.map(mapConnection);
  }
}

function mapConnection(row: {
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
}): StoredConnectionRecord {
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
