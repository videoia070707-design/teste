import postgres from "npm:postgres@3.4.9";

type LegalDocument = "privacy" | "data-deletion";

interface PublicConfigRow {
  config_key: string;
  config_value: string | null;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET" }
    });
  }

  const databaseUrl = Deno.env.get("SUPABASE_DB_URL")?.trim();
  if (!databaseUrl) return htmlUnavailable("Legal document unavailable", 503);

  const document = parseDocument(new URL(request.url));
  if (!document) return htmlUnavailable("Legal document not found", 404);

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 10
  });

  try {
    const rows = await sql<PublicConfigRow[]>`
      select config_key, config_value
      from app_private.platform_public_config
      where config_key in ('legal_entity_name', 'support_email')
    `;

    const config = new Map(rows.map((row) => [row.config_key, row.config_value?.trim() || null]));
    const entity = config.get("legal_entity_name") ?? null;
    const supportEmail = config.get("support_email") ?? null;

    if (!entity || !supportEmail || !isEmail(supportEmail)) {
      return htmlUnavailable("Legal document configuration incomplete", 503);
    }

    return document === "privacy"
      ? privacyResponse(entity, supportEmail)
      : deletionInstructionsResponse(entity, supportEmail);
  } catch (error) {
    console.error("platform-legal failed", safeErrorCode(error));
    return htmlUnavailable("Legal document unavailable", 503);
  } finally {
    await sql.end({ timeout: 3 });
  }
});

function parseDocument(url: URL): LegalDocument | null {
  const query = url.searchParams.get("document")?.trim();
  if (query === "privacy" || query === "data-deletion") return query;

  const suffix = url.pathname.split("/").filter(Boolean).at(-1);
  if (suffix === "privacy" || suffix === "data-deletion") return suffix;
  return null;
}

function privacyResponse(entity: string, supportEmail: string): Response {
  const safeEntity = escapeHtml(entity);
  const safeEmail = escapeHtml(supportEmail);
  return htmlResponse(
    `Política de Privacidade — ${safeEntity}`,
    `
      <h1>Política de Privacidade</h1>
      <p><strong>Operador:</strong> ${safeEntity}</p>
      <p>Esta política descreve como a plataforma trata dados necessários para autenticação, conexão de canais, automações, atendimento e operação de integrações autorizadas pelos usuários.</p>

      <h2>Dados tratados</h2>
      <p>Podemos tratar dados de conta da plataforma, identificadores de workspace, dados de conexão fornecidos pelos provedores, eventos de mensagens/comentários, registros operacionais, configurações de automação e dados técnicos necessários para segurança e confiabilidade.</p>

      <h2>Finalidades</h2>
      <p>Os dados são utilizados para autenticar usuários, executar integrações solicitadas, processar automações, entregar mensagens autorizadas, fornecer suporte, prevenir duplicidades, investigar falhas e manter trilhas de auditoria.</p>

      <h2>Credenciais e segredos</h2>
      <p>Credenciais de provedores são tratadas somente no servidor e armazenadas de forma criptografada. Segredos não são expostos em interfaces públicas.</p>

      <h2>Compartilhamento</h2>
      <p>Dados podem ser processados pelos provedores necessários à operação da integração escolhida pelo usuário, como serviços de autenticação, banco de dados e APIs oficiais de canais conectados.</p>

      <h2>Retenção e exclusão</h2>
      <p>Dados são mantidos pelo período necessário à operação, segurança, auditoria e obrigações aplicáveis. Solicitações de exclusão podem ser feitas conforme as instruções publicadas pela plataforma.</p>

      <h2>Contato</h2>
      <p>Solicitações relacionadas a privacidade podem ser enviadas para <a href="mailto:${safeEmail}">${safeEmail}</a>.</p>

      <p class="foot">Este documento operacional deve passar por revisão jurídica antes de lançamento comercial amplo.</p>
    `
  );
}

function deletionInstructionsResponse(entity: string, supportEmail: string): Response {
  const safeEntity = escapeHtml(entity);
  const safeEmail = escapeHtml(supportEmail);
  return htmlResponse(
    `Exclusão de Dados — ${safeEntity}`,
    `
      <h1>Exclusão de Dados</h1>
      <p><strong>Operador:</strong> ${safeEntity}</p>
      <p>Usuários podem solicitar exclusão ou anonimização de dados pessoais e dados de integrações mantidos pela plataforma, observadas retenções legais e de segurança aplicáveis.</p>

      <h2>Como solicitar</h2>
      <ol>
        <li>Envie um e-mail para <a href="mailto:${safeEmail}?subject=Solicita%C3%A7%C3%A3o%20de%20exclus%C3%A3o%20de%20dados">${safeEmail}</a>.</li>
        <li>Informe o e-mail da conta e, quando aplicável, o workspace ou canal conectado.</li>
        <li>Poderemos solicitar confirmação de identidade antes de executar a exclusão.</li>
      </ol>

      <h2>Dados de providers</h2>
      <p>Quando o provider disponibiliza um callback oficial de exclusão, a plataforma também processa esse fluxo e fornece um código de confirmação rastreável.</p>

      <h2>Contato</h2>
      <p>Dúvidas sobre exclusão podem ser enviadas para <a href="mailto:${safeEmail}">${safeEmail}</a>.</p>

      <p class="foot">Estas instruções devem passar por revisão jurídica antes de lançamento comercial amplo.</p>
    `
  );
}

function htmlUnavailable(message: string, status: number): Response {
  return htmlResponse(message, `<h1>${escapeHtml(message)}</h1>`, status);
}

function htmlResponse(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{max-width:820px;margin:0 auto;padding:48px 24px;font:16px/1.65 system-ui,-apple-system,sans-serif;color:#16181b;background:#fff}h1{font-size:36px;line-height:1.1}h2{margin-top:32px;font-size:20px}a{color:#2457c5}.foot{margin-top:42px;padding-top:18px;border-top:1px solid #ddd;color:#666;font-size:13px}</style></head><body>${body}</body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer"
      }
    }
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return character;
    }
  });
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN_ERROR";
  const normalized = error.message.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 120) || "UNKNOWN_ERROR";
}
