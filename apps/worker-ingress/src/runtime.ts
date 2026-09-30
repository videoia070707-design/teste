import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { createDatabaseClient } from "@automation/storage-postgres";
import { PostgresWorkerHeartbeatStore } from "@automation/storage-postgres/runtime";

const SERVICE = "worker-ingress" as const;
const HEARTBEAT_MS = 10_000;

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const workerId = process.env.INGRESS_WORKER_ID?.trim() ||
    `${hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;

  const sql = createDatabaseClient(databaseUrl);
  const heartbeats = new PostgresWorkerHeartbeatStore(sql);

  await heartbeats.beat({
    service: SERVICE,
    workerId,
    metadata: { hostname: hostname(), supervisorPid: process.pid }
  });

  const child = spawnWorker(workerId);
  const heartbeatTimer = setInterval(() => {
    void heartbeats.beat({
      service: SERVICE,
      workerId,
      metadata: { hostname: hostname(), supervisorPid: process.pid, childPid: child.pid ?? null }
    }).catch((error) => {
      console.error("Ingress heartbeat failed", error);
    });
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();

  forwardSignal(child, "SIGTERM");
  forwardSignal(child, "SIGINT");

  const exitCode = await waitForChild(child);
  clearInterval(heartbeatTimer);

  try {
    await heartbeats.markStopped(SERVICE, workerId);
  } finally {
    await sql.end({ timeout: 5 });
  }

  process.exitCode = exitCode;
}

function spawnWorker(workerId: string): ChildProcess {
  return spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      INGRESS_WORKER_ID: workerId
    },
    stdio: "inherit"
  });
}

function forwardSignal(child: ChildProcess, signal: NodeJS.Signals): void {
  process.once(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

function waitForChild(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
        return;
      }
      console.error("Ingress worker exited by signal", signal);
      resolve(1);
    });
  });
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error) => {
  console.error("Ingress runtime supervisor terminated", error);
  process.exitCode = 1;
});
