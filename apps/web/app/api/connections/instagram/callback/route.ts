import { can, type WorkspaceRole } from "@automation/core";
import { exchangeInstagramAuthorizationCode } from "@automation/provider-instagram-official";
import {
  exchangeInstagramLongLivedToken,
  parseInstagramAuthorizationToken
} from "@automation/provider-instagram-official/tokens";
import { PostgresConnectionStore } from "@automation/storage-postgres/connections";
import { PostgresOAuthSessionStore } from "@automation/storage-postgres/oauth";
import type { StoredSecretReference } from "@automation/storage-postgres/secrets";
import { NextResponse } from "next/server";
import { requireAuthenticatedUser, requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { getInstagramServerConfig } from "@/lib/server/instagram";
import { getProviderSecretVault } from "@/lib/server/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER_KEY = "instagram.meta.official";
const SECRET_PURPOSE = "instagram.credentials";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error");

  if (!state) return redirectToConnections("invalid_state");

  let userId: string;
  try {
    ({ userId } = await requireAuthenticatedUser());
  } catch {
    return redirectToConnections("authentication_required");
  }

  const database = getDatabase();
  const oauthSessions = new PostgresOAuthSessionStore(database);
  const oauthSession = await oauthSessions.consume(PROVIDER_KEY, state, userId);

  if (!oauthSession) return redirectToConnections("invalid_or_expired_state");

  let membership;
  try {
    ({ membership } = await requireWorkspaceContext(oauthSession.workspaceId));
  } catch {
    return redirectToConnections("workspace_access_denied");
  }

  if (oauthSession.initiatedByUserId !== userId) {
    return redirectToConnections("oauth_actor_mismatch");
  }

  if (!can(membership.role as WorkspaceRole, "connections.manage")) {
    return redirectToConnections("forbidden");
  }

  if (providerError) return redirectToConnections("authorization_denied");
  if (!code) return redirectToConnections("missing_code");

  const connectionStore = new PostgresConnectionStore(database);
  const vault = await getProviderSecretVault();
  let connectionId: string | null = null;
  let previousReference: StoredSecretReference | null = null;
  let newReference: StoredSecretReference | null = null;
  let newReferenceAttached = false;

  try {
    const config = getInstagramServerConfig();
    const authorizationPayload = await exchangeInstagramAuthorizationCode(config.oauth, code);
    const shortLived = parseInstagramAuthorizationToken(authorizationPayload);
    const longLived = await exchangeInstagramLongLivedToken({
      endpoint: config.longLivedTokenEndpoint,
      clientSecret: config.oauth.clientSecret,
      shortLivedAccessToken: shortLived.accessToken
    });

    const connection = await connectionStore.upsertPendingCredentialConnection({
      workspaceId: membership.workspaceId,
      channel: "instagram",
      providerKey: PROVIDER_KEY,
      providerMode: "official",
      externalAccountId: shortLived.userId
    });
    connectionId = connection.id;

    previousReference = await vault.getConnectionReference(connection.id);

    const obtainedAt = new Date();
    const expiresAt = longLived.expiresInSeconds !== undefined
      ? new Date(obtainedAt.getTime() + longLived.expiresInSeconds * 1000).toISOString()
      : null;

    newReference = await vault.put({
      workspaceId: membership.workspaceId,
      purpose: SECRET_PURPOSE,
      plaintext: JSON.stringify({
        schemaVersion: 1,
        tokenKind: "long_lived",
        accessToken: longLived.accessToken,
        igUserId: shortLived.userId,
        obtainedAt: obtainedAt.toISOString(),
        expiresAt
      })
    });

    await vault.attachToConnection({
      connectionId: connection.id,
      reference: newReference
    });
    newReferenceAttached = true;

    await connectionStore.markCredentialsAttached(connection.id);

    if (previousReference && previousReference.ref !== newReference.ref) {
      try {
        await vault.delete({
          workspaceId: membership.workspaceId,
          purpose: SECRET_PURPOSE,
          ref: previousReference.ref
        });
      } catch {
        // The new credential is already active. Orphan cleanup can be retried by
        // a maintenance job without rolling back a successful authorization.
      }
    }

    return redirectToConnections("connected");
  } catch {
    if (connectionId) {
      if (newReferenceAttached) {
        try {
          if (previousReference) {
            await vault.attachToConnection({ connectionId, reference: previousReference });
          } else {
            await vault.detachFromConnection(connectionId);
          }
        } catch {
          // Fail closed below even if secret-reference rollback itself fails.
        }
      }

      if (newReference) {
        try {
          await vault.delete({
            workspaceId: membership.workspaceId,
            purpose: SECRET_PURPOSE,
            ref: newReference.ref
          });
        } catch {
          // A later secret-maintenance job can remove an orphaned ciphertext.
        }
      }

      try {
        await connectionStore.markCredentialFailure(connectionId);
      } catch {
        // Do not expose infrastructure details through the OAuth redirect.
      }
    }

    return redirectToConnections("failed");
  }
}

function redirectToConnections(status: string): NextResponse {
  const origin = getAppOrigin();
  const target = new URL("/connections", origin);
  target.searchParams.set("instagram", status);
  const response = NextResponse.redirect(target, { status: 302 });
  response.headers.set("cache-control", "no-store, private");
  return response;
}

function getAppOrigin(): string {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new Error("APP_ORIGIN is not configured.");
  return new URL(configured).origin;
}
