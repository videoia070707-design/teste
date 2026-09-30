import assert from "node:assert/strict";
import test from "node:test";
import { deriveConnectionHealth } from "../src/index";

test("healthy auth with degraded capability is DEGRADED_PARTIAL", () => {
  const state = deriveConnectionHealth({
    authValid: true,
    webhookHealthy: true,
    recentlyVerified: true,
    providerReachable: true,
    capabilities: [
      { key: "messages.receive", state: "available" },
      { key: "comments.receive", state: "degraded", reason: "partial provider delivery" }
    ]
  });

  assert.equal(state, "DEGRADED_PARTIAL");
});

test("stale verification is not reported as healthy", () => {
  const state = deriveConnectionHealth({
    authValid: true,
    webhookHealthy: true,
    recentlyVerified: false,
    providerReachable: true,
    capabilities: [{ key: "messages.receive", state: "available" }]
  });

  assert.equal(state, "STALE");
});

test("expired auth takes precedence over provider reachability", () => {
  const state = deriveConnectionHealth({
    authValid: false,
    webhookHealthy: false,
    recentlyVerified: false,
    providerReachable: false,
    capabilities: []
  });

  assert.equal(state, "AUTH_EXPIRED");
});
