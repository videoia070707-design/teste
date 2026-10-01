import "server-only";
import type { DatabaseClient } from "@automation/storage-postgres";
import { getDatabase } from "@/lib/server/database";

export async function isPlatformOperator(
  userId: string,
  sql: DatabaseClient = getDatabase()
): Promise<boolean> {
  const [row] = await sql<{ allowed: boolean }[]>`
    select app_private.is_platform_operator(${userId}) as allowed
  `;
  return row?.allowed === true;
}

export async function requirePlatformOperator(
  userId: string,
  sql: DatabaseClient = getDatabase()
): Promise<void> {
  const allowed = await isPlatformOperator(userId, sql);
  if (!allowed) throw new PlatformOperatorRequiredError();
}

export class PlatformOperatorRequiredError extends Error {
  constructor() {
    super("PLATFORM_OPERATOR_REQUIRED");
    this.name = "PlatformOperatorRequiredError";
  }
}
