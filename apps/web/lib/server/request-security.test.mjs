import test from "node:test";
import assert from "node:assert/strict";
import { isTrustedMutationRequest } from "./request-security.ts";

test("allows same-origin mutation requests", () => {
  const request = new Request("https://app.example.com/api/settings/platform", {
    method: "POST",
    headers: { origin: "https://app.example.com" }
  });

  assert.equal(isTrustedMutationRequest(request, "https://app.example.com"), true);
});

test("blocks cross-origin mutation requests", () => {
  const request = new Request("https://app.example.com/api/settings/platform", {
    method: "POST",
    headers: { origin: "https://evil.example" }
  });

  assert.equal(isTrustedMutationRequest(request, "https://app.example.com"), false);
});

test("falls back to same-origin referer when Origin is absent", () => {
  const request = new Request("https://app.example.com/api/settings/platform", {
    method: "POST",
    headers: { referer: "https://app.example.com/settings" }
  });

  assert.equal(isTrustedMutationRequest(request, "https://app.example.com"), true);
});

test("blocks mutation requests without Origin or Referer", () => {
  const request = new Request("https://app.example.com/api/settings/platform", {
    method: "POST"
  });

  assert.equal(isTrustedMutationRequest(request, "https://app.example.com"), false);
});
