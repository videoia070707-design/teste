import "server-only";
import { AesGcmSecretCipher, StaticSecretKeyring } from "@automation/secrets";
import { PostgresEncryptedSecretVault } from "@automation/storage-postgres/secrets";
import { getDatabase } from "@/lib/server/database";

let vault: PostgresEncryptedSecretVault | undefined;

export function getProviderSecretVault(): PostgresEncryptedSecretVault {
  if (vault) return vault;

  const currentVersion = process.env.PROVIDER_SECRET_CURRENT_KEY_VERSION;
  const serializedKeys = process.env.PROVIDER_SECRET_KEYS_JSON;

  if (!currentVersion || !serializedKeys) {
    throw new Error("Provider secret encryption is not configured.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedKeys) as unknown;
  } catch {
    throw new Error("PROVIDER_SECRET_KEYS_JSON must be valid JSON.");
  }

  if (!isStringRecord(parsed) || Object.keys(parsed).length === 0) {
    throw new Error("PROVIDER_SECRET_KEYS_JSON must map key versions to base64 keys.");
  }

  const keyring = new StaticSecretKeyring(
    currentVersion,
    Object.entries(parsed).map(([version, keyBase64]) => ({ version, keyBase64 }))
  );

  vault = new PostgresEncryptedSecretVault(
    getDatabase(),
    new AesGcmSecretCipher(keyring)
  );

  return vault;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}
