import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchInstagramSelfProfile,
  parseInstagramAuthorizationToken
} from "../src/tokens";

test("self profile keeps app-scoped id separate from professional user_id", async () => {
  let requestedUrl: URL | null = null;
  let authorization: string | null = null;

  const profile = await fetchInstagramSelfProfile({
    graphBaseUrl: "https://graph.instagram.com/",
    apiVersion: "v26.0",
    accessToken: "long-lived-token",
    fetchImpl: async (input, init) => {
      requestedUrl = new URL(String(input));
      authorization = new Headers(init?.headers).get("authorization");
      return Response.json({
        id: "app-scoped-123",
        user_id: "17841400000000000",
        username: "business_account",
        account_type: "BUSINESS"
      });
    }
  });

  assert.equal(requestedUrl?.origin, "https://graph.instagram.com");
  assert.equal(requestedUrl?.pathname, "/v26.0/me");
  assert.equal(requestedUrl?.searchParams.get("fields"), "id,user_id,username,account_type");
  assert.equal(authorization, "Bearer long-lived-token");
  assert.deepEqual(profile, {
    appScopedId: "app-scoped-123",
    userId: "17841400000000000",
    username: "business_account",
    accountType: "BUSINESS"
  });
});

test("self profile refuses responses missing either identity", async () => {
  await assert.rejects(
    fetchInstagramSelfProfile({
      graphBaseUrl: "https://graph.instagram.com/",
      apiVersion: "v26.0",
      accessToken: "token",
      fetchImpl: async () => Response.json({ id: "only-app-scoped" })
    }),
    /both id and user_id/
  );
});

test("authorization token parser accepts numeric provider user ids without losing precision-safe values", () => {
  assert.deepEqual(
    parseInstagramAuthorizationToken({ access_token: "token", user_id: 1234567890 }),
    { accessToken: "token", userId: "1234567890" }
  );
});
