import assert from "node:assert/strict";
import test from "node:test";
import {
  extractInstagramAccountIds,
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

test("extracts account IDs before connection resolution", () => {
  const ids = extractInstagramAccountIds({
    object: "instagram",
    entry: [{ id: "a" }, { id: "b" }, { id: "a" }]
  });

  assert.deepEqual(ids.sort(), ["a", "b"]);
});
