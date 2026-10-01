import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_ENV_PATH = "apps/web/.env.local";
const envPath = resolve(process.argv[2] ?? DEFAULT_ENV_PATH);

let source;
try {
  source = await readFile(envPath, "utf8");
} catch (error) {
  console.error(`HOST PASS env file not found: ${envPath}`);
  console.error("Copy apps/web/.env.local.example to apps/web/.env.local and fill DATABASE_URL locally.");
  process.exit(1);
}

const env = parseEnv(source);
const errors = [];
const notes = [];

expectEqual("APP_ORIGIN", "http://localhost:3000");
expectEqual("NEXT_PUBLIC_SUPABASE_URL", "https://cqtrigqlktekczbbsxiy.supabase.co");
expectPresent("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
expectEqual("GOOGLE_AUTH_ENABLED", "false");
validateDatabaseUrl(env.DATABASE_URL);

for (const forbidden of [
  "META_APP_SECRET",
  "META_WEBHOOK_VERIFY_TOKEN",
  "PROVIDER_SECRET_CURRENT_KEY_VERSION",
  "PROVIDER_SECRET_KEYS_JSON"
]) {
  if (present(env[forbidden])) {
    errors.push(`${forbidden} must not live in the local dashboard env; Supabase Vault is canonical.`);
  }
}

if (errors.length > 0) {
  console.error("HOST PASS environment check FAILED:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("HOST PASS environment check PASSED.");
console.log("- dashboard origin: localhost only");
console.log("- Supabase project: cqtrigqlktekczbbsxiy");
console.log("- database role: automation_web via Supavisor Session Pooler");
console.log("- TLS: required");
console.log("- provider secrets: Vault-only");
for (const note of notes) console.log(`- ${note}`);

function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function expectPresent(name) {
  if (!present(env[name])) errors.push(`${name} is required.`);
}

function expectEqual(name, expected) {
  if (env[name] !== expected) errors.push(`${name} must be exactly ${expected}.`);
}

function validateDatabaseUrl(raw) {
  if (!present(raw)) {
    errors.push("DATABASE_URL is required.");
    return;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    errors.push("DATABASE_URL is not a valid PostgreSQL URL.");
    return;
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    errors.push("DATABASE_URL must use postgres:// or postgresql://.");
  }
  if (decodeURIComponent(url.username) !== "automation_web.cqtrigqlktekczbbsxiy") {
    errors.push("DATABASE_URL must use the least-privilege automation_web Supavisor username.");
  }
  if (url.hostname !== "aws-0-sa-east-1.pooler.supabase.com") {
    errors.push("DATABASE_URL must use the validated São Paulo Supavisor pooler host.");
  }
  if ((url.port || "5432") !== "5432") {
    errors.push("Local long-lived HOST PASS dashboard must use Supavisor Session Pooler port 5432.");
  }
  if (url.pathname !== "/postgres") {
    errors.push("DATABASE_URL database must be postgres.");
  }
  const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
  if (!['require', 'verify-ca', 'verify-full'].includes(sslmode ?? "")) {
    errors.push("DATABASE_URL must set sslmode=require, verify-ca, or verify-full.");
  }
  if (!url.password) {
    errors.push("DATABASE_URL must include the automation_web password locally.");
  }
  if (url.searchParams.get("sslmode") === "require") {
    notes.push("sslmode=require accepted for HOST PASS; verify-full remains the stronger production target");
  }
}

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}
