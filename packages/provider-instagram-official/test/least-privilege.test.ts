import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionId } from "@automation/core";
import type { ProviderConnection } from "@automation/providers";
import {
  INSTAGRAM_LOGIN_SCOPES,
  INSTAGRAM_OPTIONAL_SCOPES,
  InstagramOfficialProvider,
  type InstagramCredentialResolver
} from "../src/index";

const connection = {
  id: "conn_scope_test" as ConnectionId,
  workspaceId: "ws_scope_test",
  channel: "instagram",
  provider: "instagram.meta.official",
  mode: "official"
} as ProviderConnection;

const noCredentials: InstagramCredentialResolver = {
  resolve: async () => null
};

test("G3 OAuth does not request unimplemented content publishing permission", () => {
  assert.deepEqual([...INSTAGRAM_LOGIN_SCOPES], [
    "instagram_business_basic",
    "instagram_business_manage_messages",
    "instagram_business_manage_comments"
  ]);
  assert.equal((INSTAGRAM_LOGIN_SCOPES as readonly string[]).includes("instagram_business_content_publish"), false);
  assert.deepEqual([...INSTAGRAM_OPTIONAL_SCOPES], ["instagram_business_content_publish"]);
});

test("content.publish capability remains unavailable until implemented", async () => {
  const provider = new InstagramOfficialProvider({
    graphBaseUrl: "https://graph.instagram.com/",
    apiVersion: "v-test"
  }, noCredentials);

  const capabilities = await provider.getCapabilities(connection);
  const publishing = capabilities.find((item) => item.key === "content.publish");

  assert.ok(publishing);
  assert.equal(publishing.state, "unavailable");
  assert.match(publishing.reason ?? "", /not implemented/i);
});
