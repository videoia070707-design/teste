export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const entity = process.env.LEGAL_ENTITY_NAME?.trim();
  const supportEmail = process.env.SUPPORT_EMAIL?.trim();

  if (!entity || !supportEmail) {
    return htmlResponse(
      "Data deletion instructions unavailable",
      "This deployment has not configured LEGAL_ENTITY_NAME and SUPPORT_EMAIL yet.",
      503
    );
  }

  const safeEntity = escapeHtml(entity);
  const safeEmail = escapeHtml(supportEmail);
  const body = `
    <h1>Exclusão de Dados</h1>
    <p><strong>Operador:</strong> ${safeEntity}</p>
    <p>Usuários podem solicitar exclusão de dados pessoais e dados de integração mantidos pela plataforma.</p>

    <h2>Como solicitar</h2>
    <ol>
      <li>Envie um e-mail para <a href="mailto:${safeEmail}?subject=Solicita%C3%A7%C3%A3o%20de%20exclus%C3%A3o%20de%20dados">${safeEmail}</a> com o assunto <strong>Solicitação de exclusão de dados</strong>.</li>
      <li>Informe o e-mail da conta da plataforma e, quando aplicável, o workspace ou canal conectado relacionado à solicitação.</li>
      <li>Podemos solicitar confirmação de identidade antes de executar a exclusão para evitar remoção indevida de dados de terceiros.</li>
    </ol>

    <h2>O que é removido</h2>
    <p>Quando aplicável, removemos ou anonimizamos dados pessoais do workspace, referências de conexões, credenciais criptografadas, dados de conversas e eventos, observadas as obrigações legais, de segurança e de auditoria que exijam retenção limitada.</p>

    <h2>Desconexão de providers</h2>
    <p>Ao excluir uma integração, a plataforma remove suas referências de credencial. O usuário também pode revogar o acesso diretamente nas configurações do provider quando desejar.</p>

    <h2>Contato</h2>
    <p>Dúvidas sobre exclusão podem ser enviadas para <a href="mailto:${safeEmail}">${safeEmail}</a>.</p>

    <p class="foot">Estas instruções devem ser revisadas pelo responsável jurídico antes do lançamento comercial.</p>
  `;

  return htmlResponse(`Exclusão de Dados — ${safeEntity}`, body, 200, true);
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
