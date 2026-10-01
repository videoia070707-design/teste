import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { renderConsole } from "./ui.ts";

const CONTROL_SLUG = "g3-control";
const MAX_PROXY_BODY_BYTES = 16_384;

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const relativePath = url.pathname.endsWith("/api/status")
    ? "/api/status"
    : url.pathname.endsWith("/api/setup")
      ? "/api/setup"
      : url.pathname.endsWith("/api/oauth-start")
        ? "/api/oauth-start"
        : "/";

  if (request.method === "GET" && relativePath === "/") {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = defaultPublishableKey();
    if (!supabaseUrl || !publishableKey) {
      return new Response("G3 Console runtime is not configured.", {
        status: 503,
        headers: securityHeaders("text/plain; charset=utf-8")
      });
    }
    return renderConsole(supabaseUrl, publishableKey);
  }

  if (relativePath === "/api/status" && request.method === "GET") {
    return proxyControl(request, "status", "GET");
  }

  if (relativePath === "/api/setup" && request.method === "POST") {
    return proxyControl(request, "setup", "POST");
  }

  if (relativePath === "/api/oauth-start" && request.method === "POST") {
    return proxyOAuthStart(request);
  }

  return new Response("Not found", {
    status: 404,
    headers: securityHeaders("text/plain; charset=utf-8")
  });
});

async function proxyControl(
  request: Request,
  action: "status" | "setup",
  method: "GET" | "POST"
): Promise<Response> {
  const context = runtimeContext(request);
  if (context instanceof Response) return context;

  let body: string | undefined;
  if (method === "POST") {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return json({ error: "json_content_type_required" }, 400);
    }
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_PROXY_BODY_BYTES) {
      return json({ error: "request_too_large" }, 413);
    }
  }

  return forward(
    `${context.supabaseUrl}/functions/v1/${CONTROL_SLUG}/${action}`,
    method,
    context.authorization,
    context.publishableKey,
    body
  );
}

async function proxyOAuthStart(request: Request): Promise<Response> {
  const context = runtimeContext(request);
  if (context instanceof Response) return context;

  return forward(
    `${context.supabaseUrl}/functions/v1/instagram-oauth-start`,
    "POST",
    context.authorization,
    context.publishableKey
  );
}

function runtimeContext(request: Request):
  | { authorization: string; supabaseUrl: string; publishableKey: string }
  | Response {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "authentication_required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = defaultPublishableKey();
  if (!supabaseUrl || !publishableKey) {
    return json({ error: "console_runtime_not_configured" }, 503);
  }

  return { authorization, supabaseUrl, publishableKey };
}

async function forward(
  url: string,
  method: "GET" | "POST",
  authorization: string,
  publishableKey: string,
  body?: string
): Promise<Response> {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        authorization,
        apikey: publishableKey,
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      ...(body !== undefined ? { body } : {})
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: {
        ...securityHeaders(response.headers.get("content-type") ?? "application/json; charset=utf-8"),
        "cache-control": "no-store"
      }
    });
  } catch {
    return json({ error: "upstream_unreachable" }, 503);
  }
}

function defaultPublishableKey(): string | null {
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed.default;
      if (typeof value === "string" && value) return value;
    } catch {
      // Fall through to legacy hosted anon key.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? null;
}

function securityHeaders(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()"
  };
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      ...securityHeaders("application/json; charset=utf-8"),
      "cache-control": "no-store"
    }
  });
}
