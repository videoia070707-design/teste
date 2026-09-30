import Link from "next/link";
import { can, type WorkspaceRole } from "@automation/core";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { buildInstagramHostPassChallenge } from "@/lib/server/instagram-host-pass";
import { buildInstagramReadinessReport, type ReadinessState } from "@/lib/server/instagram-readiness";

export const dynamic = "force-dynamic";

export default async function InstagramReadinessPage({
  searchParams
}: {
  searchParams: Promise<{ preflight?: string; hostpass?: string }>;
}) {
  const { membership } = await requireWorkspaceContext();
  const sql = getDatabase();
  const report = await buildInstagramReadinessReport(sql, membership.workspaceId);
  const role = membership.role as WorkspaceRole;
  const canManage = can(role, "connections.manage");
  const canHostPassReply = canManage && can(role, "conversation.reply");
  const params = await searchParams;
  const preflight = params.preflight === "ready" || params.preflight === "blocked" ? params.preflight : null;
  const hostPassStatus = normalizeHostPassStatus(params.hostpass);
  const hostPassChallenge = buildInstagramHostPassChallenge(membership.workspaceId);

  const [challengeEvent] = await sql<{ occurred_at: string }[]>`
    select event.occurred_at
    from app_private.canonical_events event
    join app_private.channel_connections connection
      on connection.id = event.connection_id
    where event.workspace_id = ${membership.workspaceId}
      and event.provider = 'instagram.meta.official'
      and event.event_type = 'message.received'
      and event.payload ->> 'text' = ${hostPassChallenge}
      and connection.provider_mode = 'official'
    order by event.occurred_at desc
    limit 1
  `;

  return (
    <>
      <header className="page-header">
        <div className="header-copy">
          <div className="eyebrow">Connections / Instagram / G3</div>
          <h1>Meta Readiness Center</h1>
          <p>
            Separa configuração, confirmações externas e evidência real. Nenhuma checkbox manual
            consegue transformar o G3 em PASS.
          </p>
        </div>
        <span className={`badge ${report.hostPass ? "accent" : "warning"}`}>
          <span className={`status-dot ${report.hostPass ? "healthy" : "warning"}`} />
          {report.hostPass ? "G3 HOST PASS" : "G3 AWAITING LIVE EVIDENCE"}
        </span>
      </header>

      <div className="connection-actions">
        <Link className="button" href="/connections">Voltar para Connections</Link>
        <a className="button primary" href="/api/connections/instagram/start">Conectar / reautorizar Instagram</a>
        {canManage && (
          <form action="/api/connections/instagram/readiness/self-test" method="post">
            <button className="button" type="submit">Executar preflight local</button>
          </form>
        )}
      </div>

      {preflight && (
        <div className={`notice ${preflight === "blocked" ? "warning" : ""}`} style={{ marginTop: 16 }}>
          {preflight === "ready"
            ? "Preflight local passou: configuração estrutural + challenge criptográfico estão prontos. Isso NÃO conta como HOST PASS."
            : "Preflight local bloqueado: uma ou mais configurações estruturais ainda precisam ser corrigidas. Nenhuma evidência real foi alterada."}
        </div>
      )}

      {hostPassStatus && (
        <div className={`notice ${hostPassStatus.tone}`} style={{ marginTop: 16 }}>
          {hostPassStatus.message}
        </div>
      )}

      <section className="section grid two">
        <article className="card">
          <div className="eyebrow">Runtime configuration</div>
          <h2>{report.configurationReady ? "Configuração pronta" : "Configuração ainda bloqueada"}</h2>
          <p>Somente presença/validade estrutural é mostrada. Nenhum secret é renderizado.</p>
          {report.configuration.map((item) => (
            <div className="key-value" key={item.key} title={item.detail}>
              <span>{item.label}</span>
              <strong className={stateClass(item.state)}>{item.state}</strong>
            </div>
          ))}
        </article>

        <article className="card">
          <div className="eyebrow">Provider URLs</div>
          <h2>Valores para o App Dashboard da Meta</h2>
          <p>Derivados de APP_ORIGIN para impedir callback divergente entre ambientes.</p>
          <UrlRow label="App origin" value={report.urls.appOrigin} />
          <UrlRow label="OAuth redirect URI" value={report.urls.oauthRedirect} />
          <UrlRow label="Webhook callback" value={report.urls.webhookCallback} />
          <UrlRow label="Privacy Policy" value={report.urls.privacyPolicy} />
          <UrlRow label="Data deletion" value={report.urls.dataDeletion} />
        </article>
      </section>

      <section className="section grid two">
        <article className="card">
          <div className="eyebrow">Required permissions</div>
          <h2>Instagram Login</h2>
          <p>Permissões mínimas do G3 atual. Content publishing continua capability separada.</p>
          <div className="capabilities">
            {report.permissions.map((permission) => (
              <span className="capability on mono" key={permission}>{permission}</span>
            ))}
          </div>
          <div className="notice warning" style={{ marginTop: 16 }}>
            A plataforma não oferece DM fria como capability oficial. O Send API só enfileira resposta para uma identidade observada em message.received verificado na mesma conexão.
          </div>
        </article>

        <article className="card">
          <div className="eyebrow">HOST PASS evidence</div>
          <h2>Prova funcional, não checklist</h2>
          <p>Esses sinais são derivados do banco a partir de tráfego real do provider.</p>
          {report.liveEvidence.map((item) => (
            <div className="key-value" key={item.key}>
              <span>{item.label}</span>
              <strong className={stateClass(item.state)}>{item.state}</strong>
            </div>
          ))}
        </article>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="eyebrow">Guided live test</div>
            <h2>Fechar o G3 sem escolher contato errado</h2>
          </div>
          <p>usa somente uma DM com challenge exato</p>
        </div>
        <div className="grid two">
          <article className="card">
            <div className="eyebrow">Passo 1</div>
            <h2>Envie esta frase pela conta tester</h2>
            <p>Depois que o webhook real for processado, a plataforma reconhecerá o challenge automaticamente.</p>
            <div className="notice mono">{hostPassChallenge}</div>
            <div className="key-value">
              <span>Challenge inbound</span>
              <strong className={challengeEvent ? "good" : "warn"}>{challengeEvent ? "OBSERVED" : "WAITING"}</strong>
            </div>
            {challengeEvent && (
              <div className="key-value">
                <span>Observed at</span>
                <strong>{formatDate(challengeEvent.occurred_at)}</strong>
              </div>
            )}
          </article>

          <article className="card">
            <div className="eyebrow">Passo 2</div>
            <h2>Responder somente ao challenge verificado</h2>
            <p>O botão busca a mensagem com a frase acima e enfileira uma única resposta idempotente para aquele sender. Ele nunca usa “último contato”.</p>
            {challengeEvent && canHostPassReply ? (
              <form action="/api/connections/instagram/readiness/send-test-reply" method="post">
                <button className="button primary" type="submit">Enfileirar resposta HOST PASS</button>
              </form>
            ) : (
              <button className="button" type="button" disabled>
                {challengeEvent ? "Permissão insuficiente" : "Aguardando challenge real"}
              </button>
            )}
            <p className="muted" style={{ marginTop: 12 }}>
              O clique não marca PASS. O outbound worker ainda precisa receber um provider_message_id real da Meta.
            </p>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="eyebrow">External readiness</div>
            <h2>Meta/App Review operational checklist</h2>
          </div>
          <p>attestation only — never HOST PASS evidence</p>
        </div>

        <div className="grid two">
          {report.external.map((item) => (
            <article className="card compact" key={item.key}>
              <div className="connection-head">
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <span className={`badge ${attestationClass(item.attestationStatus)}`}>
                  {item.attestationStatus ?? "UNCONFIRMED"}
                </span>
              </div>

              {canManage ? (
                <form className="reconciliation-form" action="/api/connections/instagram/readiness/attest" method="post">
                  <input type="hidden" name="checkKey" value={item.key} />
                  <label className="field-label" htmlFor={`status-${item.key}`}>Estado</label>
                  <select className="field-control" id={`status-${item.key}`} name="status" defaultValue={item.attestationStatus ?? "confirmed"}>
                    <option value="confirmed">Confirmed</option>
                    <option value="blocked">Blocked</option>
                    <option value="not_applicable">Not applicable</option>
                  </select>
                  <label className="field-label" htmlFor={`note-${item.key}`}>Nota operacional (opcional)</label>
                  <input className="field-control" id={`note-${item.key}`} name="note" defaultValue={item.note ?? ""} maxLength={500} />
                  <button className="button" type="submit">Salvar attestation</button>
                </form>
              ) : (
                <p className="muted">Seu role pode visualizar, mas não alterar readiness.</p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="notice">
          G3 passa somente quando OAuth real, uma mensagem recebida real normalizada e uma resposta DM real com provider_message_id coexistem neste workspace. Webhook assinado é exibido separadamente para diagnóstico e continua obrigatório operacionalmente.
        </div>
      </section>
    </>
  );
}

function UrlRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="key-value">
      <span>{label}</span>
      <strong className="mono">{value ?? "BLOCKED"}</strong>
    </div>
  );
}

function stateClass(state: ReadinessState): string {
  if (state === "READY") return "good";
  if (state === "EXTERNAL") return "warn";
  return "bad";
}

function attestationClass(status: string | null): string {
  if (status === "confirmed") return "good";
  if (status === "blocked") return "danger";
  if (status === "not_applicable") return "muted";
  return "warning";
}

function normalizeHostPassStatus(value: string | undefined): { message: string; tone: "" | "warning" } | null {
  switch (value) {
    case "reply_queued": return { message: "Resposta HOST PASS enfileirada. Aguarde o outbound worker e a evidência real da Meta; nenhum PASS foi forçado.", tone: "" };
    case "reply_already_queued": return { message: "Este challenge já possui uma resposta HOST PASS enfileirada. A idempotência bloqueou duplicação.", tone: "" };
    case "challenge_not_seen": return { message: "O challenge ainda não apareceu como message.received real. Envie a frase exata pela conta tester e aguarde o webhook.", tone: "warning" };
    case "auth_invalid": return { message: "A conexão perdeu autorização. Reautorize o Instagram antes de responder ao challenge.", tone: "warning" };
    case "recipient_not_observed": return { message: "O sender do challenge não foi reconhecido como identidade inbound verificada. Nenhuma mensagem foi enviada.", tone: "warning" };
    case "connection_not_found": return { message: "A conexão oficial do challenge não está mais disponível. Nenhuma mensagem foi enviada.", tone: "warning" };
    default: return null;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace("T", " ").replace(".000Z", "Z");
}
