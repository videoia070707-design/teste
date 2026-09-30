import { DEFAULT_RETRY_POLICY, nextRetryDelaySeconds } from "@automation/reliability";

export const EXPIRED_PROCESSING_RECOVERY = {
  deliveryState: "SEND_RESULT_UNKNOWN",
  reconciliationRequired: true,
  errorCode: "WORKER_LEASE_EXPIRED_AFTER_DISPATCH_POSSIBLE"
} as const;

export function retryDelayForClaimedAttempt(attemptCount: number): number | null {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error("attemptCount must be a positive integer after claim.");
  }

  if (attemptCount >= DEFAULT_RETRY_POLICY.maxAttempts) return null;
  return nextRetryDelaySeconds(attemptCount - 1);
}
