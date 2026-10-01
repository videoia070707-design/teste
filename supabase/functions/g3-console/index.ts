import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CONTROL_SLUG = "g3-control";
const MAX_PROXY_BODY_BYTES = 16_384;

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const relativePath = url.pathname.endsWith("/api/status")
    ? "/api/status"
    : url.pathname.endsWith("/api/setup")
      ? "/api/setup"
      : "/";

  if (request.method === "GET" && relativePath === "/") {
    return renderConsole();
  }

  if (relativePath === "/api/status" && request.method === "GET") {
    return proxyControl(request, "status", "GET");
  }

  if (relativePath === "/api/setup" && request.method === "POST") {
    return proxyControl(request, "setup", "POST");
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
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "authentication_required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = defaultPublishableKey();
  if (!supabaseUrl || !publishableKey) {
    return json({ error: "console_runtime_not_configured" }, 503);
  }

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

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${CONTROL_SLUG}/${action}`, {
      method,
      headers: {
        "authorization": authorization,
        "apikey": publishableKey,
        ...(method === "POST" ? { "content-type": "application/json" } : {})
      },
      ...(body !== undefined ? { body } : {})
    });

    const responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...securityHeaders(response.headers.get("content-type") ?? "application/json; charset=utf-8"),
        "cache-control": "no-store"
      }
    });
  } catch {
    return json({ error: "control_plane_unreachable" }, 503);
  }
}

function renderConsole(): Response {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = defaultPublishableKey();
  if (!supabaseUrl || !publishableKey) {
    return new Response("G3 Console runtime is not configured.", {
      status: 503,
      headers: securityHeaders("text/plain; charset=utf-8")
    });
  }

  const safeUrl = JSON.stringify(supabaseUrl);
  const safeKey = JSON.stringify(publishableKey);

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>G3 Console</title>
  <style>
    :root{color-scheme:dark;background:#0b0d10;color:#f4f6f8;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0%,#173525 0,#0b0d10 34%);padding:32px 18px}
    main{width:min(920px,100%);margin:0 auto}.eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#75e29f;font-weight:700}
    h1{font-size:clamp(34px,6vw,64px);line-height:.95;margin:14px 0 16px;letter-spacing:-.045em}p{color:#9ca7b3;line-height:1.6}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:28px}.card{border:1px solid #252b31;background:#11151a;border-radius:18px;padding:20px;box-shadow:0 18px 50px #0005}
    label{display:block;font-size:12px;color:#aeb8c2;margin:14px 0 6px}input{width:100%;border:1px solid #303840;background:#0b0f13;color:#f7f9fb;border-radius:10px;padding:12px 13px;outline:none}input:focus{border-color:#75e29f}
    button{border:1px solid #303840;background:#171d22;color:#fff;border-radius:10px;padding:11px 14px;font-weight:700;cursor:pointer;margin-top:12px}button.primary{background:#75e29f;color:#071009;border-color:#75e29f}button+button{margin-left:8px}
    .status{margin-top:16px;border-radius:12px;padding:12px;background:#0b0f13;border:1px solid #252b31;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.ok{color:#75e29f}.bad{color:#ff9d91}.muted{color:#84909b}.hidden{display:none}.pill{display:inline-flex;border:1px solid #2f3a33;background:#13231a;color:#75e29f;border-radius:999px;padding:6px 9px;font-size:12px;font-weight:700}.foot{margin-top:30px;font-size:12px;color:#6f7a84}
  </style>
</head>
<body>
<main>
  <div class="eyebrow">Automation Platform / G3</div>
  <h1>Console operacional gratuito</h1>
  <p>Login e configuração do HOST PASS executados no próprio Supabase. Nenhum worker pago e nenhum segredo é gravado no navegador de forma persistente.</p>
  <span class="pill">Supabase Free</span>

  <div class="grid">
    <section class="card" id="auth-card">
      <div class="eyebrow">01 / Auth</div>
      <h2>Entrar ou criar conta</h2>
      <label for="email">E-mail</label>
      <input id="email" type="email" autocomplete="email" />
      <label for="password">Senha</label>
      <input id="password" type="password" autocomplete="current-password" minlength="8" />
      <button class="primary" id="signin">Entrar</button>
      <button id="signup">Criar conta</button>
      <button id="logout" class="hidden">Sair</button>
      <div class="status muted" id="auth-status">Nenhuma sessão ativa.</div>
    </section>

    <section class="card">
      <div class="eyebrow">02 / Runtime</div>
      <h2>Status real do G3</h2>
      <p>Após autenticar, o console chama o control plane server-side. O navegador não recebe senha de banco, keyring ou Meta App Secret.</p>
      <button class="primary" id="refresh">Atualizar status</button>
      <div class="status muted" id="runtime-status">Autentique para consultar.</div>
    </section>
  </div>

  <p class="foot">Este console é operacional e temporário para G3/HOST PASS. O dashboard Next.js continua sendo a interface principal do produto.</p>
</main>
<script>
const SUPABASE_URL = ${safeUrl};
const PUBLISHABLE_KEY = ${safeKey};
const TOKEN_KEY = "g3_console_access_token";
const REFRESH_KEY = "g3_console_refresh_token";
const authStatus = document.getElementById("auth-status");
const runtimeStatus = document.getElementById("runtime-status");
const logoutButton = document.getElementById("logout");

function token(){ return sessionStorage.getItem(TOKEN_KEY); }
function setSession(data){
  if(data?.access_token){ sessionStorage.setItem(TOKEN_KEY,data.access_token); }
  if(data?.refresh_token){ sessionStorage.setItem(REFRESH_KEY,data.refresh_token); }
  syncAuthUi();
}
function clearSession(){ sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(REFRESH_KEY); syncAuthUi(); }
function syncAuthUi(){
  const signedIn = Boolean(token());
  logoutButton.classList.toggle("hidden", !signedIn);
  authStatus.textContent = signedIn ? "Sessão ativa nesta aba." : "Nenhuma sessão ativa.";
  authStatus.className = "status " + (signedIn ? "ok" : "muted");
}
async function authRequest(path, payload){
  const response = await fetch(SUPABASE_URL + path, {
    method:"POST",
    headers:{"apikey":PUBLISHABLE_KEY,"content-type":"application/json"},
    body:JSON.stringify(payload)
  });
  const data = await response.json().catch(()=>({}));
  return { response, data };
}
async function signIn(){
  authStatus.textContent = "Autenticando...";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const {response,data} = await authRequest("/auth/v1/token?grant_type=password",{email,password});
  if(!response.ok){ authStatus.textContent = data?.msg || data?.message || "Falha no login."; authStatus.className="status bad"; return; }
  setSession(data); await loadStatus();
}
async function signUp(){
  authStatus.textContent = "Criando conta...";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if(!email || password.length < 8){ authStatus.textContent="Informe e-mail e senha com pelo menos 8 caracteres."; authStatus.className="status bad"; return; }
  const {response,data} = await authRequest("/auth/v1/signup",{email,password});
  if(!response.ok){ authStatus.textContent = data?.msg || data?.message || "Falha no cadastro."; authStatus.className="status bad"; return; }
  if(data?.access_token){ setSession(data); authStatus.textContent="Conta criada e sessão iniciada."; await loadStatus(); return; }
  authStatus.textContent="Conta criada. Se a confirmação de e-mail estiver habilitada, confirme o e-mail e volte aqui para entrar.";
  authStatus.className="status ok";
}
async function loadStatus(){
  const accessToken = token();
  if(!accessToken){ runtimeStatus.textContent="Autentique para consultar."; runtimeStatus.className="status muted"; return; }
  runtimeStatus.textContent="Consultando control plane...";
  const response = await fetch("./g3-console/api/status", { headers:{"authorization":"Bearer "+accessToken} });
  const data = await response.json().catch(()=>({error:"invalid_response"}));
  if(response.status===401){ clearSession(); runtimeStatus.textContent="Sessão expirada. Entre novamente."; runtimeStatus.className="status bad"; return; }
  runtimeStatus.textContent = JSON.stringify(data,null,2);
  runtimeStatus.className = "status " + (response.ok ? "ok" : "bad");
}

document.getElementById("signin").addEventListener("click",signIn);
document.getElementById("signup").addEventListener("click",signUp);
document.getElementById("logout").addEventListener("click",()=>{clearSession();runtimeStatus.textContent="Autentique para consultar.";runtimeStatus.className="status muted";});
document.getElementById("refresh").addEventListener("click",loadStatus);
syncAuthUi(); if(token()) loadStatus();
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
