import postgres from "npm:postgres@3.4.9";

const PROVIDER_KEY = "instagram.meta.official";
const SECRET_PURPOSE = "instagram.credentials";
const SECRET_STORE = "postgres-aesgcm-v1";
const LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments"
] as const;
const encoder = new TextEncoder();

interface OAuthSessionRow {
  workspace_id: string;
  initiated_by_user_id: string;
}

interface ProviderConfigRow {
  app_id: string | null;
  oauth_token_url: string | null;
  oauth_token_encoding: string | null;
  long_lived_token_url: string | null;
}

interface TokenCandidate {
  accessToken: string;
  userId: string;
}

interface LongLivedToken {
  accessToken: string;
  expiresInSeconds?: number;
}

interface StoredKeyring {
  currentVersion: string;
  key: Uint8Array;
}

interface EncryptedEnvelope {
  id: string;
  keyVersion: string;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  authTag: Uint8Array;
  aad: string;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
  }

  const databaseUrl = Deno.env.get("SUPABASE_DB_URL")?.trim();
  if (!databaseUrl) return statusPage("OAuth unavailable", "Database unavailable.", 503);

  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get("state")?.trim() ?? "";
  const code = requestUrl.searchParams.get("code")?.trim() ?? "";
  const providerError = requestUrl.searchParams.get("error")?.trim() ?? "";

  if (state.length < 32 || state.length > 1024) {
    return statusPage("Invalid OAuth state", "The authorization state is invalid or missing.", 400);
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 10
  });

  try {
    const stateHash = await sha256Hex(encoder.encode(state));
    const session = await consumeState(sql, stateHash);
    if (!session) {
      return statusPage("OAuth state expired", "This authorization state is invalid, expired, or already used.", 400);
    }

    if (providerError) {
      return statusPage("Authorization cancelled", "Instagram authorization was not completed. Start the connection flow again when ready.", 400);
    }
    if (!code) {
      return statusPage("Authorization code missing", "Instagram did not return an authorization code.", 400);
    }

    const config = await loadProviderConfig(sql);
    const appSecret = await loadVaultSecret(sql, "meta_app_secret");
    const keyringRaw = await loadVaultSecret(sql, "provider_secret_keyring");

    if (!config.app_id || !config.oauth_token_url || !config.long_lived_token_url || !appSecret || !keyringRaw) {
      return statusPage("OAuth configuration incomplete", "The platform is not ready to exchange Instagram credentials yet.", 503);
    }

    const tokenEncoding = config.oauth_token_encoding === "urlencoded" ? "urlencoded" : "multipart";
    const redirectUri = `${requestUrl.origin}/functions/v1/instagram-oauth-callback`;
    const authorizationPayload = await exchangeAuthorizationCode({
      endpoint: config.oauth_token_url,
      encoding: tokenEncoding,
      clientId: config.app_id,
      clientSecret: appSecret,
      redirectUri,
      code
    });
    const shortLived = parseAuthorizationToken(authorizationPayload);
    const longLived = await exchangeLongLivedToken({
      endpoint: config.long_lived_token_url,
      clientSecret: appSecret,
      shortLivedAccessToken: shortLived.accessToken
    });

    const obtainedAt = new Date();
    const expiresAt = longLived.expiresInSeconds !== undefined
      ? new Date(obtainedAt.getTime() + longLived.expiresInSeconds * 1000).toISOString()
      : null;

    const credential = JSON.stringify({
      schemaVersion: 1,
      tokenKind: "long_lived",
      accessToken: longLived.accessToken,
      igUserId: shortLived.userId,
      obtainedAt: obtainedAt.toISOString(),
      expiresAt
    });

    const keyring = parseKeyring(keyringRaw);
    const envelope = await encryptCredential({
      workspaceId: session.workspace_id,
      purpose: SECRET_PURPOSE,
      plaintext: credential,
      keyring
    });

    const connectionId = await persistConnection(sql, {
      workspaceId: session.workspace_id,
      actorUserId: session.initiated_by_user_id,
      externalAccountId: shortLived.userId,
      envelope
    });

    return statusPage(
      "Instagram conectado",
      `A credencial oficial foi armazenada com criptografia e vinculada à conexão ${shortId(connectionId)}. Você pode voltar ao dashboard.`,
      200
    );
  } catch (error) {
    console.error("instagram-oauth-callback failed", safeErrorCode(error));
    return statusPage("OAuth failed", "A conexão não pôde ser concluída. Inicie um novo fluxo de autorização.", 503);
  } finally {
    await sql.end({ timeout: 3 });
  }
});

