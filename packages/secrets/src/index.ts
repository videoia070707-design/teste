import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export interface SecretKeyMaterial {
  version: string;
  key: Uint8Array;
}

export interface SecretKeyring {
  current(): SecretKeyMaterial;
  get(version: string): SecretKeyMaterial | null;
}

export interface SecretEnvelope {
  algorithm: "aes-256-gcm";
  keyVersion: string;
  iv: string;
  ciphertext: string;
  authTag: string;
  aad: string;
}

export class StaticSecretKeyring implements SecretKeyring {
  private readonly byVersion = new Map<string, SecretKeyMaterial>();

  constructor(
    private readonly currentVersion: string,
    entries: Array<{ version: string; keyBase64: string }>
  ) {
    for (const entry of entries) {
      const key = Buffer.from(entry.keyBase64, "base64");
      if (key.byteLength !== 32) throw new Error(`Secret key ${entry.version} must be exactly 32 bytes.`);
      this.byVersion.set(entry.version, { version: entry.version, key });
    }

    if (!this.byVersion.has(currentVersion)) {
      throw new Error(`Current secret key version ${currentVersion} is unavailable.`);
    }
  }

  current(): SecretKeyMaterial {
    const material = this.byVersion.get(this.currentVersion);
    if (!material) throw new Error("Current secret key is unavailable.");
    return material;
  }

  get(version: string): SecretKeyMaterial | null {
    return this.byVersion.get(version) ?? null;
  }
}

export class AesGcmSecretCipher {
  constructor(private readonly keyring: SecretKeyring) {}

  encrypt(plaintext: string, aad: string): SecretEnvelope {
    if (!aad) throw new Error("Secret AAD is required.");

    const material = this.keyring.current();
    const key = normalizeKey(material.key);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));

    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf8")),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return {
      algorithm: "aes-256-gcm",
      keyVersion: material.version,
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: authTag.toString("base64"),
      aad
    };
  }

  decrypt(envelope: SecretEnvelope, expectedAad: string): string {
    if (envelope.algorithm !== "aes-256-gcm") throw new Error("Unsupported secret algorithm.");
    if (!constantTimeStringEqual(envelope.aad, expectedAad)) throw new Error("Secret AAD mismatch.");

    const material = this.keyring.get(envelope.keyVersion);
    if (!material) throw new Error(`Secret key version ${envelope.keyVersion} is unavailable.`);

    const decipher = createDecipheriv(
      "aes-256-gcm",
      normalizeKey(material.key),
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAAD(Buffer.from(expectedAad, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]);

    return plaintext.toString("utf8");
  }
}

function normalizeKey(value: Uint8Array): Buffer {
  const key = Buffer.from(value);
  if (key.byteLength !== 32) throw new Error("AES-256-GCM requires a 32-byte key.");
  return key;
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
