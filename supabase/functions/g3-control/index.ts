import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import postgres from "npm:postgres@3.4.9";

const PROVIDER_KEY = "instagram.meta.official";
const MAX_SETUP_BODY_BYTES = 16_384;

interface MembershipRow {
  workspace_id: string;
  workspace_name: string;
  role: string;
}

interface ReadinessRow {
  edge_runtime_fresh: boolean;
  app_id: boolean;
  graph_api_version_confirmed: boolean;
  meta_app_secret: boolean;
  webhook_verify_token: boolean;
  provider_keyring: boolean;
  oauth_authorize: boolean;
  oauth_token: boolean;
  long_lived_token: boolean;
  identity_probe: boolean;
  legal_entity: boolean;
  support_email: boolean;
  oauth_live: boolean;
  signed_webhook_live: boolean;
  inbound_live: boolean;
  outbound_live: boolean;
}

interface SetupInput {
  legalEntityName: string | null;
  supportEmail: string | null;
  appId: string | null;
  graphApiVersion: string | null;
  metaAppSecret: string | null;
  oauthAuthorizeUrl: string | null;
  oauthTokenUrl: string | null;
  oauthTokenEncoding: "multipart" | "urlencoded";
  longLivedTokenUrl: string | null;
  identityProbePath: string | null;
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (!originAllowed(request)) {
    return json({ error: "origin_not_allowed" }, 403, cors);
  }

  const url = new URL(request.url);
  const isStatus = request.method === "GET" && url.pathname.endsWith("/status");
  const isSetup = request.method === "POST" && url.pathname.endsWith("/setup");
  if (!isStatus && !isSetup) {
    return json({ error: "not_found" }, 404, cors);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "authentication_required" }, 401, cors);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = defaultPublishableKey();
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL");

  if (!supabaseUrl || !publishableKey || !databaseUrl) {
    return json({ error: "runtime_not_configured" }, 503, cors);
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const token = authorization.slice("Bearer ".length).trim();
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) {
    return json({ error: "authentication_invalid" }, 401, cors);
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 5,
    connect_timeout: 10
  });

  try {
    const membership = await ensureWorkspaceMembership(sql, user.id);

    if (membership.role !== "owner" && membership.role !== "admin") {
      return json({ error: "admin_role_required" }, 403, cors);
    }

    if (isSetup) {
      const inputResult = await parseSetupRequest(request);
      if (!inputResult.ok) return json({ error: inputResult.error }, 400, cors);
      const input = inputResult.value;

      await sql.begin(async (tx) => {
        await tx`select app_private.set_platform_public_config('legal_entity_name', ${input.legalEntityName})`;
        await tx`select app_private.set_platform_public_config('support_email', ${input.supportEmail})`;
        await tx`select app_private.set_instagram_platform_config(
          ${input.appId},
          ${input.graphApiVersion},
          ${input.oauthAuthorizeUrl},
          ${input.oauthTokenUrl},
          ${input.oauthTokenEncoding},
          ${input.longLivedTokenUrl},
          ${input.identityProbePath}
        )`;

        if (input.metaAppSecret !== null) {
          await tx`select app_private.set_meta_app_secret(${input.metaAppSecret})`;
        }

        await tx`
          insert into app_private.audit_logs (
            workspace_id,
            actor_user_id,
            action,
            resource_type,
            resource_id,
            metadata
          ) values (
            ${membership.workspace_id},
            ${user.id},
            'platform.setup.edge.updated',
            'platform_configuration',
            ${PROVIDER_KEY},
            ${tx.json({
              source: "g3-control",
              fields: [
                "legal_entity_name",
                "support_email",
                "app_id",
                "graph_api_version",
                "oauth_authorize_url",
                "oauth_token_url",
                "oauth_token_encoding",
                "long_lived_token_url",
                "identity_probe_path"
              ],
              secretFieldsChanged: input.metaAppSecret !== null ? ["meta_app_secret"] : [],
              secretsChanged: input.metaAppSecret !== null
            })}
          )
        `;
      });

      return json({
        updated: true,
        workspace: {
          id: membership.workspace_id,
          name: membership.workspace_name,
          role: membership.role
        },
        metaAppSecretChanged: input.metaAppSecret !== null,
        graphApiVersionConfirmed: input.graphApiVersion !== null
      }, 200, cors);
    }

    return await buildStatus(sql, membership, cors);
  } catch (error) {
    console.error("g3-control request failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "control_plane_unavailable" }, 503, cors);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

async function ensureWorkspaceMembership(
  sql: ReturnType<typeof postgres>,
  userId: string
): Promise<MembershipRow> {
  return await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;

    const [existing] = await tx<MembershipRow[]>`
      select
        membership.workspace_id,
        workspace.name as workspace_name,
        membership.role
      from app_private.workspace_members membership
      join app_private.workspaces workspace
        on workspace.id = membership.workspace_id
      where membership.user_id = ${userId}
      order by membership.created_at asc, membership.workspace_id asc
      limit 1
    `;

    if (existing) return existing;

    const [workspace] = await tx<{ id: string; name: string }[]>`
      insert into app_private.workspaces (name)
      values ('Meu Workspace')
      returning id, name
    `;

    if (!workspace) throw new Error("WORKSPACE_BOOTSTRAP_FAILED");

    await tx`
      insert into app_private.workspace_members (workspace_id, user_id, role)
      values (${workspace.id}, ${userId}, 'owner')
    `;

    return {
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      role: "owner"
    };
  });
}

