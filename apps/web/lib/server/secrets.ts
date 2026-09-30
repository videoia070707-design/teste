import "server-only";
import { AesGcmSecretCipher, StaticSecretKeyring } from "@automation/secrets";
import { PostgresEncryptedSecretVault } from "@automation/storage-postgres/secrets";
import { getDatabase } from "@/lib/server/database";
import { getPlatformSecret } from "@/lib/server/platform-secrets";

interface StoredKeyring {
  currentVersion: string;
  keys: Record<string, string>;
}

let vaultPromise: Promise<PostgresEncryptedSecretVault> | undefined;

export function getProviderSecretVault(): Promise<PostgresEncryptedSecretVault> {
  if (!vaultPromise) vaultPromise = createProviderSecretVault();
  return vaultPromise;
}

async function createProviderSecretVault(): Promise<PostgresEncryptedSecretVault> {
  const database = getDatabase();
  const envKeyring = readLegacyEnvironmentKeyring();
  const stored = envKeyring ?? await readSupabaseVaultKeyring(database);

  const keyring = new StaticSecretKeyring(
    stored.currentVersion,
    Object.entries(stored.keys).map(([version, keyBase64]) => ({ version, keyBase64 }))
  );

  return new PostgresEncryptedSecretVault(
    database,
    new AesGcmSecretCipher(keyring)
  );
}

async function readSupabaseVaultKeyring(database: ReturnType<typeof getDatabase>): Promise<StoredKeyring> {
  const raw = await getPlatformSecret("provider_secret_keyring", database);
  if (!raw) throw new Error("Provider secret keyring is not available through the platform secret bridge.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Supabase Vault provider keyring is not valid JSON.");
  }

  return parseStoredKeyring(parsed);
}

function readLegacyEnvironmentKeyring(): StoredKeyring | null {
  const currentVersion = process.env.PROVIDER_SECRET_CURRENT_KEY_VERSION?.trim();
  const serializedKeys = process.env.PROVIDER_SECRET_KEYS_JSON?.trim();
  if (!currentVersion && !serializedKeys) return null;
  if (!currentVersion || !serializedKeys) {
    throw new Error("Both legacy provider keyring environment variables are required when either is present.");
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

  return { currentVersion, keys: parsed };
}

function parseStoredKeyring(value: unknown): StoredKeyring {
  if (!isRecord(value)) throw new Error("Provider keyring must be an object.");
  if (typeof value.currentVersion !== "string" || !value.currentVersion) {
    throw new Error("Provider keyring currentVersion is missing.");
  }
  if (!isStringRecord(value.keys) || Object.keys(value.keys).length === 0) {
    throw new Error("Provider keyring keys are missing.");
  }
  if (!value.keys[value.currentVersion]) {
    throw new Error("Provider keyring current version is unavailable.");
  }

  return { currentVersion: value.currentVersion, keys: value.keys };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
