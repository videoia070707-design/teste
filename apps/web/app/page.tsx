import { requireWorkspaceContext } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const metrics = [
  ["Connected channels", "0", "G3/G4 onboarding pending credentials"],
  ["Canonical events", "0", "Durable event pipeline initialized"],
  ["Unknown sends", "0", "Blind retry blocked until reconciliation"],
  ["Reliability health", "PASS", "G2 typecheck + tests + build green"]
] as const;

const milestones = [
  ["G0", "Product/API Readiness", "DONE"],
  ["G1", "Core SaaS + verified auth", "DONE"],
  ["G2", "Provider + Reliability Core", "PASS"],
  ["G3", "Instagram Official", "IN PROGRESS"]
] as const;

export default async function OverviewPage() {
  const { membership } = await requireWorkspaceContext();

  return (
    <>
      <header className="page-header">
        <div className="header-copy">
          <div className="eyebrow">{membership.workspaceName} / {membership.role}</div>
          <h1>Automação que mostra o que realmente aconteceu.</h1>
          <p>
            Base independente para Instagram e WhatsApp, com sessão verificada,
            providers desacoplados, health por capability e reliability antes de expansão funcional.
          </p>
        </div>
        <span className="badge accent"><span className="status-dot healthy" /> Official core verified</span>
      </header>

      <section className="grid metrics">
        {metrics.map(([label, value, note]) => (
          <article className="card compact" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
            <div className="metric-note">{note}</div>
          </article>
        ))}
      </section>

      <section className="section">
        <div className="section-head">
          <div><div className="eyebrow">Roadmap</div><h2>Gate status</h2></div>
          <p>Sem pular reliability</p>
        </div>
        <div className="table">
          <div className="table-row header"><span>Gate</span><span>Scope</span><span>Status</span><span>Policy</span></div>
          {milestones.map(([gate, scope, status]) => (
            <div className="table-row" key={gate}>
              <strong className="mono">{gate}</strong>
              <span>{scope}</span>
              <span className={status === "DONE" || status === "PASS" ? "good" : "warn"}>{status}</span>
              <span className="muted">HOST PASS required</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section grid two">
        <article className="card">
          <div className="eyebrow">Architecture</div>
          <h2>Official-first, provider-independent</h2>
          <p>
            O domínio não conhece detalhes da Meta. Instagram Official, WhatsApp Cloud e
            futuros Browser Lab implementam o mesmo contrato e anunciam capabilities próprias.
          </p>
          <div className="capabilities">
            <span className="capability on">Verified Auth</span>
            <span className="capability on">Workspace RBAC</span>
            <span className="capability on">Provider Contract</span>
            <span className="capability on">Health State Machine</span>
            <span className="capability beta">Browser Lab isolated</span>
          </div>
        </article>
        <article className="card">
          <div className="eyebrow">Reliability invariant</div>
          <h2>Timeout não significa falha.</h2>
          <p>
            Um envio sem resposta conclusiva entra em SEND_RESULT_UNKNOWN. A plataforma
            reconcilia antes de permitir retry, evitando duplicar mensagens legítimas.
          </p>
          <div className="notice">Unknown outcome → reconcile → confirm sent / confirm failed / safe retry.</div>
        </article>
      </section>
    </>
  );
}
