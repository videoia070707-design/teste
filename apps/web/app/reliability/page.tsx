import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";

export const dynamic = "force-dynamic";

export default async function ReliabilityPage() {
  const { membership } = await requireWorkspaceContext();
  const sql = getDatabase();

  const [metrics] = await sql<{
    unknown_sends: number;
    dead_messages: number;
    pending_ingress: number;
    dead_ingress: number;
  }[]>`
    select
      count(*) filter (
        where direction = 'outbound'
          and delivery_state = 'SEND_RESULT_UNKNOWN'
      )::int as unknown_sends,
      count(*) filter (
        where direction = 'outbound'
          and delivery_state = 'DEAD'
      )::int as dead_messages,
      (
        select count(*)::int
        from app_private.webhook_ingress_events ingress
        join app_private.channel_connections connection
          on connection.external_account_id = any(ingress.provider_account_ids)
         and connection.provider_key = ingress.provider
        where connection.workspace_id = ${membership.workspaceId}
          and ingress.processing_state in ('RECEIVED','PROCESSING','UNMATCHED','FAILED')
      ) as pending_ingress,
      (
        select count(*)::int
        from app_private.webhook_ingress_events ingress
        join app_private.channel_connections connection
          on connection.external_account_id = any(ingress.provider_account_ids)
         and connection.provider_key = ingress.provider
        where connection.workspace_id = ${membership.workspaceId}
          and ingress.processing_state = 'DEAD'
      ) as dead_ingress
    from app_private.messages
    where workspace_id = ${membership.workspaceId}
  `;

  const canonicalEvents = await sql<{
    id: string;
    event_type: string;
    provider_event_id: string;
    occurred_at: string;
    provider: string;
  }[]>`
    select id, event_type, provider_event_id, occurred_at, provider
    from app_private.canonical_events
    where workspace_id = ${membership.workspaceId}
    order by occurred_at desc
    limit 12
  `;

  const unknownMessages = await sql<{
    id: string;
    connection_id: string;
    correlation_id: string;
    last_error_code: string | null;
    updated_at: string;
  }[]>`
    select id, connection_id, correlation_id, last_error_code, updated_at
    from app_private.messages
    where workspace_id = ${membership.workspaceId}
      and direction = 'outbound'
      and delivery_state = 'SEND_RESULT_UNKNOWN'
    order by updated_at desc
    limit 8
  `;

  const values = metrics ?? {
    unknown_sends: 0,
    dead_messages: 0,
    pending_ingress: 0,
    dead_ingress: 0
  };

  return (
    <>
      <header className="page-header">
        <div className="header-copy">
          <div className="eyebrow">Reliability / {membership.workspaceName}</div>
          <h1>Falhas explícitas. Recuperação controlada.</h1>
          <p>Eventos, leases, idempotência, reconciliação e dead-letter são evidência operacional, não um spinner infinito.</p>
        </div>
        <span className="badge accent"><span className="status-dot healthy" /> Durable core active</span>
      </header>

      <section className="grid metrics">
        <article className="card compact">
          <div className="metric-label">Unknown sends</div>
          <div className="metric-value">{values.unknown_sends}</div>
          <div className="metric-note">automatic retry blocked</div>
        </article>
        <article className="card compact">
          <div className="metric-label">Dead outbound</div>
          <div className="metric-value">{values.dead_messages}</div>
          <div className="metric-note">retry policy exhausted or definitive stop</div>
        </article>
        <article className="card compact">
          <div className="metric-label">Ingress attention</div>
          <div className="metric-value">{values.pending_ingress}</div>
          <div className="metric-note">received / leased / retrying / unmatched</div>
        </article>
        <article className="card compact">
          <div className="metric-label">Dead ingress</div>
          <div className="metric-value">{values.dead_ingress}</div>
          <div className="metric-note">manual investigation required</div>
        </article>
      </section>

      <section className="section grid two">
        <article className="card">
          <div className="eyebrow">Invariant 01</div>
          <h2>Não repetir um envio ambíguo</h2>
          <p>Se o provider pode ter aplicado o side effect e perdemos a confirmação, a mensagem vira SEND_RESULT_UNKNOWN. Ela não retorna sozinha para a fila.</p>
          <div className="notice">PROCESSING → lease expiry / ambiguous transport → SEND_RESULT_UNKNOWN → evidence review</div>
        </article>
        <article className="card">
          <div className="eyebrow">Invariant 02</div>
          <h2>Deduplicação não pode destruir mensagens</h2>
          <p>O mesmo providerEventId com fingerprint incompatível vira SUSPICIOUS_EVENT_COLLISION e é isolado para investigação.</p>
          <div className="notice warning">DUPLICATE ≠ COLLISION. Colisão nunca é descartada silenciosamente.</div>
        </article>
      </section>

      {unknownMessages.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div><div className="eyebrow">Reconciliation queue</div><h2>Ambiguous outbound outcomes</h2></div>
            <p>sem retry automático</p>
          </div>
          <div className="table">
            <div className="table-row header"><span>Message</span><span>Correlation</span><span>State</span><span>Evidence</span></div>
            {unknownMessages.map((message) => (
              <div className="table-row" key={message.id}>
                <span className="mono">{shortId(message.id)}</span>
                <span className="mono">{shortId(message.correlation_id)}</span>
                <span className="warn">SEND_RESULT_UNKNOWN</span>
                <span className="muted">{message.last_error_code ?? "provider outcome requires evidence"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <div><div className="eyebrow">Canonical event log</div><h2>Recent execution evidence</h2></div>
          <p>{canonicalEvents.length} recent event{canonicalEvents.length === 1 ? "" : "s"}</p>
        </div>
        <div className="table">
          <div className="table-row header"><span>Event</span><span>Type</span><span>Provider</span><span>Occurred</span></div>
          {canonicalEvents.length === 0 ? (
            <div className="table-row">
              <span className="muted">—</span><span>No canonical events yet</span><span className="muted">—</span><span className="muted">—</span>
            </div>
          ) : canonicalEvents.map((event) => (
            <div className="table-row" key={event.id}>
              <span className="mono">{shortId(event.provider_event_id)}</span>
              <span>{event.event_type}</span>
              <span className="muted">{event.provider}</span>
              <span className="muted">{formatDate(event.occurred_at)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function shortId(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace("T", " ").replace(".000Z", "Z");
}
