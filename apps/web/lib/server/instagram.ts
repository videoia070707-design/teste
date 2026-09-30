import "server-only";
import type { InstagramOAuthConfig } from "@automation/provider-instagram-official";
import { getPlatformSecret } from "@/lib/server/platform-secrets";

export interface InstagramApiConfig {
  graphBaseUrl: string;
  apiVersion: string;
  identityProbePathTemplate?: string;
}

export interface InstagramServerConfig extends InstagramApiConfig {
  oauth: InstagramOAuthConfig;
  longLivedTokenEndpoint: string;
}

export function getInstagramApiConfig(): InstagramApiConfig {
  const graphBaseUrl = requiredUrl("INSTAGRAM_GRAPH_BASE_URL").toString();
  const apiVersion = required("INSTAGRAM_GRAPH_API_VERSION");

  return {
    graphBaseUrl,
    apiVersion,
    ...(process.env.INSTAGRAM_IDENTITY_PROBE_PATH
      ? { identityProbePathTemplate: process.env.INSTAGRAM_IDENTITY_PROBE_PATH }
      : {})
  };
}

export async function getInstagramServerConfig(): Promise<InstagramServerConfig> {
  const origin = requiredUrl("APP_ORIGIN").origin;
  const authorizationEndpoint = requiredUrl("INSTAGRAM_OAUTH_AUTHORIZE_URL").toString();
  const tokenEndpoint = requiredUrl("INSTAGRAM_OAUTH_TOKEN_URL").toString();
  const longLivedTokenEndpoint = requiredUrl("INSTAGRAM_LONG_LIVED_TOKEN_URL").toString();
  const clientId = required("META_APP_ID");
  const clientSecret = await requiredSecret("META_APP_SECRET", "meta_app_secret");
  const tokenRequestEncoding = parseEncoding(process.env.INSTAGRAM_OAUTH_TOKEN_ENCODING);
  const api = getInstagramApiConfig();

  return {
    ...api,
    oauth: {
      authorizationEndpoint,
      tokenEndpoint,
      clientId,
      clientSecret,
      redirectUri: `${origin}/api/connections/instagram/callback`,
      tokenRequestEncoding
    },
    longLivedTokenEndpoint
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function requiredSecret(envName: string, platformName: "meta_app_secret"): Promise<string> {
  const legacyValue = process.env[envName]?.trim();
  if (legacyValue) return legacyValue;

  const stored = (await getPlatformSecret(platformName))?.trim();
  if (!stored) {
    throw new Error(`${envName} is not configured in the environment or Supabase Vault.`);
  }
  return stored;
}

function requiredUrl(name: string): URL {
  return new URL(required(name));
}

function parseEncoding(value: string | undefined): "multipart" | "urlencoded" {
  if (!value || value === "multipart") return "multipart";
  if (value === "urlencoded") return "urlencoded";
  throw new Error("INSTAGRAM_OAUTH_TOKEN_ENCODING must be multipart or urlencoded.");
}
