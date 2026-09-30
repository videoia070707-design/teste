import assert from "node:assert/strict";
import test from "node:test";
import { AesGcmSecretCipher, StaticSecretKeyring } from "../src/index";

const keyV1 = Buffer.alloc(32, 7).toString("base64");
const keyV2 = Buffer.alloc(32, 9).toString("base64");

function createCipher(currentVersion = "v2") {
  return new AesGcmSecretCipher(new StaticSecretKeyring(currentVersion, [
    { version: "v1", keyBase64: keyV1 },
    { version: "v2", keyBase64: keyV2 }
  ]));
}

test("encrypts and decrypts provider secret with bound AAD", () => {
  const cipher = createCipher();
  const envelope = cipher.encrypt('{"accessToken":"secret"}', "workspace:1:instagram:secret:abc");

  assert.equal(envelope.algorithm, "aes-256-gcm");
  assert.equal(envelope.keyVersion, "v2");
  assert.notEqual(envelope.ciphertext, '{"accessToken":"secret"}');
  assert.equal(
    cipher.decrypt(envelope, "workspace:1:instagram:secret:abc"),
    '{"accessToken":"secret"}'
  );
});

test("refuses decryption when workspace/purpose AAD changes", () => {
  const cipher = createCipher();
  const envelope = cipher.encrypt("secret", "workspace:1:instagram:secret:abc");

  assert.throws(() => {
    cipher.decrypt(envelope, "workspace:2:instagram:secret:abc");
  });
});

test("detects ciphertext tampering", () => {
  const cipher = createCipher();
  const envelope = cipher.encrypt("secret", "aad");
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 1;

  assert.throws(() => {
    cipher.decrypt({ ...envelope, ciphertext: bytes.toString("base64") }, "aad");
  });
});

test("old key versions remain decryptable after rotation", () => {
  const oldCipher = createCipher("v1");
  const envelope = oldCipher.encrypt("legacy-secret", "aad");

  const rotatedCipher = createCipher("v2");
  assert.equal(rotatedCipher.decrypt(envelope, "aad"), "legacy-secret");
});

test("rejects invalid AES key lengths", () => {
  assert.throws(() => {
    new StaticSecretKeyring("bad", [{ version: "bad", keyBase64: Buffer.alloc(16).toString("base64") }]);
  });
});
