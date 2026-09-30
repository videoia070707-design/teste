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

export interface InstagramWebhookCommentEvent {
  providerEventId: string;
  accountId: string;
  commentId: string;
  mediaId: string;
  occurredAt: string;
  text?: string;
  commenterId?: string;
  commenterUsername?: string;
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

export function normalizeInstagramCommentWebhook(payload: unknown): InstagramWebhookCommentEvent[] {
  if (!isRecord(payload) || payload.object !== "instagram" || !Array.isArray(payload.entry)) return [];

  const results: InstagramWebhookCommentEvent[] = [];

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    const accountId = typeof entry.id === "string" ? entry.id : "";
    const entryTimestamp = entry.time;

    for (const change of entry.changes) {
      if (!isRecord(change) || (change.field !== "comments" && change.field !== "live_comments")) continue;
      if (!isRecord(change.value)) continue;

      const normalized = normalizeCommentChange(accountId, entryTimestamp, change.value);
      if (normalized) results.push(normalized);
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

function normalizeCommentChange(
  accountId: string,
  entryTimestamp: unknown,
  value: Record<string, unknown>
): InstagramWebhookCommentEvent | null {
  const commentId = typeof value.id === "string" ? value.id : "";
  const media = isRecord(value.media) ? value.media : null;
  const mediaId = typeof value.media_id === "string"
    ? value.media_id
    : media && typeof media.id === "string"
      ? media.id
      : "";

  if (!accountId || !commentId || !mediaId) return null;

  const from = isRecord(value.from) ? value.from : null;
  const commenterId = from && typeof from.id === "string" && from.id ? from.id : undefined;
  const commenterUsername = from && typeof from.username === "string" && from.username
    ? from.username
    : typeof value.username === "string" && value.username
      ? value.username
      : undefined;
  const text = typeof value.text === "string" ? value.text : undefined;
  const rawTimestamp = value.created_time ?? value.timestamp ?? entryTimestamp;
  const occurredAt = normalizeTimestamp(rawTimestamp);

  // A comment can be delivered more than once, and a future provider change may
  // emit a later update for the same comment. Including the provider timestamp
  // keeps retries idempotent while not forcing all future comment updates into
  // a false collision under one bare comment ID.
  const timestampKey = occurredAt === new Date(0).toISOString()
    ? createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 20)
    : String(Date.parse(occurredAt));

  return {
    providerEventId: `ig-comment:${commentId}:${timestampKey}`,
    accountId,
    commentId,
    mediaId,
    occurredAt,
    ...(text !== undefined ? { text } : {}),
    ...(commenterId ? { commenterId } : {}),
    ...(commenterUsername ? { commenterUsername } : {}),
    raw: value
  };
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return normalizeTimestamp(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return new Date(0).toISOString();
  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(milliseconds).toISOString();
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortJson(value[key]);
  return sorted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
