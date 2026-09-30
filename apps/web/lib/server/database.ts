import "server-only";
import { createDatabaseClient, type DatabaseClient } from "@automation/storage-postgres";

let client: DatabaseClient | undefined;

export function getDatabase(): DatabaseClient {
  if (client) return client;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  client = createDatabaseClient(connectionString);
  return client;
}
