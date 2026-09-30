import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionId } from "@automation/core";
import type { ProviderConnection } from "@automation/providers";
import {
  INSTAGRAM_LOGIN_SCOPES,
  InstagramOfficialProvider,
  buildInstagramAuthorizationUrl,
  verifyHmacSha256Signature,
  verifyWebhookChallenge,
  type InstagramCredentialResolver
} from "../src/index";

const connection = {
  id: "conn_test" as ConnectionId,
  workspaceId: "ws_test",
  channel: "instagram",
  provider: "instagram.meta.official",
  mode: "official"
} as ProviderConnection;

const credentials: InstagramCredentialResolver = {
  resolve: async () => ({ accessToken: "secret-token", igUserId: "17890000000000000" })
};

const baseConfig = {
  graphBaseUrl: "https://graph.instagram.com/",
  apiVersion: "v-test",
  requestTimeoutMs: 25
};

test("authorization URL includes state and current Instagram Login scopes", () => {
  const url = buildInstagramAuthorizationUrl({
    authorizationEndpoint: "https://example.test/oauth/authorize",
    clientId: "client_1",
    redirectUri: "https://app.example.test/callback"
  }, "state_123");

  assert.equal(url.searchParams.get("state"), "state_123");
  assert.equal(url.searchParams.get("client_id"), "client_1");
  assert.deepEqual(url.searchParams.get("scope")?.split(","), [...INSTAGRAM_LOGIN_SCOPES]);
});

test("authorization URL refuses an empty state", () => {
  assert.throws(() => buildInstagramAuthorizationUrl({
    authorizationEndpoint: "https://example.test/oauth/authorize",
    clientId: "client_1",
    redirectUri: "https://app.example.test/callback"
  }, ""));
});

test("webhook challenge only succeeds with expected verify token", () => {
  assert.equal(verifyWebhookChallenge({
    mode: "subscribe",
    token: "expected",
    challenge: "challenge-value",
    expectedToken: "expected"
  }), "challenge-value");

  assert.equal(verifyWebhookChallenge({
    mode: "subscribe",
    token: "wrong",
    challenge: "challenge-value",
    expectedToken: "expected"
  }), null);
});

test("HMAC helper validates exact raw body signature", () => {
  const body = JSON.stringify({ event: "message" });
  const secret = "app-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  assert.equal(verifyHmacSha256Signature(body, signature, secret), true);
  assert.equal(verifyHmacSha256Signature(`${body} `, signature, secret), false);
});

test("connection with credentials but no provider probe stays STALE", async () => {
  const provider = new InstagramOfficialProvider(baseConfig, credentials, async () => {
    throw new Error("fetch should not run without a configured probe");
  });

  const health = await provider.verifyConnection(connection);
  assert.equal(health.state, "STALE");
  assert.equal(health.authValid, true);
  assert.equal(health.webhookHealthy, null);
});

test("successful text send returns provider message id", async () => {
  let requestUrl = "";
  let requestBody = "";

  const provider = new InstagramOfficialProvider(baseConfig, credentials, async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ recipient_id: "ig-user-1", message_id: "mid.123" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  const result = await provider.sendText({
    connectionId: connection.id,
    recipientExternalId: "ig-user-1",
    text: "Olá",
    idempotencyKey: "idem-1",
    correlationId: "corr-1"
  });

  assert.equal(result.kind, "accepted");
  if (result.kind === "accepted") assert.equal(result.providerMessageId, "mid.123");
  assert.match(requestUrl, /v-test\/17890000000000000\/messages$/);
  assert.deepEqual(JSON.parse(requestBody), {
    recipient: { id: "ig-user-1" },
    message: { text: "Olá" }
  });
});

test("public comment reply uses comment replies edge and requires returned id", async () => {
  let requestUrl = "";
  let requestBody = "";

  const provider = new InstagramOfficialProvider(baseConfig, credentials, async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ id: "reply-comment-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  const result = await provider.replyToComment({
    connectionId: connection.id,
    commentId: "comment-1",
    text: "Te respondi 🙌",
    idempotencyKey: "comment-reply-1",
    correlationId: "corr-comment-1"
  });

  assert.equal(result.kind, "accepted");
  if (result.kind === "accepted") assert.equal(result.providerMessageId, "reply-comment-1");
  assert.match(requestUrl, /v-test\/comment-1\/replies$/);
  assert.deepEqual(JSON.parse(requestBody), { message: "Te respondi 🙌" });
});

test("private comment reply targets comment_id through messages edge", async () => {
  let requestUrl = "";
  let requestBody = "";

  const provider = new InstagramOfficialProvider(baseConfig, credentials, async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ recipient_id: "ig-user-4", message_id: "private-mid-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  const result = await provider.privateReplyToComment({
    connectionId: connection.id,
    commentId: "comment-1",
    text: "Aqui está o link",
    idempotencyKey: "private-reply-1",
    correlationId: "corr-private-1"
  });

  assert.equal(result.kind, "accepted");
  if (result.kind === "accepted") assert.equal(result.providerMessageId, "private-mid-1");
  assert.match(requestUrl, /v-test\/17890000000000000\/messages$/);
  assert.deepEqual(JSON.parse(requestBody), {
    recipient: { comment_id: "comment-1" },
    message: { text: "Aqui está o link" }
  });
});

test("successful comment reply without provider id is treated as unknown", async () => {
  const provider = new InstagramOfficialProvider(baseConfig, credentials, async () => {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  const result = await provider.replyToComment({
    connectionId: connection.id,
    commentId: "comment-2",
    text: "Oi",
    idempotencyKey: "comment-reply-2",
    correlationId: "corr-comment-2"
  });

  assert.equal(result.kind, "unknown");
});

test("successful HTTP response without message_id is treated as unknown", async () => {
  const provider = new InstagramOfficialProvider(baseConfig, credentials, async () => {
    return new Response(JSON.stringify({ recipient_id: "ig-user-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  const result = await provider.sendText({
    connectionId: connection.id,
    recipientExternalId: "ig-user-1",
    text: "Olá",
    idempotencyKey: "idem-2",
    correlationId: "corr-2"
  });

  assert.equal(result.kind, "unknown");
});

test("provider 5xx is ambiguous instead of blindly retryable", async () => {
  const provider = new InstagramOfficialProvider(baseConfig, credentials, async () => {
    return new Response(JSON.stringify({ error: { message: "upstream error" } }), {
      status: 502,
      headers: { "content-type": "application/json" }
    });
  });

  const result = await provider.sendText({
    connectionId: connection.id,
    recipientExternalId: "ig-user-1",
    text: "Olá",
    idempotencyKey: "idem-3",
    correlationId: "corr-3"
  });

  assert.equal(result.kind, "unknown");
});

test("transport abort becomes unknown timeout", async () => {
  const provider = new InstagramOfficialProvider(
    { ...baseConfig, requestTimeoutMs: 5 },
    credentials,
    async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    })
  );

  const result = await provider.sendText({
    connectionId: connection.id,
    recipientExternalId: "ig-user-1",
    text: "Olá",
    idempotencyKey: "idem-4",
    correlationId: "corr-4"
  });

  assert.equal(result.kind, "unknown");
  if (result.kind === "unknown") assert.equal(result.reason, "timeout");
});
