import { PostgresConnectionStore, type StoredConnectionRecord } from "@automation/storage-postgres/connections";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const { membership } = await requireWorkspaceContext();
  const store = new PostgresConnectionStore(getDatabase());
  const persisted = await store.listWorkspaceConnections(membership.workspaceId);
  const instagram = persisted.find((item) => item.providerKey === "instagram.meta.official") ?? null;
  const activeCount = persisted.filter((item) => item.authValid).length;

  return (
    <>
      <header className="page-header">
        <div className="header-copy">
          <div className="eyebrow">Connections / {membership.workspaceName}</div>
          <h1>Connection Health Center</h1>
          <p>Uma conexão só é saudável quando autenticação, provider, webhook e capabilities concordam.</p>
        </div>
        <span className="badge">{activeCount} authenticated connection{activeCount === 1 ? "" : "s"}</span>
      </header>

      <div className="notice warning">
        O produto não usa um booleano “connected”. Credencial válida sem evidência de webhook permanece STALE; capabilities quebradas devem aparecer como DEGRADED_PARTIAL.
      </div>

      <section className="section grid two">
        <article className="card connection-card">
          <div className="connection-head">
            <div className="connection-title">
              <div className="channel-mark">IG</div>
              <div><h2>Instagram Official</h2><p>Official</p></div>
            </div>
            <span className={`badge ${healthClass(instagram?.healthState ?? "DISCONNECTED")}`}>
              {instagram?.healthState ?? "DISCONNECTED"}
            </span>
          </div>
          <p>Instagram Login / Meta API para contas profissionais Business ou Creator.</p>
          <div className="capabilities">
            <span className="capability on">messages</span>
            <span className="capability on">comments</span>
            <span className="capability on">stories</span>
            <span className="capability on">publishing</span>
          </div>
          <div>
            <div className="key-value"><span>Authentication</span><strong>{instagram ? authLabel(instagram) : "Not connected"}</strong></div>
            <div className="key-value"><span>Webhook</span><strong>{webhookLabel(instagram)}</strong></div>
            <div className="key-value"><span>Instagram account</span><strong className="mono">{instagram?.displayName ?? instagram?.externalAccountId ?? "—"}</strong></div>
          </div>
          <div className="connection-actions">
            <a className="button primary" href="/api/connections/instagram/start">
              {instagram ? "Reautorizar Instagram" : "Conectar Instagram"}
            </a>
            <a className="button" href="/connections/instagram/readiness">Readiness G3</a>
            {instagram && (
              <form action="/api/connections/instagram/health" method="post">
                <input type="hidden" name="connectionId" value={instagram.id} />
                <button className="button" type="submit">Verificar conexão</button>
              </form>
            )}
          </div>
        </article>

        <article className="card connection-card">
          <div className="connection-head">
            <div className="connection-title">
              <div className="channel-mark">WA</div>
              <div><h2>WhatsApp Cloud</h2><p>Official</p></div>
            </div>
            <span className="badge muted">G4</span>
          </div>
          <p>WhatsApp Business Platform via Embedded Signup, com Coexistence quando elegível.</p>
          <div className="capabilities">
            <span className="capability on">messages</span>
            <span className="capability on">media</span>
            <span className="capability on">templates</span>
            <span className="capability on">flows</span>
          </div>
          <div>
            <div className="key-value"><span>Authentication</span><strong>Not implemented yet</strong></div>
            <div className="key-value"><span>Webhook</span><strong>G4</strong></div>
            <div className="key-value"><span>Phone</span><strong>—</strong></div>
          </div>
          <div className="connection-actions">
            <button className="button" type="button" disabled>Disponível no G4</button>
          </div>
        </article>

        <article className="card connection-card">
          <div className="connection-head">
            <div className="connection-title">
              <div className="channel-mark">LAB</div>
              <div><h2>Browser Session</h2><p>Browser Lab</p></div>
            </div>
            <span className="badge warn">LOCKED</span>
          </div>
          <p>Provider experimental isolado. Nunca utilizado como failover silencioso do provider oficial.</p>
          <div className="capabilities">
            <span className="capability beta">session health</span>
            <span className="capability beta">driver versioning</span>
            <span className="capability beta">canary tests</span>
          </div>
          <div className="key-value"><span>Availability</span><strong>G12–G13</strong></div>
        </article>
      </section>
    </>
  );
}

function authLabel(connection: StoredConnectionRecord): string {
  return connection.authValid ? "Verified credential attached" : "Credential invalid / missing";
}

function webhookLabel(connection: StoredConnectionRecord | null): string {
  if (!connection) return "Not subscribed";
  if (connection.webhookHealthy === null) return "Unknown / awaiting evidence";
  return connection.webhookHealthy ? "Verified healthy" : "Verified unhealthy";
}

function healthClass(state: StoredConnectionRecord["healthState"]): string {
  if (state === "HEALTHY") return "good";
  if (state === "STALE" || state === "DEGRADED_PARTIAL") return "warn";
  return "muted";
}
