import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPIRED_PROCESSING_RECOVERY,
  retryDelayForClaimedAttempt
} from "../src/policy";

test("first claimed attempt retries after 15 seconds", () => {
  assert.equal(retryDelayForClaimedAttempt(1), 15);
});

test("retry delay advances without skipping the first policy slot", () => {
  assert.equal(retryDelayForClaimedAttempt(2), 60);
  assert.equal(retryDelayForClaimedAttempt(3), 300);
  assert.equal(retryDelayForClaimedAttempt(4), 1800);
});

test("fifth claimed attempt does not schedule a sixth provider attempt", () => {
  assert.equal(retryDelayForClaimedAttempt(5), null);
});

test("expired processing lease is quarantined as unknown, never failed or retrying", () => {
  assert.deepEqual(EXPIRED_PROCESSING_RECOVERY, {
    deliveryState: "SEND_RESULT_UNKNOWN",
    reconciliationRequired: true,
    errorCode: "WORKER_LEASE_EXPIRED_AFTER_DISPATCH_POSSIBLE"
  });
});

test("retry policy rejects impossible attempt counters", () => {
  assert.throws(() => retryDelayForClaimedAttempt(0));
  assert.throws(() => retryDelayForClaimedAttempt(-1));
});
