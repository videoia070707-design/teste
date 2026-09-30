const eventRows = [
  ["evt_demo_001", "webhook.accepted", "VALIDATED", "—"],
  ["evt_demo_002", "message.outbound", "SEND_RESULT_UNKNOWN", "reconciliation blocked retry"],
  ["evt_demo_003", "provider.status", "PROCESSED", "out-of-order safe"]
] as const;

export default function ReliabilityPage() {
  return (
    <>
      <header className="page-header">
        <div className="header-copy">
          <div className="eyebrow">Reliability / G2</div>
          <h1>Falhas explícitas. Recuperação controlada.</h1>
          <p>Eventos, idempotência, reconciliação, retries e dead-letter não ficam escondidos atrás de um spinner.</p>
        </div>
        <span className="badge accent"><span className="status-dot healthy" /> Core policy active</span>
      </header>

      <section className="grid metrics">
        <article className="card compact"><div className="metric-label">Duplicate execution</div><div className="metric-value">0</div><div className="metric-note">providerEventId + collision guard</div></article>
        <article className="card compact"><div className="metric-label">Unknown sends</div><div className="metric-value">1</div><div className="metric-note">needs reconciliation</div></article>
        <article className="card compact"><div className="metric-label">Dead letter</div><div className="metric-value">0</div><div className="metric-note">manual replay available later</div></article>
        <article className="card compact"><div className="metric-label">Event freshness</div><div className="metric-value">Live</div><div className="metric-note">canonical event model</div></article>
      </section>

      <section className="section grid two">
        <article className="card">
          <div className="eyebrow">Invariant 01</div>
          <h2>Não repetir um envio ambíguo</h2>
          <p>Se o transporte fechar depois de enviar a requisição, não sabemos se o provider aceitou. O estado vira SEND_RESULT_UNKNOWN e o retry automático é bloqueado.</p>
          <div className="notice">PROCESSING → SEND_RESULT_UNKNOWN → reconcile → SENT / FAILED / SAFE_RETRY</div>
        </article>
        <article className="card">
          <div className="eyebrow">Invariant 02</div>
          <h2>Deduplicação não pode destruir mensagens</h2>
          <p>O mesmo providerEventId com fingerprint incompatível vira SUSPICIOUS_COLLISION. Não descartamos silenciosamente um evento legítimo como duplicado.</p>
          <div className="notice warning">DUPLICATE ≠ COLLISION. Colisões seguem para investigação.</div>
        </article>
      </section>

      <section className="section">
        <div className="section-head"><div><div className="eyebrow">Event log</div><h2>Execution evidence</h2></div><p>dados demonstrativos</p></div>
        <div className="table">
          <div className="table-row header"><span>Event</span><span>Type</span><span>State</span><span>Evidence</span></div>
          {eventRows.map(([event, type, state, evidence]) => (
            <div className="table-row" key={event}>
              <span className="mono">{event}</span>
              <span>{type}</span>
              <span className={state === "SEND_RESULT_UNKNOWN" ? "warn" : "good"}>{state}</span>
              <span className="muted">{evidence}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
