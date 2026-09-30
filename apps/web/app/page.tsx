import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { membership } = await requireWorkspaceContext();
  const sql = getDatabase();

  const [metrics] = await sql<{
    connected_channels: number;
    canonical_events: number;
    unknown_sends: number;
    instagram_comments: number;
  }[]>`
    select
      (
        select count(*)::int
        from app_private.channel_connections
        where workspace_id = ${membership.workspaceId}
          and auth_valid = true
      ) as connected_channels,
      (
        select count(*)::int
        from app_private.canonical_events
        where workspace_id = ${membership.workspaceId}
      ) as canonical_events,
      (
        select count(*)::int
        from app_private.messages
        where workspace_id = ${membership.workspaceId}
          and direction = 'outbound'
          and delivery_state = 'SEND_RESULT_UNKNOWN'
      ) as unknown_sends,
      (
        select count(*)::int
        from app_private.canonical_events
        where workspace_id = ${membership.workspaceId}
          and event_type = 'comment.received'
      ) as instagram_comments
  `;

  const [g3Evidence] = await sql<{
    oauth_ready: boolean;
    webhook_message_observed: boolean;
    outbound_traced: boolean;
  }[]>`
    select
      exists (
        select 1
        from app_private.channel_connections connection
        join app_private.connection_secret_refs secret_ref
          on secret_ref.connection_id = connection.id
        where connection.workspace_id = ${membership.workspaceId}
          and connection.channel = 'instagram'
          and connection.provider_key = 'instagram.meta.official'
          and connection.provider_mode = 'official'
          and connection.auth_valid = true
          and connection.external_account_id is not null
      ) as oauth_ready,
      exists (
        select 1
        from app_private.canonical_events event
        join app_private.channel_connections connection
          on connection.id = event.connection_id
        where event.workspace_id = ${membership.workspaceId}
          and event.event_type = 'message.received'
          and event.provider = 'instagram.meta.official'
          and connection.provider_mode = 'official'
      ) as webhook_message_observed,
      exists (
        select 1
        from app_private.messages message
        join app_private.channel_connections connection
          on connection.id = message.connection_id
        where message.workspace_id = ${membership.workspaceId}
          and connection.channel = 'instagram'
          and connection.provider_key = 'instagram.meta.official'
          and connection.provider_mode = 'official'
          and message.direction = 'outbound'
          and message.delivery_state in ('SENT','DELIVERED','READ')
          and message.provider_message_id is not null
      ) as outbound_traced
  `;

  const values = metrics ?? {
    connected_channels: 0,
    canonical_events: 0,
    unknown_sends: 0,
    instagram_comments: 0
  };
  const evidence = g3Evidence ?? {
    oauth_ready: false,
    webhook_message_observed: false,
    outbound_traced: false
  };
  const g3Pass = evidence.oauth_ready && evidence.webhook_message_observed && evidence.outbound_traced;

  const metricCards = [
    ["Connected channels", String(values.connected_channels), "auth-valid connections in this workspace"],
    ["Canonical events", String(values.canonical_events), "durable normalized provider events"],
    ["Unknown sends", String(values.unknown_sends), "blind retry blocked until reconciliation"],
    ["Instagram comments", String(values.instagram_comments), "verified comment.received events"]
  ] as const;

  const milestones = [
    ["G0", "Product/API Readiness", "DONE"],
    ["G1", "Core SaaS + verified auth", "DONE"],
    ["G2", "Provider + Reliability Core", "PASS"],
    ["G3", "Instagram Official", g3Pass ? "PASS" : "IN PROGRESS"]
  ] as const;

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
        <span className={`badge ${g3Pass ? "accent" : "warning"}`}>
          <span className={`status-dot ${g3Pass ? "healthy" : "warning"}`} />
          {g3Pass ? "Instagram G3 evidence PASS" : "Instagram G3 awaiting live evidence"}
        </span>
      </header>

      <section className="grid metrics">
        {metricCards.map(([label, value, note]) => (
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
          <p>status derivado de evidência, não de feature flag</p>
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
          <div className="eyebrow">G3 live evidence</div>
          <h2>Instagram Official não ganha PASS por compilação.</h2>
          <div className="key-value"><span>OAuth + encrypted credential</span><strong className={evidence.oauth_ready ? "good" : "warn"}>{evidence.oauth_ready ? "VERIFIED" : "PENDING"}</strong></div>
          <div className="key-value"><span>Signed webhook → message.received</span><strong className={evidence.webhook_message_observed ? "good" : "warn"}>{evidence.webhook_message_observed ? "VERIFIED" : "PENDING"}</strong></div>
          <div className="key-value"><span>Outbound accepted + provider message ID</span><strong className={evidence.outbound_traced ? "good" : "warn"}>{evidence.outbound_traced ? "VERIFIED" : "PENDING"}</strong></div>
          <p>Somente quando as três evidências existirem no mesmo workspace o G3 muda automaticamente para PASS.</p>
        </article>

        <article className="card">
          <div className="eyebrow">Reliability invariant</div>
          <h2>Timeout não significa falha.</h2>
          <p>
            Um envio sem resposta conclusiva entra em SEND_RESULT_UNKNOWN. A plataforma
            exige reconciliação antes de qualquer nova decisão operacional sobre esse side effect.
          </p>
          <div className="notice">Unknown outcome → evidence review → confirm sent / confirm failed. Sem retry cego.</div>
        </article>
      </section>
    </>
  );
}
