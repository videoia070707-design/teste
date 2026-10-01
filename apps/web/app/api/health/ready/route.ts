import { getDatabase } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const sql = getDatabase();
    const [database] = await sql<{
      role_name: string;
      is_superuser: boolean;
      bypasses_rls: boolean;
      tls_active: boolean;
      app_private_usage: boolean;
      provider_config_read: boolean;
      runtime_token_read: boolean;
      vault_direct_access: boolean;
      platform_secret_bridge: boolean;
    }[]>`
      select
        current_user::text as role_name,
        coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_superuser,
        coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypasses_rls,
        coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as tls_active,
        coalesce(
          has_schema_privilege(current_user, 'app_private', 'usage'),
          false
        ) as app_private_usage,
        coalesce(
          has_table_privilege(
            current_user,
            to_regclass('app_private.provider_runtime_config'),
            'select'
          ),
          false
        ) as provider_config_read,
        coalesce(
          has_table_privilege(
            current_user,
            to_regclass('app_private.runtime_invocation_tokens'),
            'select'
          ),
          false
        ) as runtime_token_read,
        coalesce(
          has_schema_privilege(current_user, to_regnamespace('vault'), 'usage'),
          false
        ) as vault_direct_access,
        coalesce(
          has_function_privilege(
            current_user,
            to_regprocedure('app_private.get_platform_secret(text)'),
            'execute'
          ),
          false
        ) as platform_secret_bridge
    `;

    if (!database) return notReady("database");

    if (isPublicDeployment()) {
      const leastPrivilegeReady = database.role_name === "automation_web"
        && !database.is_superuser
        && !database.bypasses_rls
        && database.tls_active
        && database.app_private_usage
        && database.provider_config_read
        && !database.runtime_token_read
        && !database.vault_direct_access
        && database.platform_secret_bridge;

      if (!leastPrivilegeReady) {
        return notReady("database_role_policy", publicDiagnostics(database));
      }
    }

    return Response.json(
      {
        status: "ready",
        service: "web",
        check: "database",
        databaseRolePolicy: isPublicDeployment() ? "least_privilege_verified" : "local_development",
        transport: isPublicDeployment() ? "tls_verified" : "local_or_unverified"
      },
      {
        status: 200,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch {
    return notReady("database");
  }
}

function publicDiagnostics(database: {
  role_name: string;
  is_superuser: boolean;
  bypasses_rls: boolean;
  tls_active: boolean;
  app_private_usage: boolean;
  provider_config_read: boolean;
  runtime_token_read: boolean;
  vault_direct_access: boolean;
  platform_secret_bridge: boolean;
}): Record<string, boolean> {
  return {
    expectedRole: database.role_name === "automation_web",
    nonSuperuser: !database.is_superuser,
    noBypassRls: !database.bypasses_rls,
    tlsActive: database.tls_active,
    appPrivateUsage: database.app_private_usage,
    providerConfigReadable: database.provider_config_read,
    runtimeTokensDenied: !database.runtime_token_read,
    vaultDirectAccessDenied: !database.vault_direct_access,
    platformSecretBridgeAllowed: database.platform_secret_bridge
  };
}

function notReady(check: string, diagnostics?: Record<string, boolean>): Response {
  return Response.json(
    {
      status: "not_ready",
      service: "web",
      check,
      ...(diagnostics ? { diagnostics } : {})
    },
    {
      status: 503,
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}

function isPublicDeployment(): boolean {
  const configured = process.env.APP_ORIGIN?.trim();
  if (!configured) return false;

  try {
    const url = new URL(configured);
    return url.protocol === "https:"
      && url.hostname !== "localhost"
      && url.hostname !== "127.0.0.1"
      && url.hostname !== "::1";
  } catch {
    return false;
  }
}
