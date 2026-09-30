import type { CanonicalEvent } from "@automation/core";
import type { ProviderSendResult } from "@automation/providers";

export type MessageDeliveryState =
  | "CREATED"
  | "QUEUED"
  | "PROCESSING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "RETRYING"
  | "DEAD"
  | "SEND_RESULT_UNKNOWN";

export interface MessageDeliverySnapshot {
  state: MessageDeliveryState;
  providerMessageId?: string;
  lastProviderTimestamp?: string;
  lastErrorCode?: string;
  reconciliationRequired: boolean;
}

const STATE_ORDER: Record<MessageDeliveryState, number> = {
  CREATED: 0,
  QUEUED: 1,
  PROCESSING: 2,
  SEND_RESULT_UNKNOWN: 3,
  RETRYING: 4,
  SENT: 5,
  DELIVERED: 6,
  READ: 7,
  FAILED: 8,
  DEAD: 9
};

export function applyProviderSendResult(
  current: MessageDeliverySnapshot,
  result: ProviderSendResult
): MessageDeliverySnapshot {
  if (result.kind === "accepted") {
    return {
      state: "SENT",
      providerMessageId: result.providerMessageId,
      lastProviderTimestamp: result.acceptedAt,
      reconciliationRequired: false
    };
  }

  if (result.kind === "rejected") {
    return {
      ...current,
      state: result.retryable ? "RETRYING" : "FAILED",
      lastErrorCode: result.code,
      reconciliationRequired: false
    };
  }

  return {
    ...current,
    state: "SEND_RESULT_UNKNOWN",
    reconciliationRequired: true
  };
}

export function applyProviderStatusEvent(
  current: MessageDeliverySnapshot,
  incoming: { state: "SENT" | "DELIVERED" | "READ" | "FAILED"; providerTimestamp: string; providerMessageId?: string; errorCode?: string }
): MessageDeliverySnapshot {
  const currentTimestamp = current.lastProviderTimestamp ? Date.parse(current.lastProviderTimestamp) : -Infinity;
  const incomingTimestamp = Date.parse(incoming.providerTimestamp);

  if (Number.isFinite(currentTimestamp) && incomingTimestamp < currentTimestamp) {
    return current;
  }

  if (incoming.state !== "FAILED" && STATE_ORDER[incoming.state] < STATE_ORDER[current.state] && current.state !== "SEND_RESULT_UNKNOWN") {
    return current;
  }

  const providerMessageId = incoming.providerMessageId ?? current.providerMessageId;

  return {
    state: incoming.state,
    ...(providerMessageId ? { providerMessageId } : {}),
    lastProviderTimestamp: incoming.providerTimestamp,
    ...(incoming.errorCode ? { lastErrorCode: incoming.errorCode } : {}),
    reconciliationRequired: false
  };
}

export interface IdempotencyStore {
  has(providerEventId: string): Promise<boolean>;
  remember(providerEventId: string, expiresAt: string): Promise<void>;
}

export type IdempotencyDecision = "PROCESS" | "DUPLICATE" | "SUSPICIOUS_COLLISION";

export async function decideIdempotency<TPayload>(
  store: IdempotencyStore,
  event: CanonicalEvent<TPayload>,
  fingerprintMatchesExisting?: boolean
): Promise<IdempotencyDecision> {
  const seen = await store.has(event.providerEventId);
  if (!seen) return "PROCESS";
  if (fingerprintMatchesExisting === false) return "SUSPICIOUS_COLLISION";
  return "DUPLICATE";
}

export interface RetryPolicy {
  delaysSeconds: readonly number[];
  maxAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  delaysSeconds: [15, 60, 300, 1800],
  maxAttempts: 5
};

export function nextRetryDelaySeconds(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number | null {
  if (attempt >= policy.maxAttempts) return null;
  return policy.delaysSeconds[Math.min(attempt, policy.delaysSeconds.length - 1)] ?? null;
}

export interface ReconciliationDecision {
  action: "CONFIRM_SENT" | "CONFIRM_FAILED" | "KEEP_UNKNOWN" | "SAFE_RETRY";
  reason: string;
}

export function reconcileUnknownSend(input: {
  providerFoundMessage: boolean;
  providerConfirmedFailure: boolean;
  idempotentRetrySupported: boolean;
}): ReconciliationDecision {
  if (input.providerFoundMessage) {
    return { action: "CONFIRM_SENT", reason: "Provider confirms the message exists." };
  }
  if (input.providerConfirmedFailure) {
    return input.idempotentRetrySupported
      ? { action: "SAFE_RETRY", reason: "Provider confirms failure and retry is idempotent." }
      : { action: "CONFIRM_FAILED", reason: "Provider confirms failure but retry cannot be proven safe." };
  }
  return { action: "KEEP_UNKNOWN", reason: "Outcome remains ambiguous; automatic retry is blocked." };
}
