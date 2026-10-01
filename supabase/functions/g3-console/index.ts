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
        : url.pathname.endsWith("/connect-instagram")
          ? "/connect-instagram"
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

  if (request.method === "GET" && relativePath === "/connect-instagram") {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) {
      return new Response("G3 Console runtime is not configured.", {
        status: 503,
        headers: securityHeaders("text/plain; charset=utf-8")
      });
    }
    return renderInstagramConnector(supabaseUrl);
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

function renderInstagramConnector(supabaseUrl: string): Response {
  const consoleBase = `${supabaseUrl}/functions/v1/g3-console`;
  const safeConsoleBase = JSON.stringify(consoleBase);
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Conectar Instagram — G3</title>
  <style>
    :root{color-scheme:dark;background:#0b0d10;color:#f4f6f8;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 15% 0%,#173525 0,#0b0d10 42%)}
    main{width:min(620px,100%);border:1px solid #252b31;background:#11151a;border-radius:20px;padding:24px;box-shadow:0 18px 50px #0005}
    .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#75e29f;font-weight:800}h1{font-size:36px;line-height:1;margin:14px 0}p{color:#9ca7b3;line-height:1.55}
    button,a{display:inline-flex;align-items:center;justify-content:center;border:1px solid #303840;background:#171d22;color:#fff;border-radius:10px;padding:12px 14px;font-weight:750;text-decoration:none;cursor:pointer}button.primary{background:#75e29f;color:#071009;border-color:#75e29f}.status{margin-top:16px;border-radius:12px;padding:12px;background:#0b0f13;border:1px solid #252b31;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.ok{color:#75e29f}.bad{color:#ff9d91}.muted{color:#84909b}
  </style>
</head>
<body>
<main>
  <div class="eyebrow">G3 / Instagram Official</div>
  <h1>Conectar Instagram</h1>
  <p>Usa a sessão criada no G3 Console. O state OAuth é vinculado ao seu usuário e workspace e expira em 10 minutos.</p>
  <button class="primary" id="connect">Iniciar OAuth oficial</button>
  <a href="${consoleBase}">Voltar ao console</a>
  <div class="status muted" id="status">Pronto para iniciar.</div>
</main>
<script>
const CONSOLE_BASE=${safeConsoleBase};
const TOKEN_KEY="g3_console_access_token";
const statusEl=document.getElementById("status");
async function connectInstagram(){
  const accessToken=sessionStorage.getItem(TOKEN_KEY);
  if(!accessToken){statusEl.textContent="Sessão ausente. Volte ao G3 Console e entre novamente.";statusEl.className="status bad";return;}
  statusEl.textContent="Criando state OAuth seguro...";statusEl.className="status muted";
  const response=await fetch(CONSOLE_BASE+"/api/oauth-start",{method:"POST",headers:{authorization:"Bearer "+accessToken}});
  const data=await response.json().catch(()=>({error:"invalid_response"}));
  if(response.status===401){statusEl.textContent="Sessão expirada. Entre novamente no G3 Console.";statusEl.className="status bad";return;}
  if(!response.ok||typeof data.authorizationUrl!=="string"){statusEl.textContent=JSON.stringify(data,null,2);statusEl.className="status bad";return;}
  statusEl.textContent="Redirecionando para autorização oficial do Instagram...";statusEl.className="status ok";
  location.assign(data.authorizationUrl);
}
document.getElementById("connect").addEventListener("click",connectInstagram);
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      ...securityHeaders("text/html; charset=utf-8"),
      "content-security-policy": `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ${supabaseUrl}; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      "cache-control": "no-store"
    }
  });
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
