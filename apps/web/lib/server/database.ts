import "server-only";
import { createDatabaseClient, type DatabaseClient } from "@automation/storage-postgres";

let client: DatabaseClient | undefined;

export function getDatabase(): DatabaseClient {
  if (client) return client;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  const publicDeployment = isPublicDeployment();
  if (publicDeployment) validateProductionDatabaseUrl(connectionString);

  client = createDatabaseClient(connectionString, {
    maxConnections: readPoolSize(process.env.DATABASE_POOL_MAX, publicDeployment ? 3 : 10)
  });
  return client;
}

function validateProductionDatabaseUrl(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }

  const username = decodeURIComponent(url.username);
  const projectRef = supabaseProjectRef();
  const sharedPooler = url.hostname.endsWith(".pooler.supabase.com");
  const expectedUsername = sharedPooler && projectRef
    ? `automation_web.${projectRef}`
    : "automation_web";

  if (username !== expectedUsername) {
    throw new Error("Public DATABASE_URL must use the automation_web least-privilege role.");
  }

  if (sharedPooler) {
    const effectivePort = url.port || "5432";
    if (effectivePort !== "5432") {
      throw new Error("Public Supavisor DATABASE_URL must use Session Pooler port 5432.");
    }
  }

  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  if (sslMode !== "require" && sslMode !== "verify-ca" && sslMode !== "verify-full") {
    throw new Error("Public DATABASE_URL must enforce PostgreSQL TLS.");
  }
}

function readPoolSize(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 20.");
  }
  return value;
}

function supabaseProjectRef(): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configured) return null;

  try {
    const hostname = new URL(configured).hostname;
    const suffix = ".supabase.co";
    return hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : null;
  } catch {
    return null;
  }
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