async function consumeState(
  sql: ReturnType<typeof postgres>,
  stateHash: string
): Promise<OAuthSessionRow | null> {
  const [row] = await sql<OAuthSessionRow[]>`
    update app_private.oauth_sessions
    set consumed_at = now()
    where provider = ${PROVIDER_KEY}
      and state_hash = ${stateHash}
      and consumed_at is null
      and expires_at > now()
    returning workspace_id, initiated_by_user_id
  `;
  return row ?? null;
}

async function loadProviderConfig(sql: ReturnType<typeof postgres>): Promise<ProviderConfigRow> {
  const [row] = await sql<ProviderConfigRow[]>`
    select app_id, oauth_token_url, oauth_token_encoding, long_lived_token_url
    from app_private.provider_runtime_config
    where provider_key = ${PROVIDER_KEY}
    limit 1
  `;
  return row ?? {
    app_id: null,
    oauth_token_url: null,
    oauth_token_encoding: null,
    long_lived_token_url: null
  };
}

async function loadVaultSecret(sql: ReturnType<typeof postgres>, name: string): Promise<string | null> {
  const [row] = await sql<{ decrypted_secret: string }[]>`
    select decrypted_secret
    from vault.decrypted_secrets
    where name = ${name}
    order by created_at desc
    limit 1
  `;
  return row?.decrypted_secret?.trim() || null;
}

async function exchangeAuthorizationCode(input: {
  endpoint: string;
  encoding: "multipart" | "urlencoded";
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<unknown> {
  const fields = {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    code: input.code
  };

  let body: BodyInit;
  const headers: Record<string, string> = { accept: "application/json" };
  if (input.encoding === "multipart") {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    body = form;
  } else {
    body = new URLSearchParams(fields);
    headers["content-type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetch(input.endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000)
  });
  const payload = await readJsonSafely(response);
  if (!response.ok || payload === null) {
    throw new Error(`INSTAGRAM_OAUTH_TOKEN_HTTP_${response.status}`);
  }
  return payload;
}

function parseAuthorizationToken(payload: unknown): TokenCandidate {
  if (!isRecord(payload)) throw new Error("INSTAGRAM_OAUTH_RESPONSE_INVALID");

  const candidates: TokenCandidate[] = [];
  const top = parseTokenCandidate(payload);
  if (top) candidates.push(top);
  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      const candidate = parseTokenCandidate(item);
      if (candidate) candidates.push(candidate);
    }
  }

  if (candidates.length !== 1) throw new Error("INSTAGRAM_OAUTH_TOKEN_CANDIDATE_COUNT");
  const candidate = candidates[0];
  if (!candidate) throw new Error("INSTAGRAM_OAUTH_TOKEN_MISSING");
  return candidate;
}

function parseTokenCandidate(value: unknown): TokenCandidate | null {
  if (!isRecord(value)) return null;
  const accessToken = typeof value.access_token === "string" ? value.access_token.trim() : "";
  const userId = parseProviderId(value.user_id);
  if (!accessToken || !userId) return null;
  return { accessToken, userId };
}

async function exchangeLongLivedToken(input: {
  endpoint: string;
  clientSecret: string;
  shortLivedAccessToken: string;
}): Promise<LongLivedToken> {
  const url = new URL(input.endpoint);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", input.clientSecret);
  url.searchParams.set("access_token", input.shortLivedAccessToken);

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  const payload = await readJsonSafely(response);
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`INSTAGRAM_LONG_LIVED_TOKEN_HTTP_${response.status}`);
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!accessToken) throw new Error("INSTAGRAM_LONG_LIVED_TOKEN_MISSING");
  const expiresInSeconds = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
    ? payload.expires_in
    : undefined;

  return {
    accessToken,
    ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {})
  };
}

function parseKeyring(raw: string): StoredKeyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("PROVIDER_KEYRING_INVALID_JSON");
  }
  if (!isRecord(parsed) || typeof parsed.currentVersion !== "string" || !isRecord(parsed.keys)) {
    throw new Error("PROVIDER_KEYRING_INVALID");
  }
  const encoded = parsed.keys[parsed.currentVersion];
  if (typeof encoded !== "string") throw new Error("PROVIDER_KEYRING_CURRENT_KEY_MISSING");
  const key = decodeBase64(encoded);
  if (key.byteLength !== 32) throw new Error("PROVIDER_KEYRING_KEY_LENGTH");
  return { currentVersion: parsed.currentVersion, key };
}

