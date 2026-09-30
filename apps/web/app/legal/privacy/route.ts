export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const entity = process.env.LEGAL_ENTITY_NAME?.trim();
  const supportEmail = process.env.SUPPORT_EMAIL?.trim();

  if (!entity || !supportEmail) {
    return htmlResponse(
      "Privacy Policy unavailable",
      "This deployment has not configured LEGAL_ENTITY_NAME and SUPPORT_EMAIL yet.",
      503
    );
  }

  const safeEntity = escapeHtml(entity);
  const safeEmail = escapeHtml(supportEmail);
  const body = `
    <h1>Política de Privacidade</h1>
    <p><strong>Operador:</strong> ${safeEntity}</p>
    <p>Esta política descreve como a plataforma de automação conversacional trata dados necessários para conectar, operar e diagnosticar integrações autorizadas com canais como Instagram e WhatsApp.</p>

    <h2>Dados tratados</h2>
    <p>Podemos tratar dados de conta e workspace, identificadores de canais conectados, credenciais de provider armazenadas de forma criptografada, mensagens e eventos necessários à automação, estados de entrega, registros técnicos, auditoria e métricas de uso.</p>

    <h2>Finalidades</h2>
    <p>Os dados são usados para autenticação, execução de automações configuradas pelo usuário, entrega e recebimento de mensagens, suporte, segurança, prevenção de duplicidade, diagnóstico de falhas, auditoria e melhoria operacional do serviço.</p>

    <h2>Compartilhamento e subprocessadores</h2>
    <p>Dados podem ser transmitidos aos provedores de canal e infraestrutura estritamente quando necessário para executar o serviço contratado, incluindo APIs oficiais da Meta e provedores de autenticação, banco de dados, hospedagem e observabilidade configurados para a implantação.</p>

    <h2>Segurança</h2>
    <p>Segredos de providers são mantidos fora do navegador e armazenados com criptografia de aplicação. A plataforma utiliza isolamento por workspace, trilhas de auditoria e controles de acesso baseados em função.</p>

    <h2>Retenção e exclusão</h2>
    <p>Dados são mantidos pelo período necessário à prestação do serviço, segurança, auditoria e obrigações legais aplicáveis. Solicitações de exclusão podem ser feitas pelo canal abaixo e são processadas respeitando obrigações legítimas de retenção.</p>

    <h2>Direitos e contato</h2>
    <p>Para solicitações de acesso, correção, portabilidade, oposição ou exclusão de dados, entre em contato por <a href="mailto:${safeEmail}">${safeEmail}</a>.</p>

    <p class="foot">Esta página é gerada pela implantação configurada de ${safeEntity}. A política deve ser revisada pelo responsável jurídico antes do lançamento comercial.</p>
  `;

  return htmlResponse(`Política de Privacidade — ${safeEntity}`, body, 200, true);
}

function htmlResponse(title: string, body: string, status: number, bodyIsHtml = false): Response {
  const renderedBody = bodyIsHtml ? body : `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>`;
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{max-width:820px;margin:0 auto;padding:48px 24px;font:16px/1.65 system-ui,-apple-system,sans-serif;color:#16181b;background:#fff}h1{font-size:36px;line-height:1.1}h2{margin-top:32px;font-size:20px}a{color:#2457c5}.foot{margin-top:42px;padding-top:18px;border-top:1px solid #ddd;color:#666;font-size:13px}</style></head><body>${renderedBody}</body></html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
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
