import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import postgres from "npm:postgres@3.4.9";

const PROVIDER_KEY = "instagram.meta.official";
const OAUTH_TTL_SECONDS = 600;
const LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments"
] as const;

interface MembershipRow {
  workspace_id: string;
  workspace_name: string;
  role: string;
}

interface ProviderConfigRow {
  app_id: string | null;
  oauth_authorize_url: string | null;
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, cors, { allow: "POST, OPTIONS" });
  }

  if (!originAllowed(request)) {
    return json({ error: "origin_not_allowed" }, 403, cors);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "authentication_required" }, 401, cors);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const publishableKey = defaultPublishableKey();
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL")?.trim();
  if (!supabaseUrl || !publishableKey || !databaseUrl) {
    return json({ error: "runtime_not_configured" }, 503, cors);
  }

  const token = authorization.slice("Bearer ".length).trim();
  const authClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
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

    const [config] = await sql<ProviderConfigRow[]>`
      select app_id, oauth_authorize_url
      from app_private.provider_runtime_config
      where provider_key = ${PROVIDER_KEY}
      limit 1
    `;

    const appId = config?.app_id?.trim() ?? "";
    const authorizeEndpoint = config?.oauth_authorize_url?.trim() ?? "";
    if (!appId || !authorizeEndpoint) {
      return json({ error: "instagram_oauth_configuration_incomplete" }, 409, cors);
    }

    let authorizationBase: URL;
    try {
      authorizationBase = new URL(authorizeEndpoint);
    } catch {
      return json({ error: "instagram_oauth_authorize_url_invalid" }, 503, cors);
    }
    if (authorizationBase.protocol !== "https:") {
      return json({ error: "instagram_oauth_authorize_url_invalid" }, 503, cors);
    }

    const state = randomState();
    const stateHash = await sha256Hex(state);
    const redirectUri = `${new URL(supabaseUrl).origin}/functions/v1/instagram-oauth-callback`;

    await sql.begin(async (tx) => {
      await tx`
        insert into app_private.oauth_sessions (
          workspace_id,
          initiated_by_user_id,
          provider,
          state_hash,
          redirect_after,
          expires_at
        ) values (
          ${membership.workspace_id},
          ${user.id},
          ${PROVIDER_KEY},
          ${stateHash},
          '/connections',
          now() + (${OAUTH_TTL_SECONDS} * interval '1 second')
        )
      `;

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
          'instagram.oauth.started',
          'provider_connection',
          ${PROVIDER_KEY},
          ${tx.json({
            source: "instagram-oauth-start",
            ttlSeconds: OAUTH_TTL_SECONDS,
            scopes: LOGIN_SCOPES,
            callbackKind: "supabase_edge"
          })}
        )
      `;
    });

    const authorizationUrl = new URL(authorizationBase);
    authorizationUrl.searchParams.set("client_id", appId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", LOGIN_SCOPES.join(","));
    authorizationUrl.searchParams.set("state", state);

    return json({
      authorizationUrl: authorizationUrl.toString(),
      expiresInSeconds: OAUTH_TTL_SECONDS
    }, 200, cors);
  } catch (error) {
    console.error("instagram-oauth-start failed", safeErrorCode(error));
    return json({ error: "instagram_oauth_start_unavailable" }, 503, cors);
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

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function defaultPublishableKey(): string | null {
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed.default;
      if (typeof value === "string" && value) return value;
    } catch {
      // Fall through to the hosted legacy public key while still available.
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
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, content-type",
    "cache-control": "no-store",
    "vary": "origin"
  };
}

function json(
  body: unknown,
  status: number,
  headers: HeadersInit,
  extraHeaders: HeadersInit = {}
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...headers,
      ...extraHeaders,
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN";
  return error.message.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 120) || "ERROR";
}
