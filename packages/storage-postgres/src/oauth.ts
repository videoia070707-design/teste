import { createHash } from "node:crypto";
import type { DatabaseClient } from "./index";

export interface OAuthSessionRecord {
  workspaceId: string;
  redirectAfter: string | null;
}

export class PostgresOAuthSessionStore {
  constructor(private readonly sql: DatabaseClient) {}

  async create(input: {
    workspaceId: string;
    provider: string;
    state: string;
    redirectAfter?: string;
    ttlSeconds?: number;
  }): Promise<void> {
    const ttlSeconds = input.ttlSeconds ?? 600;
    if (ttlSeconds < 60 || ttlSeconds > 1800) throw new Error("INVALID_OAUTH_TTL");
    if (input.redirectAfter && !isSafeRelativePath(input.redirectAfter)) throw new Error("INVALID_REDIRECT_PATH");

    const stateHash = hashState(input.state);

    await this.sql`
      insert into app_private.oauth_sessions (
        workspace_id,
        provider,
        state_hash,
        redirect_after,
        expires_at
      ) values (
        ${input.workspaceId},
        ${input.provider},
        ${stateHash},
        ${input.redirectAfter ?? null},
        now() + (${ttlSeconds} * interval '1 second')
      )
    `;
  }

  async consume(provider: string, state: string): Promise<OAuthSessionRecord | null> {
    const stateHash = hashState(state);

    return this.sql.begin(async (tx) => {
      const [row] = await tx<{
        workspace_id: string;
        redirect_after: string | null;
      }[]>`
        update app_private.oauth_sessions
        set consumed_at = now()
        where provider = ${provider}
          and state_hash = ${stateHash}
          and consumed_at is null
          and expires_at > now()
        returning workspace_id, redirect_after
      `;

      if (!row) return null;
      return {
        workspaceId: row.workspace_id,
        redirectAfter: row.redirect_after
      };
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await this.sql`
      delete from app_private.oauth_sessions
      where expires_at < now() - interval '1 day'
    `;
    return result.count;
  }
}

function hashState(state: string): string {
  if (state.length < 32) throw new Error("OAUTH_STATE_TOO_SHORT");
  return createHash("sha256").update(state).digest("hex");
}

function isSafeRelativePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}
