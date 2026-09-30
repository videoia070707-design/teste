import assert from "node:assert/strict";
import test from "node:test";
import {
  extractInstagramAccountIds,
  normalizeInstagramCommentWebhook,
  normalizeInstagramMessageWebhook
} from "../src/index";

test("normalizes production messaging[] payload", () => {
  const payload = {
    object: "instagram",
    entry: [{
      id: "ig-business-1",
      time: 1761287298065,
      messaging: [{
        sender: { id: "ig-user-1" },
        recipient: { id: "ig-business-1" },
        timestamp: 1761287294014,
        message: { mid: "mid-1", text: "Preço?" }
      }]
    }]
  };

  const events = normalizeInstagramMessageWebhook(payload);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.providerEventId, "ig-message:mid-1");
  assert.equal(events[0]?.senderId, "ig-user-1");
  assert.equal(events[0]?.text, "Preço?");
  assert.equal(events[0]?.accountId, "ig-business-1");
});

test("normalizes dashboard/test changes[] messages payload", () => {
  const payload = {
    object: "instagram",
    entry: [{
      id: "ig-business-1",
      changes: [{
        field: "messages",
        value: {
          sender: { id: "ig-user-2" },
          recipient: { id: "ig-business-1" },
          timestamp: 1761287294,
          message: { mid: "mid-2", text: "Oi" }
        }
      }]
    }]
  };

  const events = normalizeInstagramMessageWebhook(payload);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.providerEventId, "ig-message:mid-2");
  assert.equal(events[0]?.occurredAt, new Date(1761287294 * 1000).toISOString());
});

test("preserves attachments and echo marker", () => {
  const payload = {
    object: "instagram",
    entry: [{
      id: "ig-business-1",
      messaging: [{
        sender: { id: "ig-business-1" },
        recipient: { id: "ig-user-3" },
        timestamp: 1761287294014,
        message: {
          mid: "mid-3",
          is_echo: true,
          attachments: [{ type: "share", payload: { asset_id: "asset-1" } }]
        }
      }]
    }]
  };

  const [event] = normalizeInstagramMessageWebhook(payload);
  assert.equal(event?.isEcho, true);
  assert.equal(event?.attachments?.length, 1);
});

test("normalizes comments change with media_id and commenter identity", () => {
  const payload = {
    object: "instagram",
    entry: [{
      id: "ig-business-1",
      time: 1761287298,
      changes: [{
        field: "comments",
        value: {
          id: "comment-1",
          media_id: "media-1",
          text: "LINK",
          from: { id: "ig-user-4", username: "maria" },
          created_time: 1761287294
        }
      }]
    }]
  };

  const [event] = normalizeInstagramCommentWebhook(payload);
  assert.equal(event?.accountId, "ig-business-1");
  assert.equal(event?.commentId, "comment-1");
  assert.equal(event?.mediaId, "media-1");
  assert.equal(event?.text, "LINK");
  assert.equal(event?.commenterId, "ig-user-4");
  assert.equal(event?.commenterUsername, "maria");
  assert.equal(event?.occurredAt, new Date(1761287294 * 1000).toISOString());
  assert.equal(event?.providerEventId, `ig-comment:comment-1:${1761287294 * 1000}`);
});

test("normalizes live_comments and nested media identity", () => {
  const payload = {
    object: "instagram",
    entry: [{
      id: "ig-business-1",
      time: 1761287300,
      changes: [{
        field: "live_comments",
        value: {
          id: "comment-live-1",
          media: { id: "live-media-1" },
          text: "🔥",
          username: "viewer"
        }
      }]
    }]
  };

  const [event] = normalizeInstagramCommentWebhook(payload);
  assert.equal(event?.commentId, "comment-live-1");
  assert.equal(event?.mediaId, "live-media-1");
  assert.equal(event?.commenterUsername, "viewer");
  assert.equal(event?.occurredAt, new Date(1761287300 * 1000).toISOString());
});

test("uses a deterministic fallback event id when comment timestamp is absent", () => {
  const payload = {
    object: "instagram",
    entry: [{
      id: "ig-business-1",
      changes: [{
        field: "comments",
        value: {
          id: "comment-no-time",
          media_id: "media-2",
          text: "Preço?"
        }
      }]
    }]
  };

  const first = normalizeInstagramCommentWebhook(payload)[0];
  const second = normalizeInstagramCommentWebhook(payload)[0];
  assert.ok(first?.providerEventId.startsWith("ig-comment:comment-no-time:"));
  assert.equal(first?.providerEventId, second?.providerEventId);
});

test("ignores malformed comment changes without account, comment or media identity", () => {
  assert.deepEqual(normalizeInstagramCommentWebhook({
    object: "instagram",
    entry: [{ id: "ig-business-1", changes: [{ field: "comments", value: { text: "x" } }] }]
  }), []);
});

test("extracts account IDs before connection resolution", () => {
  const ids = extractInstagramAccountIds({
    object: "instagram",
    entry: [{ id: "a" }, { id: "b" }, { id: "a" }]
  });

  assert.deepEqual(ids.sort(), ["a", "b"]);
});
