export function renderConsole(supabaseUrl: string, publishableKey: string): Response {
  const safeUrl = JSON.stringify(supabaseUrl);
  const safeKey = JSON.stringify(publishableKey);
  const edgeBase = `${supabaseUrl}/functions/v1`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>G3 Console</title>
  <style>
    :root{color-scheme:dark;background:#0b0d10;color:#f4f6f8;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0%,#173525 0,#0b0d10 34%);padding:30px 18px}
    main{width:min(1120px,100%);margin:0 auto}.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#75e29f;font-weight:800}
    h1{font-size:clamp(34px,6vw,64px);line-height:.95;margin:14px 0 16px;letter-spacing:-.045em}h2{margin:8px 0 10px;font-size:22px}
    p{color:#9ca7b3;line-height:1.55}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px;margin-top:22px}.wide{grid-column:1/-1}
    .card{border:1px solid #252b31;background:#11151a;border-radius:18px;padding:20px;box-shadow:0 18px 50px #0005}.subgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:0 14px}
    label{display:block;font-size:12px;color:#aeb8c2;margin:13px 0 6px}input,select{width:100%;border:1px solid #303840;background:#0b0f13;color:#f7f9fb;border-radius:10px;padding:11px 12px;outline:none}input:focus,select:focus{border-color:#75e29f}
    button{border:1px solid #303840;background:#171d22;color:#fff;border-radius:10px;padding:11px 14px;font-weight:750;cursor:pointer;margin-top:12px}button.primary{background:#75e29f;color:#071009;border-color:#75e29f}button+button{margin-left:8px}button:disabled{opacity:.42;cursor:not-allowed}
    .status{margin-top:14px;border-radius:12px;padding:12px;background:#0b0f13;border:1px solid #252b31;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto}.ok{color:#75e29f}.bad{color:#ff9d91}.muted{color:#84909b}.hidden{display:none}.pill{display:inline-flex;border:1px solid #2f3a33;background:#13231a;color:#75e29f;border-radius:999px;padding:6px 9px;font-size:12px;font-weight:750}.foot{margin-top:28px;font-size:12px;color:#6f7a84}
    .urls{display:grid;gap:8px;margin-top:12px}.urlrow{padding:10px 12px;border-radius:10px;border:1px solid #252b31;background:#0b0f13}.urlrow b{display:block;font-size:11px;color:#8e9aa5;margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em}.urlrow code{font-size:12px;color:#d8e1e8;overflow-wrap:anywhere}.warning{border:1px solid #493c25;background:#19150f;color:#e7c27d;padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5;margin-top:12px}
  </style>
</head>
<body>
<main>
  <div class="eyebrow">Automation Platform / G3</div>
  <h1>Console operacional gratuito</h1>
  <p>Conta, readiness e HOST PASS no Supabase Free. Workspace admin e operador global são permissões separadas.</p>
  <span class="pill">Supabase Free</span>

  <div class="grid">
    <section class="card">
      <div class="eyebrow">01 / Auth</div><h2>Entrar ou criar conta</h2>
      <label for="email">E-mail</label><input id="email" type="email" autocomplete="email" />
      <label for="password">Senha</label><input id="password" type="password" autocomplete="current-password" minlength="8" />
      <button class="primary" id="signin">Entrar</button><button id="signup">Criar conta</button><button id="logout" class="hidden">Sair</button>
      <div class="status muted" id="auth-status">Nenhuma sessão ativa.</div>
    </section>

    <section class="card">
      <div class="eyebrow">02 / G3 status</div><h2>Evidência real</h2>
      <p>Configuração pronta não equivale a HOST PASS.</p>
      <button class="primary" id="refresh">Atualizar status</button>
      <div class="status muted" id="runtime-status">Autentique para consultar.</div>
    </section>

    <section class="card wide">
      <div class="eyebrow">03 / URLs oficiais</div><h2>Valores para o App Dashboard da Meta</h2>
      <div class="urls">
        <div class="urlrow"><b>OAuth callback</b><code>${edgeBase}/instagram-oauth-callback</code></div>
        <div class="urlrow"><b>Webhook callback</b><code>${edgeBase}/instagram-webhook</code></div>
        <div class="urlrow"><b>Data deletion</b><code>${edgeBase}/instagram-data-deletion</code></div>
        <div class="urlrow"><b>Privacy policy</b><code>${edgeBase}/platform-legal?document=privacy</code></div>
      </div>
    </section>

    <section class="card wide" id="setup-card">
      <div class="eyebrow">04 / Platform setup</div><h2>Configuração global do App Meta</h2>
      <p>Somente um <strong>platform operator</strong> explícito pode alterar estes valores. Ser owner/admin de um workspace não concede essa permissão.</p>
      <div class="warning">Endpoints OAuth continuam vazios até confirmação na documentação/configuração real do App Meta. O Meta App Secret é write-only e nunca volta ao navegador.</div>
      <div class="subgrid">
        <div><label for="legalEntityName">Nome legal / operador</label><input id="legalEntityName" maxlength="200" /></div>
        <div><label for="supportEmail">E-mail de suporte/privacidade</label><input id="supportEmail" type="email" maxlength="320" /></div>
        <div><label for="appId">Meta App ID</label><input id="appId" inputmode="numeric" maxlength="40" /></div>
        <div><label for="metaAppSecret">Meta App Secret (write-only)</label><input id="metaAppSecret" type="password" autocomplete="off" maxlength="512" /></div>
        <div><label for="graphApiVersion">Graph API Version confirmada</label><input id="graphApiVersion" placeholder="ex.: v26.0 — confirme antes" maxlength="12" /></div>
        <div><label for="oauthAuthorizeUrl">OAuth authorize URL</label><input id="oauthAuthorizeUrl" type="url" placeholder="https://..." maxlength="2000" /></div>
        <div><label for="oauthTokenUrl">OAuth token URL</label><input id="oauthTokenUrl" type="url" placeholder="https://..." maxlength="2000" /></div>
        <div><label for="longLivedTokenUrl">Long-lived token URL</label><input id="longLivedTokenUrl" type="url" placeholder="https://..." maxlength="2000" /></div>
        <div><label for="oauthTokenEncoding">Token encoding</label><select id="oauthTokenEncoding"><option value="multipart">multipart</option><option value="urlencoded">urlencoded</option></select></div>
        <div><label for="identityProbePath">Identity probe path (opcional)</label><input id="identityProbePath" placeholder="/caminho-validado" maxlength="500" /></div>
      </div>
      <button class="primary" id="save-setup" disabled>Salvar configuração</button>
      <div class="status muted" id="setup-status">Autentique para consultar sua autorização.</div>
    </section>
  </div>
  <p class="foot">Console operacional de G3. O dashboard Next.js continua sendo a interface principal do produto.</p>
</main>
<script>
const SUPABASE_URL=${safeUrl};
const PUBLISHABLE_KEY=${safeKey};
const CONSOLE_BASE=SUPABASE_URL+"/functions/v1/g3-console";
const TOKEN_KEY="g3_console_access_token";
const authStatus=document.getElementById("auth-status");
const runtimeStatus=document.getElementById("runtime-status");
const setupStatus=document.getElementById("setup-status");
const logoutButton=document.getElementById("logout");
const saveSetupButton=document.getElementById("save-setup");
let platformOperator=false;

function token(){return sessionStorage.getItem(TOKEN_KEY)}
function setSession(data){if(data&&data.access_token)sessionStorage.setItem(TOKEN_KEY,data.access_token);platformOperator=false;syncAuthUi()}
function clearSession(){sessionStorage.removeItem(TOKEN_KEY);platformOperator=false;syncAuthUi()}
function syncAuthUi(){
  const signedIn=Boolean(token());
  logoutButton.classList.toggle("hidden",!signedIn);
  saveSetupButton.disabled=!signedIn||!platformOperator;
  authStatus.textContent=signedIn?"Sessão ativa nesta aba.":"Nenhuma sessão ativa.";
  authStatus.className="status "+(signedIn?"ok":"muted");
  if(!signedIn){setupStatus.textContent="Autentique para consultar sua autorização.";setupStatus.className="status muted"}
  else if(!platformOperator){setupStatus.textContent="Configuração global bloqueada: esta conta ainda não é platform operator.";setupStatus.className="status muted"}
}
async function authRequest(path,payload){const response=await fetch(SUPABASE_URL+path,{method:"POST",headers:{apikey:PUBLISHABLE_KEY,"content-type":"application/json"},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));return{response,data}}
async function signIn(){authStatus.textContent="Autenticando...";const email=document.getElementById("email").value.trim();const password=document.getElementById("password").value;const result=await authRequest("/auth/v1/token?grant_type=password",{email,password});if(!result.response.ok){authStatus.textContent=result.data.msg||result.data.message||"Falha no login.";authStatus.className="status bad";return}setSession(result.data);await loadStatus()}
async function signUp(){authStatus.textContent="Criando conta...";const email=document.getElementById("email").value.trim();const password=document.getElementById("password").value;if(!email||password.length<8){authStatus.textContent="Informe e-mail e senha com pelo menos 8 caracteres.";authStatus.className="status bad";return}const result=await authRequest("/auth/v1/signup",{email,password});if(!result.response.ok){authStatus.textContent=result.data.msg||result.data.message||"Falha no cadastro.";authStatus.className="status bad";return}if(result.data.access_token){setSession(result.data);authStatus.textContent="Conta criada e sessão iniciada.";await loadStatus();return}authStatus.textContent="Conta criada. Se a confirmação de e-mail estiver habilitada, confirme o e-mail e volte aqui para entrar.";authStatus.className="status ok"}
async function authenticatedFetch(path,options){const accessToken=token();if(!accessToken)return new Response(JSON.stringify({error:"authentication_required"}),{status:401,headers:{"content-type":"application/json"}});const headers=Object.assign({},options&&options.headers||{},{authorization:"Bearer "+accessToken});return fetch(CONSOLE_BASE+path,Object.assign({},options||{},{headers}))}
async function loadStatus(){
  if(!token()){runtimeStatus.textContent="Autentique para consultar.";runtimeStatus.className="status muted";platformOperator=false;syncAuthUi();return}
  runtimeStatus.textContent="Consultando control plane...";
  const response=await authenticatedFetch("/api/status");const data=await response.json().catch(()=>({error:"invalid_response"}));
  if(response.status===401){clearSession();runtimeStatus.textContent="Sessão expirada. Entre novamente.";runtimeStatus.className="status bad";return}
  platformOperator=response.ok&&data.platformOperator===true;
  syncAuthUi();
  setupStatus.textContent=platformOperator?"Platform operator verificado. Configuração global habilitada.":"Configuração global bloqueada: esta conta ainda não é platform operator.";
  setupStatus.className="status "+(platformOperator?"ok":"muted");
  runtimeStatus.textContent=JSON.stringify(data,null,2);runtimeStatus.className="status "+(response.ok?"ok":"bad")
}
function field(id){const value=document.getElementById(id).value.trim();return value||null}
async function saveSetup(){
  if(!token()||!platformOperator)return;
  setupStatus.textContent="Salvando pelo control plane...";setupStatus.className="status muted";
  const payload={legalEntityName:field("legalEntityName"),supportEmail:field("supportEmail"),appId:field("appId"),graphApiVersion:field("graphApiVersion"),metaAppSecret:field("metaAppSecret"),oauthAuthorizeUrl:field("oauthAuthorizeUrl"),oauthTokenUrl:field("oauthTokenUrl"),oauthTokenEncoding:document.getElementById("oauthTokenEncoding").value,longLivedTokenUrl:field("longLivedTokenUrl"),identityProbePath:field("identityProbePath")};
  const response=await authenticatedFetch("/api/setup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({error:"invalid_response"}));document.getElementById("metaAppSecret").value="";
  if(response.status===401){clearSession();setupStatus.textContent="Sessão expirada. Entre novamente.";setupStatus.className="status bad";return}
  if(response.status===403){platformOperator=false;syncAuthUi()}
  setupStatus.textContent=JSON.stringify(data,null,2);setupStatus.className="status "+(response.ok?"ok":"bad");if(response.ok)await loadStatus()
}

document.getElementById("signin").addEventListener("click",signIn);
document.getElementById("signup").addEventListener("click",signUp);
document.getElementById("logout").addEventListener("click",()=>{clearSession();runtimeStatus.textContent="Autentique para consultar.";runtimeStatus.className="status muted"});
document.getElementById("refresh").addEventListener("click",loadStatus);
document.getElementById("save-setup").addEventListener("click",saveSetup);
syncAuthUi();if(token())loadStatus();
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ${supabaseUrl}; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      "cache-control": "no-store"
    }
  });
}
