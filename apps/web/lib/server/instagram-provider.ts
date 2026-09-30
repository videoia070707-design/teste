import "server-only";
import type { ConnectionId } from "@automation/core";
import {
  InstagramOfficialProvider,
  type InstagramCredentialResolver,
  type InstagramCredentials
} from "@automation/provider-instagram-official";
import { getDatabase } from "@/lib/server/database";
import { getInstagramApiConfig } from "@/lib/server/instagram";
import { getProviderSecretVault } from "@/lib/server/secrets";

const SECRET_PURPOSE = "instagram.credentials";

class ServerInstagramCredentialResolver implements InstagramCredentialResolver {
  async resolve(connectionId: ConnectionId): Promise<InstagramCredentials | null> {
    const database = getDatabase();
    const [connection] = await database<{
      workspace_id: string;
      external_account_id: string | null;
      auth_valid: boolean;
    }[]>`
      select workspace_id, external_account_id, auth_valid
      from app_private.channel_connections
      where id = ${connectionId}
        and provider_key = 'instagram.meta.official'
        and channel = 'instagram'
      limit 1
    `;

    if (!connection?.auth_valid || !connection.external_account_id) return null;

    const vault = await getProviderSecretVault();
    const reference = await vault.getConnectionReference(connectionId);
    if (!reference) return null;

    const plaintext = await vault.get({
      workspaceId: connection.workspace_id,
      purpose: SECRET_PURPOSE,
      ref: reference.ref
    });

    const parsed = parseCredential(plaintext);
    if (parsed.igUserId !== connection.external_account_id) {
      throw new Error("INSTAGRAM_CREDENTIAL_IDENTITY_MISMATCH");
    }

    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) {
      return null;
    }

    return {
      accessToken: parsed.accessToken,
      igUserId: parsed.igUserId
    };
  }
}

interface StoredInstagramCredential {
  schemaVersion: 1;
  accessToken: string;
  igUserId: string;
  expiresAt: string | null;
}

let provider: InstagramOfficialProvider | undefined;

export function getInstagramOfficialProvider(): InstagramOfficialProvider {
  if (provider) return provider;

  const config = getInstagramApiConfig();
  provider = new InstagramOfficialProvider(
    {
      graphBaseUrl: config.graphBaseUrl,
      apiVersion: config.apiVersion,
      ...(config.identityProbePathTemplate
        ? { identityProbePathTemplate: config.identityProbePathTemplate }
        : {})
    },
    new ServerInstagramCredentialResolver()
  );

  return provider;
}

function parseCredential(value: string): StoredInstagramCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("INSTAGRAM_CREDENTIAL_INVALID_JSON");
  }

  if (!isRecord(parsed)) throw new Error("INSTAGRAM_CREDENTIAL_INVALID");
  if (parsed.schemaVersion !== 1) throw new Error("INSTAGRAM_CREDENTIAL_UNSUPPORTED_VERSION");
  if (typeof parsed.accessToken !== "string" || !parsed.accessToken) throw new Error("INSTAGRAM_CREDENTIAL_TOKEN_MISSING");
  if (typeof parsed.igUserId !== "string" || !parsed.igUserId) throw new Error("INSTAGRAM_CREDENTIAL_USER_MISSING");
  if (parsed.expiresAt !== null && typeof parsed.expiresAt !== "string") throw new Error("INSTAGRAM_CREDENTIAL_EXPIRY_INVALID");

  return {
    schemaVersion: 1,
    accessToken: parsed.accessToken,
    igUserId: parsed.igUserId,
    expiresAt: parsed.expiresAt
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
