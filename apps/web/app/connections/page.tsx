const connections = [
  {
    name: "Instagram Official",
    mark: "IG",
    mode: "Official",
    status: "DISCONNECTED",
    statusClass: "muted",
    description: "Instagram Login / Meta API para contas profissionais.",
    capabilities: ["messages", "comments", "stories", "publishing"],
    lastEvent: "—",
    auth: "Not connected",
    webhook: "Not subscribed"
  },
  {
    name: "WhatsApp Cloud",
    mark: "WA",
    mode: "Official",
    status: "DISCONNECTED",
    statusClass: "muted",
    description: "WhatsApp Business Platform via Embedded Signup.",
    capabilities: ["messages", "media", "templates", "flows"],
    lastEvent: "—",
    auth: "Not connected",
    webhook: "Not subscribed"
  },
  {
    name: "Browser Session",
    mark: "LAB",
    mode: "Browser Lab",
    status: "LOCKED",
    statusClass: "warn",
    description: "Provider experimental isolado. Nunca utilizado como failover silencioso.",
    capabilities: ["session health", "driver versioning", "canary tests"],
    lastEvent: "Disabled until G12",
    auth: "Isolated",
    webhook: "N/A"
  }
] as const;

export default function ConnectionsPage() {
  return (
    <>
      <header className="page-header">
        <div className="header-copy">
          <div className="eyebrow">Connections</div>
          <h1>Connection Health Center</h1>
          <p>Uma conexão só é saudável quando autenticação, provider, webhook e capabilities concordam.</p>
        </div>
        <span className="badge">0 active connections</span>
      </header>

      <div className="notice warning">
        O produto não usa um booleano “connected”. Falhas parciais devem aparecer como DEGRADED_PARTIAL, sem mascarar capabilities quebradas.
      </div>

      <section className="section grid two">
        {connections.map((connection) => (
          <article className="card connection-card" key={connection.name}>
            <div className="connection-head">
              <div className="connection-title">
                <div className="channel-mark">{connection.mark}</div>
                <div><h2>{connection.name}</h2><p>{connection.mode}</p></div>
              </div>
              <span className={`badge ${connection.statusClass}`}>{connection.status}</span>
            </div>
            <p>{connection.description}</p>
            <div className="capabilities">
              {connection.capabilities.map((capability) => <span className="capability on" key={capability}>{capability}</span>)}
            </div>
            <div>
              <div className="key-value"><span>Authentication</span><strong>{connection.auth}</strong></div>
              <div className="key-value"><span>Webhook</span><strong>{connection.webhook}</strong></div>
              <div className="key-value"><span>Last event</span><strong>{connection.lastEvent}</strong></div>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
