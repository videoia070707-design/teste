import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProviderSendResult,
  applyProviderStatusEvent,
  decideIdempotency,
  reconcileUnknownSend,
  type IdempotencyStore,
  type MessageDeliverySnapshot
} from "../src/index";
import type { CanonicalEvent } from "@automation/core";

const baseMessage: MessageDeliverySnapshot = {
  state: "PROCESSING",
  reconciliationRequired: false
};

test("timeout becomes SEND_RESULT_UNKNOWN and blocks blind retry", () => {
  const result = applyProviderSendResult(baseMessage, {
    kind: "unknown",
    reason: "timeout"
  });

  assert.equal(result.state, "SEND_RESULT_UNKNOWN");
  assert.equal(result.reconciliationRequired, true);
});

test("reconciliation keeps ambiguous outcome unknown when provider cannot prove result", () => {
  const decision = reconcileUnknownSend({
    providerFoundMessage: false,
    providerConfirmedFailure: false,
    idempotentRetrySupported: true
  });

  assert.equal(decision.action, "KEEP_UNKNOWN");
});

test("reconciliation only allows retry after confirmed failure and idempotent retry support", () => {
  const decision = reconcileUnknownSend({
    providerFoundMessage: false,
    providerConfirmedFailure: true,
    idempotentRetrySupported: true
  });

  assert.equal(decision.action, "SAFE_RETRY");
});

test("older provider status cannot move delivery state backwards", () => {
  const current: MessageDeliverySnapshot = {
    state: "DELIVERED",
    providerMessageId: "msg_1",
    lastProviderTimestamp: "2026-09-30T03:10:00.000Z",
    reconciliationRequired: false
  };

  const next = applyProviderStatusEvent(current, {
    state: "SENT",
    providerTimestamp: "2026-09-30T03:09:00.000Z",
    providerMessageId: "msg_1"
  });

  assert.deepEqual(next, current);
});

test("same provider event id with incompatible fingerprint becomes suspicious collision", async () => {
  const store: IdempotencyStore = {
    has: async () => true,
    remember: async () => undefined
  };

  const event = {
    eventId: "evt_1",
    eventType: "message.received",
    workspaceId: "ws_1",
    connectionId: "conn_1",
    channel: "instagram",
    provider: "meta",
    providerEventId: "provider_evt_1",
    occurredAt: "2026-09-30T03:00:00.000Z",
    receivedAt: "2026-09-30T03:00:01.000Z",
    correlationId: "corr_1",
    payload: { text: "hello" }
  } as CanonicalEvent<{ text: string }>;

  const decision = await decideIdempotency(store, event, false);
  assert.equal(decision, "SUSPICIOUS_COLLISION");
});
