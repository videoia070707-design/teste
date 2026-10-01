import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import postgres from "npm:postgres@3.4.9";

interface MembershipRow {
  workspace_id: string;
  workspace_name: string;
  role: string;
}

interface ReadinessRow {
  edge_runtime_fresh: boolean;
  app_id: boolean;
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

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (!originAllowed(request)) {
    return json({ error: "origin_not_allowed" }, 403, cors);
  }

  const url = new URL(request.url);
  if (request.method !== "GET" || !url.pathname.endsWith("/status")) {
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
    const [membership] = await sql<MembershipRow[]>`
      select
        membership.workspace_id,
        workspace.name as workspace_name,
        membership.role
      from app_private.workspace_members membership
      join app_private.workspaces workspace
        on workspace.id = membership.workspace_id
      where membership.user_id = ${user.id}
      order by membership.created_at asc
      limit 1
    `;

    if (!membership) {
      return json({ error: "workspace_required" }, 409, cors);
    }

    if (membership.role !== "owner" && membership.role !== "admin") {
      return json({ error: "admin_role_required" }, 403, cors);
    }

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
          where provider_key = 'instagram.meta.official'
            and nullif(btrim(app_id), '') is not null
        ) as app_id,
        app_private.get_platform_secret('meta_app_secret') is not null as meta_app_secret,
        app_private.get_platform_secret('meta_webhook_verify_token') is not null as webhook_verify_token,
        app_private.get_platform_secret('provider_secret_keyring') is not null as provider_keyring,
        exists (
          select 1
          from app_private.provider_runtime_config
          where provider_key = 'instagram.meta.official'
            and nullif(btrim(oauth_authorize_url), '') is not null
        ) as oauth_authorize,
        exists (
          select 1
          from app_private.provider_runtime_config
          where provider_key = 'instagram.meta.official'
            and nullif(btrim(oauth_token_url), '') is not null
        ) as oauth_token,
        exists (
          select 1
          from app_private.provider_runtime_config
          where provider_key = 'instagram.meta.official'
            and nullif(btrim(long_lived_token_url), '') is not null
        ) as long_lived_token,
        exists (
          select 1
          from app_private.provider_runtime_config
          where provider_key = 'instagram.meta.official'
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
            and connection.provider_key = 'instagram.meta.official'
            and connection.provider_mode = 'official'
            and connection.auth_valid = true
            and connection.external_account_id is not null
        ) as oauth_live,
        exists (
          select 1
          from app_private.raw_events raw
          where raw.workspace_id = ${membership.workspace_id}
            and raw.provider = 'instagram.meta.official'
            and raw.signature_valid = true
        ) as signed_webhook_live,
        exists (
          select 1
          from app_private.canonical_events event
          where event.workspace_id = ${membership.workspace_id}
            and event.provider = 'instagram.meta.official'
            and event.event_type = 'message.received'
        ) as inbound_live,
        exists (
          select 1
          from app_private.messages message
          join app_private.channel_connections connection
            on connection.id = message.connection_id
          where message.workspace_id = ${membership.workspace_id}
            and connection.provider_key = 'instagram.meta.official'
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
  } catch (error) {
    console.error("g3-control status failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "status_unavailable" }, 503, cors);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

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
    "access-control-allow-methods": "GET, OPTIONS",
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
