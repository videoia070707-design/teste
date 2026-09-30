import { randomUUID } from "node:crypto";
import { AesGcmSecretCipher, type SecretEnvelope } from "@automation/secrets";
import type { DatabaseClient } from "./index";

export interface StoredSecretReference {
  store: "postgres-aesgcm-v1";
  ref: string;
  keyVersion: string;
}

export class PostgresEncryptedSecretVault {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly cipher: AesGcmSecretCipher
  ) {}

  async put(input: {
    workspaceId: string;
    purpose: string;
    plaintext: string;
  }): Promise<StoredSecretReference> {
    const id = randomUUID();
    const aad = buildAad(input.workspaceId, input.purpose, id);
    const envelope = this.cipher.encrypt(input.plaintext, aad);

    await this.sql`
      insert into app_private.secret_envelopes (
        id,
        workspace_id,
        purpose,
        algorithm,
        key_version,
        iv,
        ciphertext,
        auth_tag,
        aad
      ) values (
        ${id},
        ${input.workspaceId},
        ${input.purpose},
        ${envelope.algorithm},
        ${envelope.keyVersion},
        ${Buffer.from(envelope.iv, "base64")},
        ${Buffer.from(envelope.ciphertext, "base64")},
        ${Buffer.from(envelope.authTag, "base64")},
        ${envelope.aad}
      )
    `;

    return {
      store: "postgres-aesgcm-v1",
      ref: id,
      keyVersion: envelope.keyVersion
    };
  }

  async get(input: {
    workspaceId: string;
    purpose: string;
    ref: string;
  }): Promise<string> {
    const [row] = await this.sql<{
      id: string;
      workspace_id: string;
      purpose: string;
      algorithm: "aes-256-gcm";
      key_version: string;
      iv: Buffer;
      ciphertext: Buffer;
      auth_tag: Buffer;
      aad: string;
    }[]>`
      select
        id,
        workspace_id,
        purpose,
        algorithm,
        key_version,
        iv,
        ciphertext,
        auth_tag,
        aad
      from app_private.secret_envelopes
      where id = ${input.ref}
        and workspace_id = ${input.workspaceId}
        and purpose = ${input.purpose}
      limit 1
    `;

    if (!row) throw new Error("SECRET_NOT_FOUND");

    const expectedAad = buildAad(input.workspaceId, input.purpose, row.id);
    const envelope: SecretEnvelope = {
      algorithm: row.algorithm,
      keyVersion: row.key_version,
      iv: Buffer.from(row.iv).toString("base64"),
      ciphertext: Buffer.from(row.ciphertext).toString("base64"),
      authTag: Buffer.from(row.auth_tag).toString("base64"),
      aad: row.aad
    };

    return this.cipher.decrypt(envelope, expectedAad);
  }

  async delete(input: { workspaceId: string; purpose: string; ref: string }): Promise<void> {
    await this.sql`
      delete from app_private.secret_envelopes
      where id = ${input.ref}
        and workspace_id = ${input.workspaceId}
        and purpose = ${input.purpose}
    `;
  }

  async attachToConnection(input: {
    connectionId: string;
    reference: StoredSecretReference;
  }): Promise<void> {
    await this.sql`
      insert into app_private.connection_secret_refs (
        connection_id,
        secret_store,
        secret_ref,
        key_version
      ) values (
        ${input.connectionId},
        ${input.reference.store},
        ${input.reference.ref},
        ${input.reference.keyVersion}
      )
      on conflict (connection_id)
      do update set
        secret_store = excluded.secret_store,
        secret_ref = excluded.secret_ref,
        key_version = excluded.key_version,
        rotated_at = now()
    `;
  }

  async detachFromConnection(connectionId: string): Promise<void> {
    await this.sql`
      delete from app_private.connection_secret_refs
      where connection_id = ${connectionId}
    `;
  }

  async getConnectionReference(connectionId: string): Promise<StoredSecretReference | null> {
    const [row] = await this.sql<{
      secret_store: string;
      secret_ref: string;
      key_version: string | null;
    }[]>`
      select secret_store, secret_ref, key_version
      from app_private.connection_secret_refs
      where connection_id = ${connectionId}
      limit 1
    `;

    if (!row) return null;
    if (row.secret_store !== "postgres-aesgcm-v1" || !row.key_version) {
      throw new Error("UNSUPPORTED_SECRET_REFERENCE");
    }

    return {
      store: "postgres-aesgcm-v1",
      ref: row.secret_ref,
      keyVersion: row.key_version
    };
  }
}

function buildAad(workspaceId: string, purpose: string, secretId: string): string {
  return `automation-secret:v1:${workspaceId}:${purpose}:${secretId}`;
}
