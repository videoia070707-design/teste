import { can, type WorkspaceRole } from "@automation/core";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";

export const dynamic = "force-dynamic";

const PROVIDER_KEY = "instagram.meta.official";

export default async function SettingsPage() {
  const { membership } = await requireWorkspaceContext();
  const sql = getDatabase();
  const canManage = can(membership.role as WorkspaceRole, "connections.manage");

  const publicRows = await sql<{ config_key: string; config_value: string | null }[]>`
    select config_key, config_value
    from app_private.platform_public_config
    where config_key in ('legal_entity_name', 'support_email')
  `;
  const publicConfig = new Map(publicRows.map((row) => [row.config_key, row.config_value ?? ""]));

  const [provider] = await sql<{
    app_id: string | null;
    oauth_authorize_url: string | null;
    oauth_token_url: string | null;
    oauth_token_encoding: string | null;
    long_lived_token_url: string | null;
    graph_base_url: string;
    graph_api_version: string;
    graph_api_version_confirmed_at: string | null;
    identity_probe_path: string | null;
  }[]>`
    select
      app_id,
      oauth_authorize_url,
      oauth_token_url,
      oauth_token_encoding,
      long_lived_token_url,
      graph_base_url,
      graph_api_version,
      graph_api_version_confirmed_at,
      identity_probe_path
    from app_private.provider_runtime_config
    where provider_key = ${PROVIDER_KEY}
    limit 1
  `;

  const [secretState] = await sql<{
    meta_app_secret_ready: boolean;
    verify_token_ready: boolean;
    keyring_ready: boolean;
  }[]>`
    select
      app_private.get_platform_secret('meta_app_secret') is not null as meta_app_secret_ready,
      app_private.get_platform_secret('meta_webhook_verify_token') is not null as verify_token_ready,
      app_private.get_platform_secret('provider_secret_keyring') is not null as keyring_ready
  `;

  const supabaseOrigin = safeOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const urls = {
    oauth: supabaseOrigin ? `${supabaseOrigin}/functions/v1/instagram-oauth-callback` : null,
    webhook: supabaseOrigin ? `${supabaseOrigin}/functions/v1/instagram-webhook` : null,
    deletion: supabaseOrigin ? `${supabaseOrigin}/functions/v1/instagram-data-deletion` : null,
    privacy: supabaseOrigin ? `${supabaseOrigin}/functions/v1/platform-legal?document=privacy` : null
  };

  return (
    <>
      <header className="page-header">
        <div className="header-copy">
          <div className="eyebrow">Settings / {membership.workspaceName}</div>
          <h1>Setup Center</h1>
          <p>Configuração operacional do HOST PASS. Segredos ficam no Supabase Vault e nunca são exibidos novamente pela interface.</p>
        </div>
        <span className={`badge ${canManage ? "accent" : "muted"}`}>{canManage ? "Owner/Admin" : "Read only"}</span>
      </header>

      <section className="section grid two">
        <article className="card">
          <div className="eyebrow">Secret boundary</div>
          <h2>Vault status</h2>
          <StatusRow label="Meta App Secret" ready={secretState?.meta_app_secret_ready ?? false} />
          <StatusRow label="Webhook verify token" ready={secretState?.verify_token_ready ?? false} />
          <StatusRow label="Provider AES keyring" ready={secretState?.keyring_ready ?? false} />
          <div className="notice">O App Secret pode ser gravado por campo write-only abaixo. O valor nunca é pré-preenchido, retornado ou mostrado depois do salvamento.</div>
        </article>

        <article className="card">
          <div className="eyebrow">G3 public surfaces</div>
          <h2>URLs prontas</h2>
          <UrlRow label="OAuth callback" value={urls.oauth} />
          <UrlRow label="Webhook callback" value={urls.webhook} />
          <UrlRow label="Data deletion" value={urls.deletion} />
          <UrlRow label="Privacy Policy" value={urls.privacy} />
        </article>
      </section>

      <section className="section">
        <div className="section-head">
          <div><div className="eyebrow">Operator configuration</div><h2>Meta + identidade pública</h2></div>
          <p>configuração operacional + secret write-only</p>
        </div>

        <form className="card" action="/api/settings/platform" method="post">
          <div className="grid two">
            <div>
              <label className="field-label" htmlFor="legalEntityName">Nome jurídico / operador</label>
              <input
                className="field-control"
                id="legalEntityName"
                name="legalEntityName"
                maxLength={200}
                defaultValue={publicConfig.get("legal_entity_name") ?? ""}
                disabled={!canManage}
                placeholder="Nome real do operador da plataforma"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="supportEmail">E-mail de suporte / privacidade</label>
              <input
                className="field-control"
                id="supportEmail"
                name="supportEmail"
                type="email"
                maxLength={320}
                defaultValue={publicConfig.get("support_email") ?? ""}
                disabled={!canManage}
                placeholder="suporte@seudominio.com"
              />
            </div>
          </div>

          <div className="grid two" style={{ marginTop: 18 }}>
            <div>
              <label className="field-label" htmlFor="appId">Meta App ID</label>
              <input
                className="field-control mono"
                id="appId"
                name="appId"
                inputMode="numeric"
                pattern="[0-9]{4,40}"
                defaultValue={provider?.app_id ?? ""}
                disabled={!canManage}
                placeholder="ID numérico do App Meta"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="metaAppSecret">Meta App Secret</label>
              <input
                className="field-control mono"
                id="metaAppSecret"
                name="metaAppSecret"
                type="password"
                minLength={16}
                maxLength={512}
                autoComplete="new-password"
                disabled={!canManage}
                placeholder={secretState?.meta_app_secret_ready ? "Já configurado — deixe vazio para manter" : "Cole o App Secret uma única vez"}
              />
              <p className="muted">Write-only: deixar vazio mantém o secret atual. O valor nunca é renderizado de volta.</p>
            </div>
          </div>

          <div className="grid two" style={{ marginTop: 18 }}>
            <div>
              <label className="field-label" htmlFor="oauthTokenEncoding">OAuth token encoding</label>
              <select
                className="field-control"
                id="oauthTokenEncoding"
                name="oauthTokenEncoding"
                defaultValue={provider?.oauth_token_encoding ?? "multipart"}
                disabled={!canManage}
              >
                <option value="multipart">multipart</option>
                <option value="urlencoded">urlencoded</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="graphApiVersion">Graph API version</label>
              <input
                className="field-control mono"
                id="graphApiVersion"
                name="graphApiVersion"
                pattern="v[0-9]{1,3}\\.[0-9]{1,3}"
                maxLength={12}
                defaultValue={provider?.graph_api_version ?? ""}
                disabled={!canManage}
                placeholder="v26.0"
              />
              <div className="key-value" style={{ marginTop: 8 }}>
                <span>Confirmation</span>
                <strong className={provider?.graph_api_version_confirmed_at ? "good" : "warn"}>
                  {provider?.graph_api_version_confirmed_at ? "CONFIRMED" : "UNCONFIRMED"}
                </strong>
              </div>
              {provider?.graph_api_version_confirmed_at && (
                <p className="muted">Última confirmação: {formatDate(provider.graph_api_version_confirmed_at)}</p>
              )}
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10 }}>
                <input
                  type="checkbox"
                  name="confirmGraphApiVersion"
                  value="yes"
                  disabled={!canManage}
                />
                <span className="muted">
                  Confirmo que validei esta versão para o App Meta atual e para Instagram API with Instagram Login.
                </span>
              </label>
            </div>
          </div>

          <div className="grid two" style={{ marginTop: 18 }}>
            <UrlField name="oauthAuthorizeUrl" label="OAuth authorize URL" value={provider?.oauth_authorize_url} disabled={!canManage} />
            <UrlField name="oauthTokenUrl" label="OAuth token URL" value={provider?.oauth_token_url} disabled={!canManage} />
            <UrlField name="longLivedTokenUrl" label="Long-lived token URL" value={provider?.long_lived_token_url} disabled={!canManage} />
            <div>
              <label className="field-label" htmlFor="identityProbePath">Identity probe path</label>
              <input
                className="field-control mono"
                id="identityProbePath"
                name="identityProbePath"
                maxLength={500}
                defaultValue={provider?.identity_probe_path ?? ""}
                disabled={!canManage}
                placeholder="Preencha somente após confirmar no App Meta / documentação oficial atual"
              />
            </div>
          </div>

          <div className="notice warning" style={{ marginTop: 18 }}>
            Não copie endpoints do Instagram Basic Display legado. A Graph API version só recebe confirmação quando o checkbox acima é marcado explicitamente.
          </div>

          {canManage && (
            <div className="connection-actions" style={{ marginTop: 20 }}>
              <button className="button primary" type="submit">Salvar configuração</button>
            </div>
          )}
        </form>
      </section>
    </>
  );
}

function StatusRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="key-value">
      <span>{label}</span>
      <strong className={ready ? "good" : "warn"}>{ready ? "READY" : "MISSING"}</strong>
    </div>
  );
}

function UrlRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="key-value">
      <span>{label}</span>
      <strong className="mono">{value ?? "Not configured"}</strong>
    </div>
  );
}

function UrlField({
  name,
  label,
  value,
  disabled
}: {
  name: string;
  label: string;
  value: string | null | undefined;
  disabled: boolean;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={name}>{label}</label>
      <input
        className="field-control mono"
        id={name}
        name={name}
        type="url"
        maxLength={2_000}
        defaultValue={value ?? ""}
        disabled={disabled}
        placeholder="https://..."
      />
    </div>
  );
}

function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace("T", " ").replace(".000Z", "Z");
}
