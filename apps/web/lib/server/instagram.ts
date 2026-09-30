import "server-only";
import type { InstagramOAuthConfig } from "@automation/provider-instagram-official";

export interface InstagramServerConfig {
  oauth: InstagramOAuthConfig;
  longLivedTokenEndpoint: string;
  graphBaseUrl: string;
  apiVersion: string;
  identityProbePathTemplate?: string;
}

export function getInstagramServerConfig(): InstagramServerConfig {
  const origin = requiredUrl("APP_ORIGIN").origin;
  const authorizationEndpoint = requiredUrl("INSTAGRAM_OAUTH_AUTHORIZE_URL").toString();
  const tokenEndpoint = requiredUrl("INSTAGRAM_OAUTH_TOKEN_URL").toString();
  const longLivedTokenEndpoint = requiredUrl("INSTAGRAM_LONG_LIVED_TOKEN_URL").toString();
  const graphBaseUrl = requiredUrl("INSTAGRAM_GRAPH_BASE_URL").toString();
  const apiVersion = required("INSTAGRAM_GRAPH_API_VERSION");
  const clientId = required("META_APP_ID");
  const clientSecret = required("META_APP_SECRET");
  const tokenRequestEncoding = parseEncoding(process.env.INSTAGRAM_OAUTH_TOKEN_ENCODING);

  return {
    oauth: {
      authorizationEndpoint,
      tokenEndpoint,
      clientId,
      clientSecret,
      redirectUri: `${origin}/api/connections/instagram/callback`,
      tokenRequestEncoding
    },
    longLivedTokenEndpoint,
    graphBaseUrl,
    apiVersion,
    ...(process.env.INSTAGRAM_IDENTITY_PROBE_PATH
      ? { identityProbePathTemplate: process.env.INSTAGRAM_IDENTITY_PROBE_PATH }
      : {})
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function requiredUrl(name: string): URL {
  return new URL(required(name));
}

function parseEncoding(value: string | undefined): "multipart" | "urlencoded" {
  if (!value || value === "multipart") return "multipart";
  if (value === "urlencoded") return "urlencoded";
  throw new Error("INSTAGRAM_OAUTH_TOKEN_ENCODING must be multipart or urlencoded.");
}
