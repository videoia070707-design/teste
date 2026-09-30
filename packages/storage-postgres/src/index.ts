import postgres, { type TransactionSql } from "postgres";

export * from "./oauth";

export type DatabaseClient = ReturnType<typeof postgres>;
export type DatabaseTransaction = TransactionSql<{}>;

export interface DatabaseClientOptions {
  maxConnections?: number;
}

export interface WebhookIngressInput {
  provider: string;
  signatureValid: boolean;
  bodySha256: string;
  rawBody: Uint8Array;
  headers: Record<string, string>;
  parsedPayload: unknown | null;
  providerAccountIds: string[];
}

export interface WebhookIngressResult {
  id: string;
  receiveCount: number;
  duplicate: boolean;
}

export interface WebhookIngressStore {
  persist(input: WebhookIngressInput): Promise<WebhookIngressResult>;
}

export interface WorkspaceMembershipRecord {
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "automation_manager" | "supervisor" | "agent" | "analyst" | "viewer";
}

export function createDatabaseClient(
  connectionString: string,
  options: DatabaseClientOptions = {}
): DatabaseClient {
  if (!connectionString.trim()) throw new Error("DATABASE_URL is required.");

  const maxConnections = options.maxConnections ?? 10;
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 20) {
    throw new Error("Database maxConnections must be an integer between 1 and 20.");
  }

  return postgres(connectionString, {
    max: maxConnections,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  });
}

export class PostgresWorkspaceStore {
  constructor(private readonly sql: DatabaseClient) {}

  async listMemberships(userId: string): Promise<WorkspaceMembershipRecord[]> {
    const rows = await this.sql<{
      workspace_id: string;
      workspace_name: string;
      role: WorkspaceMembershipRecord["role"];
    }[]>`
      select
        wm.workspace_id,
        w.name as workspace_name,
        wm.role
      from app_private.workspace_members wm
      join app_private.workspaces w on w.id = wm.workspace_id
      where wm.user_id = ${userId}
      order by wm.created_at asc, wm.workspace_id asc
    `;

    return rows.map((row) => ({
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      role: row.role
    }));
  }

  async ensureDefaultWorkspace(userId: string): Promise<WorkspaceMembershipRecord> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;

      const [existing] = await tx<{
        workspace_id: string;
        workspace_name: string;
        role: WorkspaceMembershipRecord["role"];
      }[]>`
        select
          wm.workspace_id,
          w.name as workspace_name,
          wm.role
        from app_private.workspace_members wm
        join app_private.workspaces w on w.id = wm.workspace_id
        where wm.user_id = ${userId}
        order by wm.created_at asc, wm.workspace_id asc
        limit 1
      `;

      if (existing) {
        return {
          workspaceId: existing.workspace_id,
          workspaceName: existing.workspace_name,
          role: existing.role
        };
      }

      const [workspace] = await tx<{ id: string; name: string }[]>`
        insert into app_private.workspaces (name)
        values ('Meu Workspace')
        returning id, name
      `;

      if (!workspace) throw new Error("Workspace bootstrap insert returned no row.");

      await tx`
        insert into app_private.workspace_members (workspace_id, user_id, role)
        values (${workspace.id}, ${userId}, 'owner')
      `;

      return {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        role: "owner"
      };
    });
  }

  async requireMembership(userId: string, workspaceId: string): Promise<WorkspaceMembershipRecord> {
    const [membership] = await this.sql<{
      workspace_id: string;
      workspace_name: string;
      role: WorkspaceMembershipRecord["role"];
    }[]>`
      select
        wm.workspace_id,
        w.name as workspace_name,
        wm.role
      from app_private.workspace_members wm
      join app_private.workspaces w on w.id = wm.workspace_id
      where wm.user_id = ${userId}
        and wm.workspace_id = ${workspaceId}
      limit 1
    `;

    if (!membership) throw new Error("WORKSPACE_ACCESS_DENIED");

    return {
      workspaceId: membership.workspace_id,
      workspaceName: membership.workspace_name,
      role: membership.role
    };
  }
}

export class PostgresWebhookIngressStore implements WebhookIngressStore {
  constructor(private readonly sql: DatabaseClient) {}

  async persist(input: WebhookIngressInput): Promise<WebhookIngressResult> {
    const payloadValue = input.parsedPayload === null
      ? null
      : this.sql.json(input.parsedPayload as never);

    const [row] = await this.sql<{
      id: string;
      receive_count: number;
      inserted: boolean;
    }[]>`
      insert into app_private.webhook_ingress_events (
        provider,
        signature_valid,
        body_sha256,
        raw_body,
        headers,
        parsed_payload,
        provider_account_ids
      ) values (
        ${input.provider},
        ${input.signatureValid},
        ${input.bodySha256},
        ${Buffer.from(input.rawBody)},
        ${this.sql.json(input.headers)},
        ${payloadValue},
        ${this.sql.array(input.providerAccountIds)}
      )
      on conflict (provider, body_sha256)
      do update set
        receive_count = app_private.webhook_ingress_events.receive_count + 1,
        last_received_at = now(),
        signature_valid = app_private.webhook_ingress_events.signature_valid or excluded.signature_valid
      returning
        id,
        receive_count,
        (xmax = 0) as inserted
    `;

    if (!row) throw new Error("Webhook ingress insert returned no row.");

    return {
      id: row.id,
      receiveCount: row.receive_count,
      duplicate: !row.inserted
    };
  }
}
