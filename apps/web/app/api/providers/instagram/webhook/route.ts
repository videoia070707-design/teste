import { createHash } from "node:crypto";
import {
  extractInstagramAccountIds,
  verifyHmacSha256Signature,
  verifyWebhookChallenge
} from "@automation/provider-instagram-official";
import { PostgresWebhookIngressStore } from "@automation/storage-postgres";
import { getDatabase } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!expectedToken) return new Response("Webhook verification is not configured.", { status: 503 });

  const url = new URL(request.url);
  const challenge = verifyWebhookChallenge({
    mode: url.searchParams.get("hub.mode"),
    token: url.searchParams.get("hub.verify_token"),
    challenge: url.searchParams.get("hub.challenge"),
    expectedToken
  });

  if (challenge === null) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request): Promise<Response> {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return new Response("Webhook signature verification is not configured.", { status: 503 });

  const signatureHeaderName = (process.env.META_WEBHOOK_SIGNATURE_HEADER || "x-hub-signature-256").toLowerCase();
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const signature = request.headers.get(signatureHeaderName);

  if (!verifyHmacSha256Signature(rawBody, signature, appSecret)) {
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

  const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
  const providerAccountIds = extractInstagramAccountIds(parsedPayload);
  const headers = selectWebhookHeaders(request.headers, signatureHeaderName);

  try {
    const store = new PostgresWebhookIngressStore(getDatabase());
    const persisted = await store.persist({
      provider: "instagram.meta.official",
      signatureValid: true,
      bodySha256,
      rawBody,
      headers,
      parsedPayload,
      providerAccountIds
    });

    if (parseError) {
      return Response.json(
        { received: true, persisted: true, ingressId: persisted.id, error: "invalid_json" },
        { status: 400 }
      );
    }

    return Response.json({
      received: true,
      persisted: true,
      duplicate: persisted.duplicate,
      ingressId: persisted.id
    });
  } catch {
    // Do not ACK a valid provider event that we failed to persist. The provider
    // can retry instead of us silently losing the event.
    return new Response("Webhook persistence unavailable", { status: 503 });
  }
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
    if (allowList.has(key.toLowerCase())) selected[key.toLowerCase()] = value;
  }
  return selected;
}
