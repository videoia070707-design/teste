import postgres from "npm:postgres@3.4.9";

const PROVIDER_KEY = "instagram.meta.official";
const textEncoder = new TextEncoder();

type DeletionStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "MANUAL_REVIEW";

interface SignedDeletionPayload {
  userId: string;
  issuedAt: number | null;
}

interface DeletionReceipt {
  id: string;
  confirmation_code: string;
  status: DeletionStatus;
  requested_at: string;
  completed_at: string | null;
}

interface DeletionCounts {
  matched_connections: number;
  deleted_connections: number;
  deleted_ingress_events: number;
  deleted_secret_envelopes: number;
  deleted_outbox_events: number;
}

Deno.serve(async (request: Request) => {
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL")?.trim();
  if (!databaseUrl) return new Response("Database unavailable", { status: 503 });

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 10
  });

  try {
    if (request.method === "GET") {
      return await handleStatus(sql, request);
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, POST" }
      });
    }

    const appSecret = await loadAppSecret(sql);
    if (!appSecret) {
      return new Response("Data deletion verification is not configured.", { status: 503 });
    }

    return await handleDeletion(sql, request, appSecret);
  } catch (error) {
    console.error("instagram-data-deletion failed", safeErrorCode(error));
    return new Response("Data deletion unavailable", { status: 503 });
  } finally {
    await sql.end({ timeout: 3 });
  }
});

async function handleStatus(sql: ReturnType<typeof postgres>, request: Request): Promise<Response> {
  const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(code)) {
    return Response.json({ error: "invalid_confirmation_code" }, noStore(400));
  }

  const [receipt] = await sql<DeletionReceipt[]>`
    select id, confirmation_code, status, requested_at, completed_at
    from app_private.data_deletion_requests
    where confirmation_code = ${code}
      and provider_key = ${PROVIDER_KEY}
    limit 1
  `;

  if (!receipt) {
    return Response.json({ error: "deletion_request_not_found" }, noStore(404));
  }

  return Response.json(
    {
      confirmation_code: receipt.confirmation_code,
      status: publicStatus(receipt.status),
      requested_at: receipt.requested_at,
      completed_at: receipt.completed_at
    },
    noStore(200)
  );
}

async function handleDeletion(
  sql: ReturnType<typeof postgres>,
  request: Request,
  appSecret: string
): Promise<Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
    return Response.json({ error: "unsupported_content_type" }, noStore(415));
  }

  const form = await request.formData();
  const signedRequestValue = form.get("signed_request");
  if (typeof signedRequestValue !== "string" || !signedRequestValue) {
    return Response.json({ error: "signed_request_required" }, noStore(400));
  }

  const payload = await verifySignedRequest(signedRequestValue, appSecret);
  if (!payload) {
    return Response.json({ error: "invalid_signed_request" }, noStore(401));
  }

  const requestFingerprint = await sha256Hex(textEncoder.encode(signedRequestValue));
  const providerSubjectHash = await sha256Hex(textEncoder.encode(payload.userId));
  const confirmationCode = randomConfirmationCode();
  const issuedAt = payload.issuedAt === null ? null : new Date(payload.issuedAt * 1000).toISOString();

  const [receipt] = await sql<DeletionReceipt[]>`
    insert into app_private.data_deletion_requests (
      provider_key,
      request_fingerprint,
      provider_subject_hash,
      confirmation_code,
      provider_issued_at
    ) values (
      ${PROVIDER_KEY},
      ${requestFingerprint},
      ${providerSubjectHash},
      ${confirmationCode},
      ${issuedAt}
    )
    on conflict (provider_key, request_fingerprint)
    do update set request_fingerprint = excluded.request_fingerprint
    returning id, confirmation_code, status, requested_at, completed_at
  `;

  if (!receipt) throw new Error("DELETION_RECEIPT_NOT_PERSISTED");

  if (receipt.status !== "COMPLETED") {
    try {
      await processDeletion(sql, receipt.id, payload.userId);
    } catch (error) {
      await markDeletionFailed(sql, receipt.id, safeErrorCode(error));
      throw error;
    }
  }

  const statusUrl = new URL(request.url);
  statusUrl.search = "";
  statusUrl.searchParams.set("code", receipt.confirmation_code);

  return Response.json(
    {
      url: statusUrl.toString(),
      confirmation_code: receipt.confirmation_code
    },
    noStore(200)
  );
}

