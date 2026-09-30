import "server-only";
import type { DatabaseClient } from "@automation/storage-postgres";
import { getDatabase } from "@/lib/server/database";

export type PlatformSecretName =
  | "provider_secret_keyring"
  | "meta_app_secret"
  | "meta_webhook_verify_token"
  | "meta_webhook_signature_header";

export async function getPlatformSecret(
  name: PlatformSecretName,
  database: DatabaseClient = getDatabase()
): Promise<string | null> {
  const [row] = await database<{ secret_value: string | null }[]>`
    select app_private.get_platform_secret(${name}) as secret_value
  `;

  return row?.secret_value ?? null;
}

export async function getPlatformSecrets(
  names: readonly PlatformSecretName[],
  database: DatabaseClient = getDatabase()
): Promise<Partial<Record<PlatformSecretName, string>>> {
  const entries = await Promise.all(
    names.map(async (name) => [name, await getPlatformSecret(name, database)] as const)
  );

  const result: Partial<Record<PlatformSecretName, string>> = {};
  for (const [name, value] of entries) {
    if (value !== null) result[name] = value;
  }
  return result;
}
