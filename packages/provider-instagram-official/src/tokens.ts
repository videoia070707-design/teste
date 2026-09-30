export interface InstagramAuthorizationToken {
  accessToken: string;
  userId: string;
}

export interface InstagramLongLivedToken {
  accessToken: string;
  expiresInSeconds?: number;
}

export function parseInstagramAuthorizationToken(payload: unknown): InstagramAuthorizationToken {
  const candidates = extractTokenCandidates(payload);

  if (candidates.length !== 1) {
    throw new Error("Instagram OAuth response must contain exactly one authorized token candidate.");
  }

  const candidate = candidates[0];
  if (!candidate) throw new Error("Instagram OAuth response is empty.");

  return candidate;
}

export async function exchangeInstagramLongLivedToken(input: {
  endpoint: string;
  clientSecret: string;
  shortLivedAccessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<InstagramLongLivedToken> {
  if (!input.endpoint || !input.clientSecret || !input.shortLivedAccessToken) {
    throw new Error("Long-lived Instagram token exchange is not configured.");
  }

  const url = new URL(input.endpoint);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", input.clientSecret);
  url.searchParams.set("access_token", input.shortLivedAccessToken);

  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store"
  });

  const payload = await readJsonSafely(response);
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`Instagram long-lived token exchange failed with HTTP ${response.status}.`);
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new Error("Instagram long-lived token response did not include access_token.");

  const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
    ? payload.expires_in
    : undefined;

  return {
    accessToken,
    ...(expiresIn !== undefined ? { expiresInSeconds: expiresIn } : {})
  };
}

function extractTokenCandidates(payload: unknown): InstagramAuthorizationToken[] {
  if (!isRecord(payload)) return [];

  const topLevel = parseCandidate(payload);
  const wrapped = Array.isArray(payload.data)
    ? payload.data.map(parseCandidate).filter((value): value is InstagramAuthorizationToken => value !== null)
    : [];

  if (topLevel && wrapped.length > 0) {
    throw new Error("Instagram OAuth response mixes top-level and wrapped token candidates.");
  }

  return topLevel ? [topLevel] : wrapped;
}

function parseCandidate(value: unknown): InstagramAuthorizationToken | null {
  if (!isRecord(value)) return null;

  const accessToken = typeof value.access_token === "string" ? value.access_token : "";
  const userIdValue = value.user_id;
  const userId = typeof userIdValue === "string"
    ? userIdValue
    : typeof userIdValue === "number"
      ? String(userIdValue)
      : "";

  if (!accessToken || !userId) return null;
  return { accessToken, userId };
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
