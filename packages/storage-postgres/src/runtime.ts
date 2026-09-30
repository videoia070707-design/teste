import type { DatabaseClient } from "./index";

export type WorkerService = "worker-ingress" | "worker-outbound";

export interface WorkerHeartbeatRecord {
  service: WorkerService;
  workerId: string;
  startedAt: string;
  lastSeenAt: string;
  stoppedAt: string | null;
}

export class PostgresWorkerHeartbeatStore {
  constructor(private readonly sql: DatabaseClient) {}

  async beat(input: {
    service: WorkerService;
    workerId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.sql`
      insert into app_private.worker_heartbeats (
        service,
        worker_id,
        started_at,
        last_seen_at,
        stopped_at,
        metadata
      ) values (
        ${input.service},
        ${input.workerId},
        now(),
        now(),
        null,
        ${this.sql.json((input.metadata ?? {}) as never)}
      )
      on conflict (service, worker_id)
      do update set
        last_seen_at = now(),
        stopped_at = null,
        metadata = excluded.metadata
    `;
  }

  async markStopped(service: WorkerService, workerId: string): Promise<void> {
    await this.sql`
      update app_private.worker_heartbeats
      set
        last_seen_at = now(),
        stopped_at = now()
      where service = ${service}
        and worker_id = ${workerId}
    `;
  }

  async listRecent(maxAgeSeconds = 90): Promise<WorkerHeartbeatRecord[]> {
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 86_400) {
      throw new Error("INVALID_HEARTBEAT_MAX_AGE");
    }

    const rows = await this.sql<{
      service: WorkerService;
      worker_id: string;
      started_at: string;
      last_seen_at: string;
      stopped_at: string | null;
    }[]>`
      select service, worker_id, started_at, last_seen_at, stopped_at
      from app_private.worker_heartbeats
      where last_seen_at >= now() - (${maxAgeSeconds} * interval '1 second')
      order by service asc, last_seen_at desc
    `;

    return rows.map((row) => ({
      service: row.service,
      workerId: row.worker_id,
      startedAt: row.started_at,
      lastSeenAt: row.last_seen_at,
      stoppedAt: row.stopped_at
    }));
  }
}
