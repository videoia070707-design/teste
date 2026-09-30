import { createHmac, timingSafeEqual } from "node:crypto";
import type { ConnectionId } from "@automation/core";
import {
  deriveConnectionHealth,
  type CapabilityDescriptor,
  type ChannelProvider,
  type ConnectionHealthSnapshot,
  type ProviderConnection,
  type ProviderSendResult,
  type SendTextInput
} from "@automation/providers";

export * from "./webhooks";

export const INSTAGRAM_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments"
] as const;

export const INSTAGRAM_OPTIONAL_SCOPES = [
  "instagram_business_content_publish"
] as const;

const CAPABILITIES: readonly CapabilityDescriptor[] = [
  { key: "messages.receive", state: "available" },
  { key: "messages.send", state: "available" },
  { key: "comments.receive", state: "available" },
  { key: "comments.reply", state: "available" },
  { key: "stories.reply", state: "available" },
  {
    key: "content.publish",
    state: "unavailable",
    reason: "Content publishing is not implemented in G3, so its OAuth permission is not requested yet."
  }
];

export interface InstagramCredentials {
  accessToken: string;
  igUserId: string;
}

export interface InstagramCredentialResolver {
  resolve(connectionId: ConnectionId): Promise<InstagramCredentials | null>;
}

export interface InstagramOfficialProviderConfig {
  graphBaseUrl: string;
  apiVersion: string;
  requestTimeoutMs?: number;
  /**
   * Optional probe path template. Keeping this configurable prevents a Graph
   * version or identity-probe change from requiring a domain rewrite.
   * Supported placeholders: {api_version}, {ig_user_id}.
   */
  identityProbePathTemplate?: string;
}

export interface InstagramOAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Instagram auth products have changed transport details over time. */
  tokenRequestEncoding: "multipart" | "urlencoded";
}

export interface InstagramCommentReplyInput {
  connectionId: ConnectionId;
  commentId: string;
  text: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface InstagramCommentPrivateReplyInput {
  connectionId: ConnectionId;
  commentId: string;
  text: string;
  idempotencyKey: string;
  correlationId: string;
}

interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface InstagramSendResponse extends MetaErrorBody {
  recipient_id?: string;
  message_id?: string;
}

interface InstagramCommentReplyResponse extends MetaErrorBody {
  id?: string;
}

export class InstagramOfficialProvider implements ChannelProvider {
  readonly key = "instagram.meta.official";
  readonly channel = "instagram" as const;
  readonly mode = "official" as const;

  private readonly requestTimeoutMs: number;

  constructor(
    private readonly config: InstagramOfficialProviderConfig,
    private readonly credentials: InstagramCredentialResolver,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
  }

  async getCapabilities(_connection: ProviderConnection): Promise<CapabilityDescriptor[]> {
    return CAPABILITIES.map((capability) => ({ ...capability }));
  }

  async verifyConnection(connection: ProviderConnection): Promise<ConnectionHealthSnapshot> {
    const checkedAt = new Date().toISOString();
    const capabilities = await this.getCapabilities(connection);
    const credentials = await this.credentials.resolve(connection.id);

    if (!credentials) {
      return {
        state: "AUTH_EXPIRED",
        checkedAt,
        authValid: false,
        webhookHealthy: null,
        capabilities,
        diagnostics: ["No server-side Instagram credentials are available for this connection."]
      };
    }

    if (!this.config.identityProbePathTemplate) {
      return {
        state: "STALE",
        checkedAt,
        authValid: true,
        webhookHealthy: null,
        capabilities,
        diagnostics: [
          "Credentials are present, but the provider identity probe is not configured.",
          "Webhook health is unknown until a verified event is observed."
        ]
      };
    }

    const path = this.config.identityProbePathTemplate
      .replaceAll("{api_version}", encodeURIComponent(this.config.apiVersion))
      .replaceAll("{ig_user_id}", encodeURIComponent(credentials.igUserId));

    try {
      const response = await this.fetchWithTimeout(new URL(path, ensureTrailingSlash(this.config.graphBaseUrl)), {
        method: "GET",
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          accept: "application/json"
        }
      });

      if (response.status === 401 || response.status === 403) {
        return {
          state: "AUTH_EXPIRED",
          checkedAt,
          authValid: false,
          webhookHealthy: null,
          capabilities,
          diagnostics: [`Provider rejected credentials with HTTP ${response.status}.`]
        };
      }

      if (!response.ok) {
        return {
          state: response.status >= 500 ? "DISCONNECTED" : "DEGRADED_PARTIAL",
          checkedAt,
          authValid: true,
          webhookHealthy: null,
          capabilities,
          diagnostics: [`Instagram identity probe returned HTTP ${response.status}.`]
        };
      }

      const state = deriveConnectionHealth({
        authValid: true,
        providerReachable: true,
        recentlyVerified: true,
        webhookHealthy: null,
        capabilities
      });

      return {
        state,
        checkedAt,
        authValid: true,
        webhookHealthy: null,
        capabilities,
        diagnostics: [
          "Instagram API identity probe succeeded.",
          "Webhook health remains unknown until webhook evidence is recorded."
        ]
      };
    } catch (error) {
      return {
        state: "DISCONNECTED",
        checkedAt,
        authValid: true,
        webhookHealthy: null,
        capabilities,
        diagnostics: [error instanceof Error ? error.message : "Instagram identity probe failed."]
      };
    }
  }