async function encryptCredential(input: {
  workspaceId: string;
  purpose: string;
  plaintext: string;
  keyring: StoredKeyring;
}): Promise<EncryptedEnvelope> {
  const id = crypto.randomUUID();
  const aad = `automation-secret:v1:${input.workspaceId}:${input.purpose}:${id}`;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    input.keyring.key,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(aad),
      tagLength: 128
    },
    key,
    encoder.encode(input.plaintext)
  ));
  if (encrypted.byteLength < 16) throw new Error("AES_GCM_OUTPUT_INVALID");
  const ciphertext = encrypted.slice(0, encrypted.byteLength - 16);
  const authTag = encrypted.slice(encrypted.byteLength - 16);
  return {
    id,
    keyVersion: input.keyring.currentVersion,
    iv,
    ciphertext,
    authTag,
    aad
  };
}

async function persistConnection(
  sql: ReturnType<typeof postgres>,
  input: {
    workspaceId: string;
    actorUserId: string;
    externalAccountId: string;
    envelope: EncryptedEnvelope;
  }
): Promise<string> {
  return sql.begin(async (tx) => {
    const [connection] = await tx<{ id: string }[]>`
      insert into app_private.channel_connections (
        workspace_id,
        channel,
        provider_key,
        provider_mode,
        external_account_id,
        health_state,
        auth_valid,
        webhook_healthy,
        last_verified_at,
        updated_at
      ) values (
        ${input.workspaceId},
        'instagram',
        ${PROVIDER_KEY},
        'official',
        ${input.externalAccountId},
        'AUTH_EXPIRED',
        false,
        null,
        null,
        now()
      )
      on conflict (workspace_id, provider_key, external_account_id)
        where external_account_id is not null
      do update set
        channel = excluded.channel,
        provider_mode = excluded.provider_mode,
        health_state = 'AUTH_EXPIRED',
        auth_valid = false,
        webhook_healthy = null,
        last_verified_at = null,
        updated_at = now()
      returning id
    `;
    if (!connection) throw new Error("CONNECTION_UPSERT_FAILED");

    const [previous] = await tx<{ secret_ref: string }[]>`
      select secret_ref
      from app_private.connection_secret_refs
      where connection_id = ${connection.id}
      limit 1
    `;

    await tx`
      insert into app_private.secret_envelopes (
        id,
        workspace_id,
        purpose,
        algorithm,
        key_version,
        iv,
        ciphertext,
        auth_tag,
        aad
      ) values (
        ${input.envelope.id},
        ${input.workspaceId},
        ${SECRET_PURPOSE},
        'aes-256-gcm',
        ${input.envelope.keyVersion},
        ${input.envelope.iv},
        ${input.envelope.ciphertext},
        ${input.envelope.authTag},
        ${input.envelope.aad}
      )
    `;

    await tx`
      insert into app_private.connection_secret_refs (
        connection_id,
        secret_store,
        secret_ref,
        key_version
      ) values (
        ${connection.id},
        ${SECRET_STORE},
        ${input.envelope.id},
        ${input.envelope.keyVersion}
      )
      on conflict (connection_id)
      do update set
        secret_store = excluded.secret_store,
        secret_ref = excluded.secret_ref,
        key_version = excluded.key_version,
        rotated_at = now()
    `;

    await tx`
      update app_private.channel_connections
      set
        health_state = 'STALE',
        auth_valid = true,
        webhook_healthy = null,
        last_verified_at = now(),
        updated_at = now()
      where id = ${connection.id}
    `;

    if (previous?.secret_ref && previous.secret_ref !== input.envelope.id) {
      await tx`
        delete from app_private.secret_envelopes
        where id = ${previous.secret_ref}
          and workspace_id = ${input.workspaceId}
          and purpose = ${SECRET_PURPOSE}
      `;
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
        ${input.workspaceId},
        ${input.actorUserId},
        'instagram.oauth.connected',
        'channel_connection',
        ${connection.id},
        ${tx.json({ provider: PROVIDER_KEY, mode: "official", tokenKind: "long_lived", scopes: LOGIN_SCOPES })}
      )
    `;

    return connection.id;
  });
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", value));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function readJsonSafely(response: Response): Promise<unknown | null> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function parseProviderId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortId(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN_ERROR";
  const normalized = error.message.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 120) || "UNKNOWN_ERROR";
}

function statusPage(title: string, message: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{max-width:720px;margin:0 auto;padding:56px 24px;font:16px/1.6 system-ui,-apple-system,sans-serif;background:#0d0f12;color:#f5f6f7}h1{font-size:34px;line-height:1.1}p{color:#bac0c8}.card{border:1px solid #29303a;border-radius:18px;padding:28px;background:#15191f}</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer"
      }
    }
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return character;
    }
  });
}
