import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { createDatabaseClient } from "@automation/storage-postgres";
import { PostgresWorkerHeartbeatStore } from "@automation/storage-postgres/runtime";

const SERVICE = "worker-ingress" as const;
const ID_ENV = "INGRESS_WORKER_ID";
const DEFAULT_HEARTBEAT_MS = 15_000;

const databaseUrl = requireEnv("DATABASE_URL");
const workerId = process.env[ID_ENV]?.trim() || `${hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
process.env[ID_ENV] = workerId;

const heartbeatMs = readHeartbeatMs();
const heartbeatSql = createDatabaseClient(databaseUrl);
const heartbeatStore = new PostgresWorkerHeartbeatStore(heartbeatSql);
let heartbeatInFlight = false;
let stopping = false;

await heartbeatStore.beat({
  service: SERVICE,
  workerId,
  metadata: { pid: process.pid, host: hostname() }
});

const timer = setInterval(() => {
  if (stopping || heartbeatInFlight) return;
  heartbeatInFlight = true;
  void heartbeatStore.beat({
    service: SERVICE,
    workerId,
    metadata: { pid: process.pid, host: hostname() }
  }).catch((error: unknown) => {
    console.error("Ingress heartbeat failed", error);
  }).finally(() => {
    heartbeatInFlight = false;
  });
}, heartbeatMs);
timer.unref();

let shutdownPromise: Promise<void> | null = null;
function shutdownHeartbeat(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  clearInterval(timer);
  shutdownPromise = (async () => {
    try {
      await heartbeatStore.markStopped(SERVICE, workerId);
    } catch (error) {
      console.error("Ingress heartbeat stop marker failed", error);
    } finally {
      await heartbeatSql.end({ timeout: 5 }).catch(() => undefined);
    }
  })();
  return shutdownPromise;
}

process.once("SIGTERM", () => { void shutdownHeartbeat(); });
process.once("SIGINT", () => { void shutdownHeartbeat(); });
process.once("beforeExit", () => { void shutdownHeartbeat(); });

await import("./index.ts");

function readHeartbeatMs(): number {
  const raw = process.env.WORKER_HEARTBEAT_SECONDS?.trim();
  if (!raw) return DEFAULT_HEARTBEAT_MS;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 60) {
    throw new Error("WORKER_HEARTBEAT_SECONDS must be an integer between 5 and 60.");
  }
  return seconds * 1_000;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
