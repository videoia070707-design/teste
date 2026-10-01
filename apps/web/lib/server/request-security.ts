import "server-only";

export function isTrustedMutationRequest(request: Request, configuredOrigin?: string): boolean {
  const expectedOrigin = resolveExpectedOrigin(request, configuredOrigin);
  const origin = request.headers.get("origin");
  if (origin) return normalizeOrigin(origin) === expectedOrigin;

  const referer = request.headers.get("referer");
  if (referer) return normalizeOrigin(referer) === expectedOrigin;

  return false;
}

function resolveExpectedOrigin(request: Request, configuredOrigin?: string): string {
  const configured = configuredOrigin?.trim();
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
