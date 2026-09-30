import Link from "next/link";
import { can, type WorkspaceRole } from "@automation/core";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { buildInstagramReadinessReport, type ReadinessState } from "@/lib/server/instagram-readiness";

export const dynamic = "force-dynamic";

export default async function InstagramReadinessPage() {
  const { membership } = await requireWorkspaceContext();
  const report = await buildInstagramReadinessReport(getDatabase(), membership.workspaceId);
  const canManage = can(membership.role as WorkspaceRole, "connections.manage");

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
      </div>

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
            A plataforma não oferece DM fria como capability oficial. O Send API é usado dentro das regras da conversa elegível.
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
