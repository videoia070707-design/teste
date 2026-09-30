import "server-only";
import { INSTAGRAM_LOGIN_SCOPES } from "@automation/provider-instagram-official";
import type { DatabaseClient } from "@automation/storage-postgres";
import { getPlatformSecrets } from "@/lib/server/platform-secrets";

const PROVIDER_KEY = "instagram.meta.official";
const EDGE_WEBHOOK_PATH = "/functions/v1/instagram-webhook";

export type ReadinessState = "READY" | "BLOCKED" | "EXTERNAL";

export interface ReadinessCheck {
  key: string;
  label: string;
  state: ReadinessState;
  detail: string;
}

export interface InstagramReadinessReport {
  configurationReady: boolean;
  hostPass: boolean;
  urls: {
    appOrigin: string | null;
    oauthRedirect: string | null;
    webhookCallback: string | null;
    privacyPolicy: string | null;
    dataDeletion: string | null;
  };
  permissions: readonly string[];
  configuration: ReadinessCheck[];
  external: Array<ReadinessCheck & { attestationStatus: string | null; note: string | null }>;
  liveEvidence: ReadinessCheck[];
}

const EXTERNAL_CHECKS = [
  ["meta_business_app_created", "Meta Business app criado"],
  ["instagram_professional_test_account", "Conta Instagram Business/Creator de teste pronta"],
  ["meta_test_roles_configured", "Testers/roles da Meta configurados para a conta de teste"],
  ["required_permissions_available", "Permissões necessárias disponíveis no app"],
  ["webhook_subscriptions_configured", "Assinaturas de webhook configuradas no App Dashboard"],
  ["privacy_url_registered", "Privacy Policy URL registrada na Meta"],
  ["data_deletion_url_registered", "Data deletion URL registrada na Meta"]
] as const;

