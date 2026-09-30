import postgres from "npm:postgres@3.4.9";

const PROVIDER_KEY = "instagram.meta.official";
const DEFAULT_SIGNATURE_HEADER = "x-hub-signature-256";
const textEncoder = new TextEncoder();

Deno.serve(async (request: Request) => {
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL")?.trim();
  if (!databaseUrl) {
    return new Response("Database unavailable", { status: 503 });
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 10
  });

  try {
    const secrets = await loadWebhookSecrets(sql);
    if (!secrets) {
      return new Response("Webhook verification is not configured.", { status: 503 });
    }

    if (request.method === "GET") {
      return handleChallenge(request, secrets.verifyToken);
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, POST" }
      });
    }

    return await handleWebhook(sql, request, secrets.appSecret, secrets.signatureHeaderName);
  } catch (error) {
    console.error("instagram-webhook failed", error);
    return new Response("Webhook persistence unavailable", { status: 503 });
  } finally {
    await sql.end({ timeout: 3 });
  }
});

interface WebhookSecrets {
  appSecret: string;
  verifyToken: string;
  signatureHeaderName: string;
}

async function loadWebhookSecrets(sql: ReturnType<typeof postgres>): Promise<WebhookSecrets | null> {
  const rows = await sql<{ name: string; decrypted_secret: string }[]>`
    select name, decrypted_secret
    from vault.decrypted_secrets
    where name in ('meta_app_secret', 'meta_webhook_verify_token', 'meta_webhook_signature_header')
  `;

  const byName = new Map(rows.map((row) => [row.name, row.decrypted_secret]));
  const appSecret = byName.get("meta_app_secret")?.trim();
  const verifyToken = byName.get("meta_webhook_verify_token")?.trim();
  const configuredHeader = byName.get("meta_webhook_signature_header")?.trim().toLowerCase();

  if (!appSecret || !verifyToken) return null;

  return {
    appSecret,
    verifyToken,
    signatureHeaderName: configuredHeader || DEFAULT_SIGNATURE_HEADER
  };
}

function handleChallenge(request: Request, expectedToken: string): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !constantTimeEqual(token, expectedToken) || challenge === null) {
    return new Response("Forbidden", { status: 403 });
  }

  return new Response(challenge, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function handleWebhook(
  sql: ReturnType<typeof postgres>,
  request: Request,
  appSecret: string,
  signatureHeaderName: string
): Promise<Response> {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const signature = request.headers.get(signatureHeaderName);

  if (!(await verifyHmacSha256(rawBody, signature, appSecret))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const decodedBody = new TextDecoder().decode(rawBody);
  let parsedPayload: unknown | null = null;
  let parseError = false;

  try {
    parsedPayload = JSON.parse(decodedBody) as unknown;
  } catch {
    parseError = true;
  }

  const bodySha256 = await sha256Hex(rawBody);
  const providerAccountIds = extractInstagramAccountIds(parsedPayload);
  const headers = selectWebhookHeaders(request.headers, signatureHeaderName);
  const rawBodyBase64 = bytesToBase64(rawBody);
  const payloadValue = parsedPayload === null ? null : sql.json(parsedPayload as never);

  const [row] = await sql<{
    id: string;
    receive_count: number;
    inserted: boolean;
  }[]>`
    insert into app_private.webhook_ingress_events (
      provider,
      signature_valid,
      body_sha256,
      raw_body,
      headers,
      parsed_payload,
      provider_account_ids
    ) values (
      ${PROVIDER_KEY},
      true,
      ${bodySha256},
      decode(${rawBodyBase64}, 'base64'),
      ${sql.json(headers)},
      ${payloadValue},
      ${sql.array(providerAccountIds)}
    )
    on conflict (provider, body_sha256)
    do update set
      receive_count = app_private.webhook_ingress_events.receive_count + 1,
      last_received_at = now(),
      signature_valid = app_private.webhook_ingress_events.signature_valid or excluded.signature_valid
    returning
      id,
      receive_count,
      (xmax = 0) as inserted
  `;

  if (!row) throw new Error("WEBHOOK_INGRESS_INSERT_RETURNED_NO_ROW");

  if (parseError) {
    return Response.json(
      {
        received: true,
        persisted: true,
        ingressId: row.id,
        error: "invalid_json"
      },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  return Response.json(
    {
      received: true,
      persisted: true,
      duplicate: !row.inserted,
      ingressId: row.id
    },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}

async function verifyHmacSha256(rawBody: Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  const [algorithm, providedHex] = signature.split("=", 2);
  if (algorithm !== "sha256" || !providedHex || !/^[0-9a-fA-F]{64}$/.test(providedHex)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  const provided = hexToBytes(providedHex.toLowerCase());
  return constantTimeEqualBytes(digest, provided);
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", value));
  return bytesToHex(digest);
}

function extractInstagramAccountIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];
  const ids = new Set<string>();

  for (const entry of payload.entry) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id === "string" && entry.id) ids.add(entry.id);
  }

  return [...ids];
}

function selectWebhookHeaders(headers: Headers, signatureHeaderName: string): Record<string, string> {
  const allowList = new Set([
    "content-type",
    "user-agent",
    signatureHeaderName,
    "instagram-api-version"
  ]);

  const selected: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const normalized = key.toLowerCase();
    if (allowList.has(normalized)) selected[normalized] = value;
  }
  return selected;
}

function constantTimeEqual(left: string, right: string): boolean {
  return constantTimeEqualBytes(textEncoder.encode(left), textEncoder.encode(right));
}

function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function hexToBytes(hex: string): Uint8Array {
  const result = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    result[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return result;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
