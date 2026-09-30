import postgres from "postgres";

export type DatabaseClient = ReturnType<typeof postgres>;

export interface WebhookIngressInput {
  provider: string;
  signatureValid: boolean;
  bodySha256: string;
  rawBody: Uint8Array;
  headers: Record<string, string>;
  parsedPayload: unknown | null;
  providerAccountIds: string[];
}

export interface WebhookIngressResult {
  id: string;
  receiveCount: number;
  duplicate: boolean;
}

export interface WebhookIngressStore {
  persist(input: WebhookIngressInput): Promise<WebhookIngressResult>;
}

export function createDatabaseClient(connectionString: string): DatabaseClient {
  if (!connectionString.trim()) throw new Error("DATABASE_URL is required.");
  return postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  });
}

export class PostgresWebhookIngressStore implements WebhookIngressStore {
  constructor(private readonly sql: DatabaseClient) {}

  async persist(input: WebhookIngressInput): Promise<WebhookIngressResult> {
    const payloadValue = input.parsedPayload === null
      ? null
      : this.sql.json(input.parsedPayload as never);

    const [row] = await this.sql<{
      id: string;
      receive_count: number;
      inserted: boolean;
    }[]>`
      insert into app_private.webhook_ingress_events (
        provider,
        signature_valid,
        body_sha256,
        raw_body,
        headers,
        parsed_payload,
        provider_account_ids
      ) values (
        ${input.provider},
        ${input.signatureValid},
        ${input.bodySha256},
        ${Buffer.from(input.rawBody)},
        ${this.sql.json(input.headers)},
        ${payloadValue},
        ${this.sql.array(input.providerAccountIds)}
      )
      on conflict (provider, body_sha256)
      do update set
        receive_count = app_private.webhook_ingress_events.receive_count + 1,
        last_received_at = now(),
        signature_valid = app_private.webhook_ingress_events.signature_valid or excluded.signature_valid
      returning
        id,
        receive_count,
        (xmax = 0) as inserted
    `;

    if (!row) throw new Error("Webhook ingress insert returned no row.");

    return {
      id: row.id,
      receiveCount: row.receive_count,
      duplicate: !row.inserted
    };
  }
}
