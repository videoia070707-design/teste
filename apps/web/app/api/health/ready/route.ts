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
      vault_direct_access: boolean;
      platform_secret_bridge: boolean;
    }[]>`
      select
        current_user::text as role_name,
        coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_superuser,
        coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypasses_rls,
        has_schema_privilege(current_user, 'vault', 'usage') as vault_direct_access,
        has_function_privilege(current_user, 'app_private.get_platform_secret(text)', 'execute') as platform_secret_bridge
    `;

    if (!database) return notReady("database");

    if (isPublicDeployment()) {
      const leastPrivilegeReady = database.role_name === "automation_web"
        && !database.is_superuser
        && !database.bypasses_rls
        && !database.vault_direct_access
        && database.platform_secret_bridge;

      if (!leastPrivilegeReady) return notReady("database_role_policy");
    }

    return Response.json(
      {
        status: "ready",
        service: "web",
        check: "database",
        databaseRolePolicy: isPublicDeployment() ? "least_privilege_verified" : "local_development"
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

function notReady(check: string): Response {
  return Response.json(
    { status: "not_ready", service: "web", check },
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