async function buildStatus(
  sql: ReturnType<typeof postgres>,
  membership: MembershipRow,
  cors: HeadersInit
): Promise<Response> {
  const [state] = await sql<ReadinessRow[]>`
    select
      exists (
        select 1
        from app_private.worker_heartbeats
        where coalesce(worker_kind, service) = 'supabase_g3_runtime'
          and last_seen_at >= now() - interval '45 seconds'
      ) as edge_runtime_fresh,
      exists (
        select 1
        from app_private.provider_runtime_config
        where provider_key = ${PROVIDER_KEY}
          and nullif(btrim(app_id), '') is not null
      ) as app_id,
      exists (
        select 1
        from app_private.provider_runtime_config
        where provider_key = ${PROVIDER_KEY}
          and nullif(btrim(graph_api_version), '') is not null
          and graph_api_version_confirmed_at is not null
      ) as graph_api_version_confirmed,
      app_private.get_platform_secret('meta_app_secret') is not null as meta_app_secret,
      app_private.get_platform_secret('meta_webhook_verify_token') is not null as webhook_verify_token,
      app_private.get_platform_secret('provider_secret_keyring') is not null as provider_keyring,
      exists (
        select 1
        from app_private.provider_runtime_config
        where provider_key = ${PROVIDER_KEY}
          and nullif(btrim(oauth_authorize_url), '') is not null
      ) as oauth_authorize,
      exists (
        select 1
        from app_private.provider_runtime_config
        where provider_key = ${PROVIDER_KEY}
          and nullif(btrim(oauth_token_url), '') is not null
      ) as oauth_token,
      exists (
        select 1
        from app_private.provider_runtime_config
        where provider_key = ${PROVIDER_KEY}
          and nullif(btrim(long_lived_token_url), '') is not null
      ) as long_lived_token,
      exists (
        select 1
        from app_private.provider_runtime_config
        where provider_key = ${PROVIDER_KEY}
          and nullif(btrim(identity_probe_path), '') is not null
      ) as identity_probe,
      exists (
        select 1
        from app_private.platform_public_config
        where config_key = 'legal_entity_name'
          and nullif(btrim(config_value), '') is not null
      ) as legal_entity,
      exists (
        select 1
        from app_private.platform_public_config
        where config_key = 'support_email'
          and nullif(btrim(config_value), '') is not null
      ) as support_email,
      exists (
        select 1
        from app_private.channel_connections connection
        join app_private.connection_secret_refs secret_ref
          on secret_ref.connection_id = connection.id
        where connection.workspace_id = ${membership.workspace_id}
          and connection.provider_key = ${PROVIDER_KEY}
          and connection.provider_mode = 'official'
          and connection.auth_valid = true
          and connection.external_account_id is not null
      ) as oauth_live,
      exists (
        select 1
        from app_private.raw_events raw
        where raw.workspace_id = ${membership.workspace_id}
          and raw.provider = ${PROVIDER_KEY}
          and raw.signature_valid = true
      ) as signed_webhook_live,
      exists (
        select 1
        from app_private.canonical_events event
        where event.workspace_id = ${membership.workspace_id}
          and event.provider = ${PROVIDER_KEY}
          and event.event_type = 'message.received'
      ) as inbound_live,
      exists (
        select 1
        from app_private.messages message
        join app_private.channel_connections connection
          on connection.id = message.connection_id
        where message.workspace_id = ${membership.workspace_id}
          and connection.provider_key = ${PROVIDER_KEY}
          and connection.provider_mode = 'official'
          and message.direction = 'outbound'
          and message.message_type = 'text'
          and message.delivery_state in ('SENT', 'DELIVERED', 'READ')
          and message.provider_message_id is not null
      ) as outbound_live
  `;

  if (!state) return json({ error: "status_unavailable" }, 503, cors);

  const configurationReady = state.edge_runtime_fresh
    && state.app_id
    && state.graph_api_version_confirmed
    && state.meta_app_secret
    && state.webhook_verify_token
    && state.provider_keyring
    && state.oauth_authorize
    && state.oauth_token
    && state.long_lived_token
    && state.identity_probe
    && state.legal_entity
    && state.support_email;

  const hostPass = state.oauth_live && state.inbound_live && state.outbound_live;

  return json({
    workspace: {
      id: membership.workspace_id,
      name: membership.workspace_name,
      role: membership.role
    },
    configurationReady,
    hostPass,
    configuration: {
      edgeRuntime: state.edge_runtime_fresh,
      metaAppId: state.app_id,
      graphApiVersion: state.graph_api_version_confirmed,
      metaAppSecret: state.meta_app_secret,
      webhookVerifyToken: state.webhook_verify_token,
      providerKeyring: state.provider_keyring,
      oauthAuthorizeUrl: state.oauth_authorize,
      oauthTokenUrl: state.oauth_token,
      longLivedTokenUrl: state.long_lived_token,
      identityProbe: state.identity_probe,
      legalEntity: state.legal_entity,
      supportEmail: state.support_email
    },
    liveEvidence: {
      oauth: state.oauth_live,
      signedWebhook: state.signed_webhook_live,
      inboundMessage: state.inbound_live,
      outboundMessage: state.outbound_live
    }
  }, 200, cors);
}