export async function buildInstagramReadinessReport(
  sql: DatabaseClient,
  workspaceId: string
): Promise<InstagramReadinessReport> {
  const origin = parseOrigin(process.env.APP_ORIGIN);
  const supabaseOrigin = parseHttpsOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const platformSecrets = await readPlatformSecretReadiness(sql);

  const urls = {
    appOrigin: origin,
    oauthRedirect: origin ? `${origin}/api/connections/instagram/callback` : null,
    webhookCallback: supabaseOrigin ? `${supabaseOrigin}${EDGE_WEBHOOK_PATH}` : null,
    privacyPolicy: origin ? `${origin}/legal/privacy` : null,
    dataDeletion: origin ? `${origin}/legal/data-deletion` : null
  };

  const configuration: ReadinessCheck[] = [
    envCheck("app_origin", "APP_ORIGIN", validPublicOrigin(process.env.APP_ORIGIN), "Origem canônica do dashboard e callback OAuth."),
    envCheck("supabase_url", "NEXT_PUBLIC_SUPABASE_URL", validHttpsUrl(process.env.NEXT_PUBLIC_SUPABASE_URL), "Origem do Supabase Auth e do webhook Edge sempre disponível."),
    envCheck("supabase_key", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", present(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY), "Publishable key usada somente com Auth/RLS apropriados."),
    envCheck("database", "DATABASE_URL", present(process.env.DATABASE_URL), "PostgreSQL server-only do web app."),
    envCheck(
      "database_transport",
      "DATABASE_URL TLS",
      secureDatabaseTransport(process.env.DATABASE_URL, process.env.APP_ORIGIN),
      "Ambiente público exige sslmode=require, verify-ca ou verify-full. Desenvolvimento local pode usar conexão local sem TLS."
    ),
    envCheck("meta_app_id", "META_APP_ID", present(process.env.META_APP_ID), "ID do App Meta usado pelo OAuth."),
    envCheck(
      "meta_app_secret",
      "Meta App Secret",
      present(process.env.META_APP_SECRET) || platformSecrets.metaAppSecretReady,
      "Produção usa o Supabase Vault via bridge allowlisted; META_APP_SECRET permanece apenas como fallback local compatível."
    ),
    envCheck("webhook_verify_token", "Webhook verify token no Supabase Vault", platformSecrets.webhookVerifyTokenReady, "Verify token forte usado pelo challenge público do webhook Edge."),
    envCheck("oauth_authorize", "INSTAGRAM_OAUTH_AUTHORIZE_URL", validHttpsUrl(process.env.INSTAGRAM_OAUTH_AUTHORIZE_URL), "Endpoint OAuth configurável."),
    envCheck("oauth_token", "INSTAGRAM_OAUTH_TOKEN_URL", validHttpsUrl(process.env.INSTAGRAM_OAUTH_TOKEN_URL), "Endpoint de troca de authorization code."),
    envCheck("long_lived_token", "INSTAGRAM_LONG_LIVED_TOKEN_URL", validHttpsUrl(process.env.INSTAGRAM_LONG_LIVED_TOKEN_URL), "Endpoint de troca para long-lived token."),
    envCheck("graph_base", "INSTAGRAM_GRAPH_BASE_URL", validHttpsUrl(process.env.INSTAGRAM_GRAPH_BASE_URL), "Base URL da API oficial."),
    envCheck("graph_version", "INSTAGRAM_GRAPH_API_VERSION", safeApiVersion(process.env.INSTAGRAM_GRAPH_API_VERSION), "Versão explícita; upgrades não são silenciosos."),
    envCheck("identity_probe", "INSTAGRAM_IDENTITY_PROBE_PATH", safeProbePath(process.env.INSTAGRAM_IDENTITY_PROBE_PATH), "Probe explícito necessário para health sem falso positivo."),
    envCheck("secret_keyring", "Provider AES keyring no Supabase Vault", platformSecrets.providerKeyringReady, "Keyring AES-256-GCM compartilhado pelo web e Edge runtime."),
    envCheck("legal_entity", "LEGAL_ENTITY_NAME", present(process.env.LEGAL_ENTITY_NAME), "Nome do operador exibido nas páginas legais."),
    envCheck("support_email", "SUPPORT_EMAIL", validEmail(process.env.SUPPORT_EMAIL), "Contato público para privacidade e exclusão de dados.")
  ];

  const attestations = await sql<{
    check_key: string;
    status: string;
    note: string | null;
  }[]>`
    select check_key, status, note
    from app_private.provider_readiness_attestations
    where workspace_id = ${workspaceId}
      and provider_key = ${PROVIDER_KEY}
  `;
  const attestationMap = new Map(attestations.map((item) => [item.check_key, item]));

  const external = EXTERNAL_CHECKS.map(([key, label]) => {
    const attestation = attestationMap.get(key) ?? null;
    return {
      key,
      label,
      state: "EXTERNAL" as const,
      detail: "Confirmação operacional; não substitui evidência de tráfego real.",
      attestationStatus: attestation?.status ?? null,
      note: attestation?.note ?? null
    };
  });

  const [evidence] = await sql<{
    oauth_ready: boolean;
    webhook_message_observed: boolean;
    outbound_traced: boolean;
    signed_webhook_seen: boolean;
  }[]>`
    select
      exists (
        select 1
        from app_private.channel_connections connection
        join app_private.connection_secret_refs secret_ref
          on secret_ref.connection_id = connection.id
        where connection.workspace_id = ${workspaceId}
          and connection.channel = 'instagram'
          and connection.provider_key = ${PROVIDER_KEY}
          and connection.provider_mode = 'official'
          and connection.auth_valid = true
          and connection.external_account_id is not null
      ) as oauth_ready,
      exists (
        select 1
        from app_private.canonical_events event
        where event.workspace_id = ${workspaceId}
          and event.provider = ${PROVIDER_KEY}
          and event.event_type = 'message.received'
      ) as webhook_message_observed,
      exists (
        select 1
        from app_private.messages message
        join app_private.channel_connections connection on connection.id = message.connection_id
        where message.workspace_id = ${workspaceId}
          and connection.provider_key = ${PROVIDER_KEY}
          and connection.provider_mode = 'official'
          and message.direction = 'outbound'
          and message.message_type = 'text'
          and message.delivery_state in ('SENT','DELIVERED','READ')
          and message.provider_message_id is not null
      ) as outbound_traced,
      exists (
        select 1
        from app_private.raw_events raw
        where raw.workspace_id = ${workspaceId}
          and raw.provider = ${PROVIDER_KEY}
          and raw.signature_valid = true
      ) as signed_webhook_seen
  `;

  const live = evidence ?? {
    oauth_ready: false,
    webhook_message_observed: false,
    outbound_traced: false,
    signed_webhook_seen: false
  };

  const liveEvidence: ReadinessCheck[] = [
    evidenceCheck("oauth_live", "OAuth real + credencial criptografada", live.oauth_ready, "Conexão oficial autenticada e secret reference anexada."),
    evidenceCheck("signed_webhook", "Webhook assinado persistido", live.signed_webhook_seen, "Payload validado e persistido antes do ACK."),
    evidenceCheck("message_received", "Mensagem real normalizada", live.webhook_message_observed, "Evento canônico message.received observado."),
    evidenceCheck("outbound_traced", "Resposta DM real rastreada", live.outbound_traced, "Envio text aceito com provider_message_id.")
  ];

  return {
    configurationReady: configuration.every((item) => item.state === "READY"),
    hostPass: live.oauth_ready && live.webhook_message_observed && live.outbound_traced,
    urls,
    permissions: INSTAGRAM_LOGIN_SCOPES,
    configuration,
    external,
    liveEvidence
  };
}

async function readPlatformSecretReadiness(sql: DatabaseClient): Promise<{
  metaAppSecretReady: boolean;
  webhookVerifyTokenReady: boolean;
  providerKeyringReady: boolean;
}> {
  try {
    const secrets = await getPlatformSecrets(
      ["meta_app_secret", "meta_webhook_verify_token", "provider_secret_keyring"],
      sql
    );
    return {
      metaAppSecretReady: present(secrets.meta_app_secret),
      webhookVerifyTokenReady: secureToken(secrets.meta_webhook_verify_token),
      providerKeyringReady: validVaultProviderKeyring(secrets.provider_secret_keyring)
    };
  } catch {
    return {
      metaAppSecretReady: false,
      webhookVerifyTokenReady: false,
      providerKeyringReady: false
    };
  }
}

function envCheck(key: string, label: string, ready: boolean, detail: string): ReadinessCheck {
  return { key, label, state: ready ? "READY" : "BLOCKED", detail };
}

function evidenceCheck(key: string, label: string, ready: boolean, detail: string): ReadinessCheck {
  return { key, label, state: ready ? "READY" : "BLOCKED", detail };
}

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function validHttpsUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validPublicOrigin(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    if (url.pathname !== "/" || url.search || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function parseOrigin(value: string | undefined): string | null {
  if (!validPublicOrigin(value)) return null;
  return new URL(value as string).origin;
}

function parseHttpsOrigin(value: string | undefined): string | null {
  if (!validHttpsUrl(value)) return null;
  return new URL(value as string).origin;
}

function secureDatabaseTransport(databaseUrl: string | undefined, appOrigin: string | undefined): boolean {
  if (!databaseUrl?.trim()) return false;

  try {
    const database = new URL(databaseUrl);
    if (database.protocol !== "postgresql:" && database.protocol !== "postgres:") return false;

    const localApp = appOrigin ? isLocalOrigin(appOrigin) : false;
    const localDatabase = isLocalHostname(database.hostname);
    if (localApp && localDatabase) return true;

    const sslMode = database.searchParams.get("sslmode")?.toLowerCase();
    return sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full";
  } catch {
    return false;
  }
}

function isLocalOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function secureToken(value: string | undefined): boolean {
  return Boolean(value && value.trim().length >= 24);
}

function safeApiVersion(value: string | undefined): boolean {
  return Boolean(value && /^v?\d{1,3}\.\d{1,3}$/.test(value.trim()));
}

function safeProbePath(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const normalized = value.trim();
  return normalized.startsWith("/") && !normalized.startsWith("//") && !normalized.includes("\\");
}

function validEmail(value: string | undefined): boolean {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()));
}

function validVaultProviderKeyring(raw: string | undefined): boolean {
  if (!raw?.trim()) return false;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return false;
    const currentVersion = parsed.currentVersion;
    const keys = parsed.keys;
    if (typeof currentVersion !== "string" || !isRecord(keys)) return false;
    const encoded = keys[currentVersion];
    if (typeof encoded !== "string") return false;
    return Buffer.from(encoded, "base64").length === 32;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