  async sendText(input: SendTextInput): Promise<ProviderSendResult> {
    const credentials = await this.credentials.resolve(input.connectionId);
    if (!credentials) return missingCredentials();

    const url = new URL(
      `${encodeURIComponent(this.config.apiVersion)}/${encodeURIComponent(credentials.igUserId)}/messages`,
      ensureTrailingSlash(this.config.graphBaseUrl)
    );

    return this.postMutation({
      url,
      accessToken: credentials.accessToken,
      body: {
        recipient: { id: input.recipientExternalId },
        message: { text: input.text }
      },
      operationName: "Instagram Send API",
      extractSuccessId: (body) => isRecord(body) && typeof body.message_id === "string" ? body.message_id : undefined
    });
  }

  async replyToComment(input: InstagramCommentReplyInput): Promise<ProviderSendResult> {
    const credentials = await this.credentials.resolve(input.connectionId);
    if (!credentials) return missingCredentials();

    const url = new URL(
      `${encodeURIComponent(this.config.apiVersion)}/${encodeURIComponent(input.commentId)}/replies`,
      ensureTrailingSlash(this.config.graphBaseUrl)
    );

    return this.postMutation({
      url,
      accessToken: credentials.accessToken,
      body: { message: input.text },
      operationName: "Instagram Comment Reply API",
      extractSuccessId: (body) => isRecord(body) && typeof body.id === "string" ? body.id : undefined
    });
  }

  async privateReplyToComment(input: InstagramCommentPrivateReplyInput): Promise<ProviderSendResult> {
    const credentials = await this.credentials.resolve(input.connectionId);
    if (!credentials) return missingCredentials();

    const url = new URL(
      `${encodeURIComponent(this.config.apiVersion)}/${encodeURIComponent(credentials.igUserId)}/messages`,
      ensureTrailingSlash(this.config.graphBaseUrl)
    );

    return this.postMutation({
      url,
      accessToken: credentials.accessToken,
      body: {
        recipient: { comment_id: input.commentId },
        message: { text: input.text }
      },
      operationName: "Instagram Comment Private Reply API",
      extractSuccessId: (body) => isRecord(body) && typeof body.message_id === "string" ? body.message_id : undefined
    });
  }

  async reconcileSend(): Promise<ProviderSendResult> {
    return {
      kind: "unknown",
      reason: "ambiguous_provider_response",
      reconciliationHint: "No blind idempotent replay is declared for Instagram mutations. Await webhook/provider evidence or operator review."
    };
  }

  private async postMutation(input: {
    url: URL;
    accessToken: string;
    body: unknown;
    operationName: string;
    extractSuccessId: (body: unknown) => string | undefined;
  }): Promise<ProviderSendResult> {
    try {
      const response = await this.fetchWithTimeout(input.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(input.body)
      });

      const body = await readJsonSafely<MetaErrorBody & Record<string, unknown>>(response);

      if (response.ok) {
        const successId = input.extractSuccessId(body);
        if (!successId) {
          return {
            kind: "unknown",
            reason: "ambiguous_provider_response",
            reconciliationHint: `${input.operationName} returned success without a provider object/message id. Do not retry blindly.`
          };
        }

        return {
          kind: "accepted",
          providerMessageId: successId,
          acceptedAt: new Date().toISOString()
        };
      }

      const message = body?.error?.message ?? `${input.operationName} returned HTTP ${response.status}.`;
      const code = body?.error?.code ? String(body.error.code) : `HTTP_${response.status}`;

      if (response.status >= 500) {
        return {
          kind: "unknown",
          reason: "ambiguous_provider_response",
          reconciliationHint: `Provider returned HTTP ${response.status}; side-effect outcome is not assumed.`
        };
      }

      return {
        kind: "rejected",
        code,
        message,
        retryable: response.status === 429
      };
    } catch (error) {
      if (isAbortError(error)) {
        return {
          kind: "unknown",
          reason: "timeout",
          reconciliationHint: "Request timeout occurred after dispatch; reconcile before retrying."
        };
      }

      return {
        kind: "unknown",
        reason: "transport_closed",
        reconciliationHint: "Transport failed after dispatch; reconcile before retrying."
      };
    }
  }

  private async fetchWithTimeout(input: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

export function buildInstagramAuthorizationUrl(
  config: Pick<InstagramOAuthConfig, "authorizationEndpoint" | "clientId" | "redirectUri">,
  state: string
): URL {
  if (!state.trim()) throw new Error("OAuth state is required.");

  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_LOGIN_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeInstagramAuthorizationCode(
  config: InstagramOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  if (!code.trim()) throw new Error("Authorization code is required.");

  const fields = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code
  };

  let body: BodyInit;
  const headers: Record<string, string> = { accept: "application/json" };

  if (config.tokenRequestEncoding === "multipart") {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    body = form;
  } else {
    body = new URLSearchParams(fields);
    headers["content-type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetchImpl(config.tokenEndpoint, {
    method: "POST",
    headers,
    body
  });

  const payload = await readJsonSafely<Record<string, unknown>>(response);
  if (!response.ok || !payload) {
    throw new Error(`Instagram OAuth token exchange failed with HTTP ${response.status}.`);
  }
  return payload;
}

export function verifyWebhookChallenge(input: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
  expectedToken: string;
}): string | null {
  if (input.mode !== "subscribe") return null;
  if (!input.token || !constantTimeEqual(input.token, input.expectedToken)) return null;
  return input.challenge;
}

export function verifyHmacSha256Signature(rawBody: Uint8Array | string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const [algorithm, providedHex] = signature.split("=", 2);
  if (algorithm !== "sha256" || !providedHex) return false;

  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  return constantTimeEqual(providedHex.toLowerCase(), expectedHex.toLowerCase());
}

function missingCredentials(): ProviderSendResult {
  return {
    kind: "rejected",
    code: "AUTH_CREDENTIALS_MISSING",
    message: "Instagram credentials are unavailable for this connection.",
    retryable: false
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function readJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
