import postgres from "npm:postgres@3.4.9";

const ROLE_NAME = "automation_web";

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const adminDatabaseUrl = Deno.env.get("SUPABASE_DB_URL")?.trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  if (!adminDatabaseUrl || !supabaseUrl) {
    return Response.json({ error: "supabase_environment_incomplete" }, { status: 503 });
  }

  const admin = postgres(adminDatabaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5
  });

  try {
    const presentedToken = request.headers.get("x-runtime-token") ?? "";
    if (!(await verifyRuntimeToken(admin, presentedToken))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const [passwordRow] = await admin<{ decrypted_secret: string }[]>`
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'automation_web_db_password'
      limit 1
    `;
    if (!passwordRow?.decrypted_secret) {
      return Response.json({ error: "automation_web_password_missing" }, { status: 503 });
    }

    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    if (!projectRef) {
      return Response.json({ error: "project_ref_unavailable" }, { status: 503 });
    }

    const region = (Deno.env.get("SB_REGION") || "sa-east-1").trim();
    const username = `${ROLE_NAME}.${projectRef}`;
    const hosts = [
      `aws-0-${region}.pooler.supabase.com`,
      `aws-1-${region}.pooler.supabase.com`
    ];

    for (const host of hosts) {
      const result = await testCandidate({
        host,
        username,
        password: passwordRow.decrypted_secret
      });
      if (result.ok) {
        return Response.json({
          ok: true,
          connection: {
            host,
            port: 5432,
            database: "postgres",
            username,
            mode: "supavisor-session",
            tls: "require"
          },
          checks: result.checks
        });
      }
    }

    return Response.json(
      {
        ok: false,
        error: "no_pooler_candidate_connected",
        candidatesTested: hosts.length
      },
      { status: 503 }
    );
  } finally {
    await admin.end({ timeout: 3 });
  }
});

async function testCandidate(input: {
  host: string;
  username: string;
  password: string;
}): Promise<{
  ok: boolean;
  checks?: {
    authenticatedAsAutomationWeb: boolean;
    appPrivateReadable: boolean;
    secretBridgeWorks: boolean;
    vaultDirectBlocked: boolean;
  };
}> {
  const url = `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:5432/postgres?sslmode=require`;
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 7,
    idle_timeout: 3
  });

  try {
    const [identity] = await sql<{ current_user: string }[]>`
      select current_user
    `;
    const [workspaceRead] = await sql<{ ok: boolean }[]>`
      select true as ok
      from app_private.workspaces
      limit 1
    `;
    const [bridge] = await sql<{ ok: boolean }[]>`
      select app_private.get_platform_secret('provider_secret_keyring') is not null as ok
    `;

    let vaultDirectBlocked = false;
    try {
      await sql`select 1 from vault.decrypted_secrets limit 1`;
    } catch {
      vaultDirectBlocked = true;
    }

    const checks = {
      authenticatedAsAutomationWeb: identity?.current_user === ROLE_NAME,
      appPrivateReadable: workspaceRead?.ok ?? true,
      secretBridgeWorks: bridge?.ok === true,
      vaultDirectBlocked
    };

    return {
      ok: Object.values(checks).every(Boolean),
      checks
    };
  } catch {
    return { ok: false };
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function verifyRuntimeToken(sql: ReturnType<typeof postgres>, token: string): Promise<boolean> {
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const [row] = await sql<{ token_sha256: string }[]>`
    select token_sha256
    from app_private.runtime_invocation_tokens
    where name = 'g3_runtime'
    limit 1
  `;
  return Boolean(row && row.token_sha256 === tokenHash);
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
