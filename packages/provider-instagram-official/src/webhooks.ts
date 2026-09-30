import { createHash } from "node:crypto";

export interface InstagramWebhookMessageEvent {
  providerEventId: string;
  accountId: string;
  senderId: string;
  recipientId: string;
  occurredAt: string;
  messageId?: string;
  text?: string;
  isEcho: boolean;
  attachments?: unknown[];
  raw: unknown;
}

export function extractInstagramAccountIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];
  const ids = new Set<string>();

  for (const entry of payload.entry) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id === "string" && entry.id) ids.add(entry.id);
  }

  return [...ids];
}

export function normalizeInstagramMessageWebhook(payload: unknown): InstagramWebhookMessageEvent[] {
  if (!isRecord(payload) || payload.object !== "instagram" || !Array.isArray(payload.entry)) return [];

  const results: InstagramWebhookMessageEvent[] = [];

  for (const entry of payload.entry) {
    if (!isRecord(entry)) continue;
    const accountId = typeof entry.id === "string" ? entry.id : "";

    if (Array.isArray(entry.messaging)) {
      for (const event of entry.messaging) {
        const normalized = normalizeMessagingEvent(accountId, event);
        if (normalized) results.push(normalized);
      }
    }

    // Meta's dashboard/test notifications can represent the same message
    // under entry[].changes[].value instead of entry[].messaging[].
    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (!isRecord(change) || change.field !== "messages" || !isRecord(change.value)) continue;
        const normalized = normalizeMessagingEvent(accountId, change.value);
        if (normalized) results.push(normalized);
      }
    }
  }

  return results;
}

function normalizeMessagingEvent(accountId: string, rawEvent: unknown): InstagramWebhookMessageEvent | null {
  if (!isRecord(rawEvent)) return null;
  const sender = isRecord(rawEvent.sender) ? rawEvent.sender : null;
  const recipient = isRecord(rawEvent.recipient) ? rawEvent.recipient : null;
  const message = isRecord(rawEvent.message) ? rawEvent.message : null;

  const senderId = sender && typeof sender.id === "string" ? sender.id : "";
  const recipientId = recipient && typeof recipient.id === "string" ? recipient.id : accountId;
  if (!senderId || !recipientId || !message) return null;

  const messageId = typeof message.mid === "string" && message.mid ? message.mid : undefined;
  const text = typeof message.text === "string" ? message.text : undefined;
  const isEcho = message.is_echo === true;
  const attachments = Array.isArray(message.attachments) ? message.attachments : undefined;
  const timestamp = normalizeTimestamp(rawEvent.timestamp);
  const effectiveAccountId = accountId || recipientId;

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ effectiveAccountId, senderId, recipientId, timestamp, message }))
    .digest("hex");

  return {
    providerEventId: messageId ? `ig-message:${messageId}` : `ig-message-fallback:${fingerprint}`,
    accountId: effectiveAccountId,
    senderId,
    recipientId,
    occurredAt: timestamp,
    ...(messageId ? { messageId } : {}),
    ...(text !== undefined ? { text } : {}),
    isEcho,
    ...(attachments ? { attachments } : {}),
    raw: rawEvent
  };
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return new Date(0).toISOString();
  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(milliseconds).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
