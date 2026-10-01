import "server-only";
import type { InstagramOAuthConfig } from "@automation/provider-instagram-official";
import { getDatabase } from "@/lib/server/database";
import { getPlatformSecret } from "@/lib/server/platform-secrets";

const PROVIDER_KEY = "instagram.meta.official";
const EDGE_OAUTH_CALLBACK_PATH = "/functions/v1/instagram-oauth-callback";

export interface InstagramApiConfig {
  graphBaseUrl: string;
  apiVersion: string;
  identityProbePathTemplate?: string;
}

export interface InstagramServerConfig extends InstagramApiConfig {
  oauth: InstagramOAuthConfig;
  longLivedTokenEndpoint: string;
}

interface HostedInstagramConfigRow {
  graph_base_url: string;
  graph_api_version: string;
  app_id: string | null;
  oauth_authorize_url: string | null;
  oauth_token_url: string | null;
  oauth_token_encoding: string | null;
  long_lived_token_url: string | null;
  identity_probe_path: string | null;
}

export async function getInstagramApiConfig(): Promise<InstagramApiConfig> {
  const hosted = await readHostedConfig();
  return buildApiConfig(hosted);
}

export async function getInstagramServerConfig(): Promise<InstagramServerConfig> {
  const hosted = await readHostedConfig();
  const authorizationEndpoint = requiredConfiguredUrl(
    "Instagram OAuth authorize URL",
    hosted?.oauth_authorize_url,
    process.env.INSTAGRAM_OAUTH_AUTHORIZE_URL
  );
  const tokenEndpoint = requiredConfiguredUrl(
    "Instagram OAuth token URL",
    hosted?.oauth_token_url,
    process.env.INSTAGRAM_OAUTH_TOKEN_URL
  );
  const longLivedTokenEndpoint = requiredConfiguredUrl(
    "Instagram long-lived token URL",
    hosted?.long_lived_token_url,
    process.env.INSTAGRAM_LONG_LIVED_TOKEN_URL
  );
  const clientId = requiredConfiguredValue(
    "Meta App ID",
    hosted?.app_id,
    process.env.META_APP_ID
  );
  const clientSecret = await requiredSecret("META_APP_SECRET", "meta_app_secret");
  const tokenRequestEncoding = parseEncoding(
    hosted?.oauth_token_encoding ?? process.env.INSTAGRAM_OAUTH_TOKEN_ENCODING
  );
  const api = buildApiConfig(hosted);

  return {
    ...api,
    oauth: {
      authorizationEndpoint,
      tokenEndpoint,
      clientId,
      clientSecret,
      redirectUri: resolveOAuthRedirectUri(),
      tokenRequestEncoding
    },
    longLivedTokenEndpoint
  };
}

export function resolveOAuthRedirectUri(): string {
  const explicit = process.env.INSTAGRAM_OAUTH_REDIRECT_URL?.trim();
  if (explicit) return requiredHttpsOrLocalUrl(explicit, "INSTAGRAM_OAUTH_REDIRECT_URL").toString();

  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (supabase) {
    const origin = requiredHttpsOrLocalUrl(supabase, "NEXT_PUBLIC_SUPABASE_URL").origin;
    return `${origin}${EDGE_OAUTH_CALLBACK_PATH}`;
  }

  const origin = requiredUrlFromEnvironment("APP_ORIGIN").origin;
  return `${origin}/api/connections/instagram/callback`;
}

async function readHostedConfig(): Promise<HostedInstagramConfigRow | null> {
  try {
    const database = getDatabase();
    const [row] = await database<HostedInstagramConfigRow[]>`
      select
        graph_base_url,
        graph_api_version,
        app_id,
        oauth_authorize_url,
        oauth_token_url,
        oauth_token_encoding,
        long_lived_token_url,
        identity_probe_path
      from app_private.provider_runtime_config
      where provider_key = ${PROVIDER_KEY}
      limit 1
    `;
    return row ?? null;
  } catch {
    // The hosted adapter is optional. A portable/self-hosted deployment may use
    // the environment fallback and not have provider_runtime_config at all.
    return null;
  }
}

function buildApiConfig(hosted: HostedInstagramConfigRow | null): InstagramApiConfig {
  const graphBaseUrl = requiredConfiguredUrl(
    "Instagram Graph base URL",
    hosted?.graph_base_url,
    process.env.INSTAGRAM_GRAPH_BASE_URL
  );
  const apiVersion = requiredConfiguredValue(
    "Instagram Graph API version",
    hosted?.graph_api_version,
    process.env.INSTAGRAM_GRAPH_API_VERSION
  );
  const identityProbePathTemplate = optionalConfiguredValue(
    hosted?.identity_probe_path,
    process.env.INSTAGRAM_IDENTITY_PROBE_PATH
  );

  return {
    graphBaseUrl,
    apiVersion,
    ...(identityProbePathTemplate ? { identityProbePathTemplate } : {})
  };
}

function requiredConfiguredValue(
  label: string,
  hostedValue: string | null | undefined,
  fallbackValue: string | undefined
): string {
  const value = optionalConfiguredValue(hostedValue, fallbackValue);
  if (!value) throw new Error(`${label} is not configured.`);
  return value;
}

function optionalConfiguredValue(
  hostedValue: string | null | undefined,
  fallbackValue: string | undefined
): string | null {
  const hosted = hostedValue?.trim();
  if (hosted) return hosted;
  const fallback = fallbackValue?.trim();
  return fallback || null;
}

function requiredConfiguredUrl(
  label: string,
  hostedValue: string | null | undefined,
  fallbackValue: string | undefined
): string {
  return new URL(requiredConfiguredValue(label, hostedValue, fallbackValue)).toString();
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

function requiredUrlFromEnvironment(name: string): URL {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return new URL(value);
}

function requiredHttpsOrLocalUrl(value: string, label: string): URL {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`${label} must use HTTPS outside local development.`);
  }
  return url;
}

function parseEncoding(value: string | undefined | null): "multipart" | "urlencoded" {
  if (!value || value === "multipart") return "multipart";
  if (value === "urlencoded") return "urlencoded";
  throw new Error("Instagram OAuth token encoding must be multipart or urlencoded.");
}