async function processDeletion(
  sql: ReturnType<typeof postgres>,
  receiptId: string,
  providerSubjectId: string
): Promise<void> {
  await sql.begin(async (tx) => {
    const [locked] = await tx<{ status: DeletionStatus }[]>`
      select status
      from app_private.data_deletion_requests
      where id = ${receiptId}
      for update
    `;

    if (!locked) throw new Error("DELETION_RECEIPT_NOT_FOUND");
    if (locked.status === "COMPLETED") return;

    await tx`
      update app_private.data_deletion_requests
      set
        status = 'PROCESSING',
        processing_started_at = now(),
        completed_at = null,
        last_error_code = null
      where id = ${receiptId}
    `;

    const [counts] = await tx<DeletionCounts[]>`
      select *
      from app_private.delete_provider_subject_data(${PROVIDER_KEY}, ${providerSubjectId})
    `;

    if (!counts) throw new Error("DELETION_RESULT_MISSING");

    if (counts.matched_connections === 0) {
      const [legacy] = await tx<{ unresolved_count: number }[]>`
        select count(*)::int as unresolved_count
        from app_private.channel_connections
        where provider_key = ${PROVIDER_KEY}
          and provider_subject_id is null
      `;

      if ((legacy?.unresolved_count ?? 0) > 0) {
        await tx`
          update app_private.data_deletion_requests
          set
            status = 'MANUAL_REVIEW',
            matched_connections = 0,
            deleted_connections = 0,
            deleted_ingress_events = 0,
            deleted_secret_envelopes = 0,
            deleted_outbox_events = 0,
            completed_at = null,
            last_error_code = 'UNRESOLVED_PROVIDER_IDENTITY'
          where id = ${receiptId}
        `;
        return;
      }
    }

    await tx`
      update app_private.data_deletion_requests
      set
        status = 'COMPLETED',
        matched_connections = ${counts.matched_connections},
        deleted_connections = ${counts.deleted_connections},
        deleted_ingress_events = ${counts.deleted_ingress_events},
        deleted_secret_envelopes = ${counts.deleted_secret_envelopes},
        deleted_outbox_events = ${counts.deleted_outbox_events},
        completed_at = now(),
        last_error_code = null
      where id = ${receiptId}
    `;
  });
}

async function markDeletionFailed(
  sql: ReturnType<typeof postgres>,
  receiptId: string,
  errorCode: string
): Promise<void> {
  try {
    await sql`
      update app_private.data_deletion_requests
      set
        status = 'FAILED',
        completed_at = null,
        last_error_code = ${errorCode.slice(0, 120)}
      where id = ${receiptId}
        and status <> 'COMPLETED'
    `;
  } catch {
    // Original processing error remains authoritative; provider will retry.
  }
}

async function loadAppSecret(sql: ReturnType<typeof postgres>): Promise<string | null> {
  const [row] = await sql<{ decrypted_secret: string }[]>`
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'meta_app_secret'
    order by created_at desc
    limit 1
  `;
  return row?.decrypted_secret?.trim() || null;
}

async function verifySignedRequest(value: string, appSecret: string): Promise<SignedDeletionPayload | null> {
  const parts = value.split(".");
  if (parts.length !== 2) return null;

  const [encodedSignature, encodedPayload] = parts;
  if (!encodedSignature || !encodedPayload) return null;

  let providedSignature: Uint8Array;
  let payloadBytes: Uint8Array;
  try {
    providedSignature = decodeBase64Url(encodedSignature);
    payloadBytes = decodeBase64Url(encodedPayload);
  } catch {
    return null;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expectedSignature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, textEncoder.encode(encodedPayload))
  );

  if (!constantTimeEqualBytes(expectedSignature, providedSignature)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(payloadBytes)) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (raw.algorithm !== "HMAC-SHA256") return null;

  const userId = parseProviderId(raw.user_id);
  if (!userId) return null;

  const issuedAt = raw.issued_at === undefined
    ? null
    : typeof raw.issued_at === "number" && Number.isFinite(raw.issued_at) && raw.issued_at >= 0
      ? raw.issued_at
      : null;

  if (raw.issued_at !== undefined && issuedAt === null) return null;

  return { userId, issuedAt };
}

function parseProviderId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return "";
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomConfirmationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return bytesToBase64Url(bytes);
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", value));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function publicStatus(status: DeletionStatus): "pending" | "completed" | "failed" {
  if (status === "COMPLETED") return "completed";
  if (status === "FAILED") return "failed";
  return "pending";
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN_ERROR";
  const normalized = error.message.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 120) || "UNKNOWN_ERROR";
}

function noStore(status: number): ResponseInit {
  return {
    status,
    headers: { "cache-control": "no-store" }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
