import "server-only";
import { INSTAGRAM_LOGIN_SCOPES } from "@automation/provider-instagram-official";
import type { DatabaseClient } from "@automation/storage-postgres";
import { getPlatformSecrets } from "@/lib/server/platform-secrets";

const PROVIDER_KEY = "instagram.meta.official";
const EDGE_OAUTH_CALLBACK_PATH = "/functions/v1/instagram-oauth-callback";
const EDGE_WEBHOOK_PATH = "/functions/v1/instagram-webhook";
const EDGE_DATA_DELETION_PATH = "/functions/v1/instagram-data-deletion";
const EDGE_LEGAL_PATH = "/functions/v1/platform-legal";

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
    dataDeletionCallback: string | null;
    privacyPolicy: string | null;
    dataDeletion: string | null;
  };
  permissions: readonly string[];
  configuration: ReadinessCheck[];
  external: Array<ReadinessCheck & { attestationStatus: string | null; note: string | null }>;
  liveEvidence: ReadinessCheck[];
}

interface ProviderRuntimeReadiness {
  appId: string | null;
  oauthAuthorizeUrl: string | null;
  oauthTokenUrl: string | null;
  oauthTokenEncoding: string | null;
  longLivedTokenUrl: string | null;
  graphBaseUrl: string | null;
  graphApiVersion: string | null;
  identityProbePath: string | null;
}

interface PlatformPublicReadiness {
  legalEntityName: string | null;
  supportEmail: string | null;
}

const EXTERNAL_CHECKS = [
  ["meta_business_app_created", "Meta Business app criado"],
  ["instagram_professional_test_account", "Conta Instagram Business/Creator de teste pronta"],
  ["meta_test_roles_configured", "Testers/roles da Meta configurados para a conta de teste"],
  ["required_permissions_available", "Permissões necessárias disponíveis no app"],
  ["webhook_subscriptions_configured", "Assinaturas de webhook configuradas no App Dashboard"],
  ["privacy_url_registered", "Privacy Policy URL registrada na Meta"],
  ["data_deletion_url_registered", "Data deletion callback/instructions configurados na Meta"]
] as const;