async function parseSetupRequest(request: Request): Promise<
  | { ok: true; value: SetupInput }
  | { ok: false; error: string }
> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return { ok: false, error: "json_content_type_required" };
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_SETUP_BODY_BYTES) {
    return { ok: false, error: "request_too_large" };
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_SETUP_BODY_BYTES) {
      return { ok: false, error: "request_too_large" };
    }
    body = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: "invalid_json_body" };
  }

  if (!isRecord(body)) return { ok: false, error: "invalid_json_body" };

  try {
    return {
      ok: true,
      value: {
        legalEntityName: optionalString(body.legalEntityName, 200),
        supportEmail: optionalEmail(body.supportEmail),
        appId: optionalPattern(body.appId, /^[0-9]{4,40}$/),
        graphApiVersion: optionalPattern(body.graphApiVersion, /^v[0-9]{1,3}\.[0-9]{1,3}$/),
        metaAppSecret: optionalSecret(body.metaAppSecret),
        oauthAuthorizeUrl: optionalHttpsUrl(body.oauthAuthorizeUrl),
        oauthTokenUrl: optionalHttpsUrl(body.oauthTokenUrl),
        oauthTokenEncoding: tokenEncoding(body.oauthTokenEncoding),
        longLivedTokenUrl: optionalHttpsUrl(body.longLivedTokenUrl),
        identityProbePath: optionalProbePath(body.identityProbePath)
      }
    };
  } catch (error) {
    return { ok: false, error: validationCode(error) };
  }
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("FIELD_FORMAT_INVALID");
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error("FIELD_TOO_LONG");
  return normalized;
}

function optionalEmail(value: unknown): string | null {
  const normalized = optionalString(value, 320);
  if (normalized === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("SUPPORT_EMAIL_INVALID");
  return normalized;
}

function optionalPattern(value: unknown, pattern: RegExp): string | null {
  const normalized = optionalString(value, 200);
  if (normalized === null) return null;
  if (!pattern.test(normalized)) throw new Error("FIELD_FORMAT_INVALID");
  return normalized;
}

function optionalSecret(value: unknown): string | null {
  const normalized = optionalString(value, 512);
  if (normalized === null) return null;
  if (normalized.length < 16) throw new Error("META_APP_SECRET_INVALID_LENGTH");
  return normalized;
}

function optionalHttpsUrl(value: unknown): string | null {
  const normalized = optionalString(value, 2_000);
  if (normalized === null) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("URL_INVALID");
  }
  if (url.protocol !== "https:") throw new Error("HTTPS_URL_REQUIRED");
  return url.toString();
}

function tokenEncoding(value: unknown): "multipart" | "urlencoded" {
  if (value === undefined || value === null || value === "" || value === "multipart") return "multipart";
  if (value === "urlencoded") return "urlencoded";
  throw new Error("OAUTH_TOKEN_ENCODING_INVALID");
}

function optionalProbePath(value: unknown): string | null {
  const normalized = optionalString(value, 500);
  if (normalized === null) return null;
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes("\\")) {
    throw new Error("IDENTITY_PROBE_PATH_INVALID");
  }
  return normalized;
}

function validationCode(error: unknown): string {
  if (!(error instanceof Error)) return "INVALID_CONFIGURATION";
  const code = error.message.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  return code || "INVALID_CONFIGURATION";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultPublishableKey(): string | null {
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed.default;
      if (typeof value === "string" && value) return value;
    } catch {
      // Fall through to the legacy public key while hosted projects still expose it.
    }
  }

  return Deno.env.get("SUPABASE_ANON_KEY") ?? null;
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const url = new URL(origin);
    return url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  } catch {
    return false;
  }
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const allowed = origin && originAllowed(request) ? origin : "null";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, content-type",
    "cache-control": "no-store",
    "vary": "origin"
  };
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      ...headers,
      "content-type": "application/json; charset=utf-8"
    }
  });
}