export async function buildInstagramReadinessReport(
  sql: DatabaseClient,
  workspaceId: string
): Promise<InstagramReadinessReport> {
  const appOrigin = parseOrigin(process.env.APP_ORIGIN);
  const supabaseOrigin = parseHttpsOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const platformSecrets = await readPlatformSecretReadiness(sql);
  const providerConfig = await readProviderRuntimeReadiness(sql);
  const publicConfig = await readPlatformPublicReadiness(sql);
  const edgeRuntimeFresh = await readEdgeRuntimeFreshness(sql);

  const urls = {
    appOrigin,
    oauthRedirect: supabaseOrigin ? `${supabaseOrigin}${EDGE_OAUTH_CALLBACK_PATH}` : null,
    webhookCallback: supabaseOrigin ? `${supabaseOrigin}${EDGE_WEBHOOK_PATH}` : null,
    dataDeletionCallback: supabaseOrigin ? `${supabaseOrigin}${EDGE_DATA_DELETION_PATH}` : null,
    privacyPolicy: supabaseOrigin ? `${supabaseOrigin}${EDGE_LEGAL_PATH}?document=privacy` : null,
    dataDeletion: supabaseOrigin ? `${supabaseOrigin}${EDGE_LEGAL_PATH}?document=data-deletion` : null
  };

  const configuration: ReadinessCheck[] = [
    configCheck(
      "supabase_edge_origin",
      "Supabase Edge origin",
      Boolean(supabaseOrigin),
      "Origem HTTPS que hospeda OAuth callback, webhook, data deletion e superfícies legais do G3."
    ),
    configCheck(
      "edge_runtime",
      "Supabase Edge Runtime",
      edgeRuntimeFresh,
      "Heartbeat recente do executor gratuito Edge/Cron; não conta como HOST PASS."
    ),
    configCheck(
      "meta_app_id",
      "Meta App ID",
      present(providerConfig.appId),
      "Lido de app_private.provider_runtime_config; não depende do host do dashboard."
    ),
    configCheck(
      "meta_app_secret",
      "Meta App Secret no Vault",
      platformSecrets.metaAppSecretReady,
      "Secret canônico do App Meta; nunca é lido de env no caminho Supabase Free."
    ),
    configCheck(
      "webhook_verify_token",
      "Webhook verify token no Vault",
      platformSecrets.webhookVerifyTokenReady,
      "Verify token forte usado pelo challenge público do webhook Edge."
    ),
    configCheck(
      "oauth_authorize",
      "Instagram OAuth authorize URL",
      validHttpsUrl(providerConfig.oauthAuthorizeUrl),
      "Endpoint validado para Instagram API with Instagram Login; nunca preenchido por suposição legada."
    ),
    configCheck(
      "oauth_token",
      "Instagram OAuth token URL",
      validHttpsUrl(providerConfig.oauthTokenUrl),
      "Endpoint de troca de authorization code validado para o App Meta real."
    ),
    configCheck(
      "oauth_token_encoding",
      "OAuth token encoding",
      validTokenEncoding(providerConfig.oauthTokenEncoding),
      "Encoding explícito do token exchange: multipart ou urlencoded."
    ),
    configCheck(
      "long_lived_token",
      "Instagram long-lived token URL",
      validHttpsUrl(providerConfig.longLivedTokenUrl),
      "Endpoint de troca para long-lived token validado para o App Meta real."
    ),
    configCheck(
      "graph_base",
      "Instagram Graph base URL",
      validHttpsUrl(providerConfig.graphBaseUrl),
      "Base URL oficial centralizada no banco para evitar drift entre hosts."
    ),
    configCheck(
      "graph_version",
      "Instagram Graph API version",
      safeApiVersion(providerConfig.graphApiVersion),
      "Versão explícita; upgrades não são silenciosos."
    ),
    configCheck(
      "identity_probe",
      "Instagram identity probe",
      safeProbePath(providerConfig.identityProbePath),
      "Probe explícito necessário para health sem falso positivo."
    ),
    configCheck(
      "secret_keyring",
      "Provider AES keyring no Vault",
      platformSecrets.providerKeyringReady,
      "Keyring AES-256-GCM compartilhado pelo OAuth Edge e runtime de provider."
    ),
    configCheck(
      "legal_entity",
      "Legal entity name",
      present(publicConfig.legalEntityName),
      "Lido de app_private.platform_public_config e usado pelas superfícies legais públicas."
    ),
    configCheck(
      "support_email",
      "Support/privacy email",
      validEmail(publicConfig.supportEmail),
      "Lido de app_private.platform_public_config; necessário para páginas legais não responderem 503."
    )
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

async function readProviderRuntimeReadiness(sql: DatabaseClient): Promise<ProviderRuntimeReadiness> {
  try {
    const [row] = await sql<{
      app_id: string | null;
      oauth_authorize_url: string | null;
      oauth_token_url: string | null;
      oauth_token_encoding: string | null;
      long_lived_token_url: string | null;
      graph_base_url: string | null;
      graph_api_version: string | null;
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
        identity_probe_path
      from app_private.provider_runtime_config
      where provider_key = ${PROVIDER_KEY}
      limit 1
    `;

    return {
      appId: row?.app_id ?? null,
      oauthAuthorizeUrl: row?.oauth_authorize_url ?? null,
      oauthTokenUrl: row?.oauth_token_url ?? null,
      oauthTokenEncoding: row?.oauth_token_encoding ?? null,
      longLivedTokenUrl: row?.long_lived_token_url ?? null,
      graphBaseUrl: row?.graph_base_url ?? null,
      graphApiVersion: row?.graph_api_version ?? null,
      identityProbePath: row?.identity_probe_path ?? null
    };
  } catch {
    return emptyProviderRuntimeReadiness();
  }
}

async function readPlatformPublicReadiness(sql: DatabaseClient): Promise<PlatformPublicReadiness> {
  try {
    const rows = await sql<{ config_key: string; config_value: string | null }[]>`
      select config_key, config_value
      from app_private.platform_public_config
      where config_key in ('legal_entity_name', 'support_email')
    `;
    const values = new Map(rows.map((row) => [row.config_key, row.config_value?.trim() || null]));
    return {
      legalEntityName: values.get("legal_entity_name") ?? null,
      supportEmail: values.get("support_email") ?? null
    };
  } catch {
    return { legalEntityName: null, supportEmail: null };
  }
}

async function readEdgeRuntimeFreshness(sql: DatabaseClient): Promise<boolean> {
  try {
    const [row] = await sql<{ fresh: boolean }[]>`
      select exists (
        select 1
        from app_private.worker_heartbeats
        where coalesce(worker_kind, service) = 'supabase_g3_runtime'
          and last_seen_at >= now() - interval '45 seconds'
      ) as fresh
    `;
    return row?.fresh ?? false;
  } catch {
    return false;
  }
}

function emptyProviderRuntimeReadiness(): ProviderRuntimeReadiness {
  return {
    appId: null,
    oauthAuthorizeUrl: null,
    oauthTokenUrl: null,
    oauthTokenEncoding: null,
    longLivedTokenUrl: null,
    graphBaseUrl: null,
    graphApiVersion: null,
    identityProbePath: null
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

function configCheck(key: string, label: string, ready: boolean, detail: string): ReadinessCheck {
  return { key, label, state: ready ? "READY" : "BLOCKED", detail };
}

function evidenceCheck(key: string, label: string, ready: boolean, detail: string): ReadinessCheck {
  return { key, label, state: ready ? "READY" : "BLOCKED", detail };
}

function present(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function validHttpsUrl(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validTokenEncoding(value: string | null | undefined): boolean {
  return value === "multipart" || value === "urlencoded";
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

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function secureToken(value: string | undefined): boolean {
  return Boolean(value && value.trim().length >= 24);
}

function safeApiVersion(value: string | null | undefined): boolean {
  return Boolean(value && /^v?\d{1,3}\.\d{1,3}$/.test(value.trim()));
}

function safeProbePath(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  const normalized = value.trim();
  return normalized.startsWith("/") && !normalized.startsWith("//") && !normalized.includes("\\");
}

function validEmail(value: string | null | undefined): boolean {
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
