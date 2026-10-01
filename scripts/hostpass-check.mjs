import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PROJECT_REF = "cqtrigqlktekczbbsxiy";
const PROJECT_ORIGIN = `https://${PROJECT_REF}.supabase.co`;
const CONSOLE_PATH = "tools/g3-console/index.html";
const SERVER_PATH = "scripts/g3-console-server.mjs";
const WEB_PACKAGE_PATH = "apps/web/package.json";
const OPTIONAL_ENV_PATH = process.argv[2] ? resolve(process.argv[2]) : null;

const [consoleHtml, serverSource, webPackageSource] = await Promise.all([
  readFile(CONSOLE_PATH, "utf8"),
  readFile(SERVER_PATH, "utf8"),
  readFile(WEB_PACKAGE_PATH, "utf8")
]);

const errors = [];
const notes = [];
const webPackage = JSON.parse(webPackageSource);
const supabaseJsVersion = webPackage?.dependencies?.["@supabase/supabase-js"];

if (typeof supabaseJsVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(supabaseJsVersion)) {
  errors.push("apps/web must pin @supabase/supabase-js to an exact semver version.");
} else {
  expectIncludes(
    consoleHtml,
    `https://esm.sh/@supabase/supabase-js@${supabaseJsVersion}`,
    "G3 Console Supabase client version must match apps/web/package.json exactly."
  );
}

expectIncludes(consoleHtml, PROJECT_ORIGIN, "console must target the real G3 Supabase project");
expectIncludes(consoleHtml, "/functions/v1/g3-control", "console must use the authenticated G3 control plane");
expectIncludes(consoleHtml, "/functions/v1/instagram-oauth-start", "console must start OAuth through the Edge function");
expectIncludes(consoleHtml, "/functions/v1/instagram-oauth-callback", "console must display the public OAuth callback");
expectIncludes(consoleHtml, "/functions/v1/instagram-webhook", "console must display the public webhook callback");
expectIncludes(consoleHtml, "/functions/v1/instagram-data-deletion", "console must display the data-deletion surface");
expectIncludes(consoleHtml, "/functions/v1/platform-legal?document=privacy", "console must display the privacy surface");

expectIncludes(serverSource, 'server.listen(port, "127.0.0.1"', "local console server must bind only to loopback");
expectIncludes(serverSource, '"cache-control": "no-store, max-age=0"', "local console must disable caching");
expectIncludes(serverSource, '"frame-ancestors \'none\'"', "local console must deny framing");
expectIncludes(serverSource, `connect-src ${PROJECT_ORIGIN}`, "CSP must restrict network access to the G3 Supabase project");

if (/aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com/i.test(consoleHtml + serverSource)) {
  errors.push("G3 local console must not depend on a hardcoded Supavisor pooler hostname.");
}
if (/META_APP_SECRET\s*=\s*[^\s#]+/i.test(consoleHtml + serverSource)) {
  errors.push("Meta App Secret must never be embedded in local console source.");
}
if (/META_WEBHOOK_VERIFY_TOKEN\s*=\s*[^\s#]+/i.test(consoleHtml + serverSource)) {
  errors.push("Webhook verify token must never be embedded in local console source.");
}

if (OPTIONAL_ENV_PATH) {
  let envSource;
  try {
    envSource = await readFile(OPTIONAL_ENV_PATH, "utf8");
  } catch {
    errors.push(`optional dashboard env file not found: ${OPTIONAL_ENV_PATH}`);
    envSource = "";
  }
  validateOptionalDashboardEnv(parseEnv(envSource));
}

if (errors.length > 0) {
  console.error("G3 local HOST PASS tooling check FAILED:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("G3 local HOST PASS tooling check PASSED.");
console.log("- primary control surface: localhost + Supabase Free Edge");
console.log("- provider secrets: Vault-only");
console.log(`- Supabase browser client aligned at ${supabaseJsVersion}`);
console.log("- primary G3 Console does not require DATABASE_URL or a pooler host");
if (OPTIONAL_ENV_PATH) console.log("- optional Next.js dashboard env also passed least-privilege DB checks");
for (const note of notes) console.log(`- ${note}`);
console.log("- this check validates tooling only; it NEVER asserts G3 HOST PASS");
console.log("- live PASS still requires OAuth real + inbound real + outbound real with provider_message_id");

function validateOptionalDashboardEnv(env) {
  expectEnvEqual(env, "APP_ORIGIN", "http://localhost:3000");
  expectEnvEqual(env, "NEXT_PUBLIC_SUPABASE_URL", PROJECT_ORIGIN);
  expectEnvPresent(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  expectEnvEqual(env, "GOOGLE_AUTH_ENABLED", "false");

  for (const forbidden of [
    "META_APP_SECRET",
    "META_WEBHOOK_VERIFY_TOKEN",
    "PROVIDER_SECRET_CURRENT_KEY_VERSION",
    "PROVIDER_SECRET_KEYS_JSON"
  ]) {
    if (present(env[forbidden])) errors.push(`${forbidden} must not live in the dashboard env; Supabase Vault is canonical.`);
  }

  const raw = env.DATABASE_URL;
  if (!present(raw)) {
    errors.push("DATABASE_URL is required only for the optional full Next.js dashboard env check.");
    return;
  }

  if (raw.includes("<SUPABASE_POOLER_HOST>")) errors.push("DATABASE_URL still contains the pooler-host placeholder; copy the exact Shared Pooler host from Supabase Dashboard → Connect.");
  if (raw.includes("<AUTOMATION_WEB_PASSWORD>")) errors.push("DATABASE_URL still contains the automation_web password placeholder.");

  let url;
  try {
    url = new URL(raw);
  } catch {
    errors.push("DATABASE_URL is not a valid PostgreSQL URL.");
    return;
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) errors.push("DATABASE_URL must use postgres:// or postgresql://.");
  if (decodeURIComponent(url.username) !== `automation_web.${PROJECT_REF}`) errors.push("DATABASE_URL must use the least-privilege automation_web Supavisor username.");
  if (!url.hostname.endsWith(".pooler.supabase.com")) errors.push("DATABASE_URL host must be the Shared Pooler hostname copied from Supabase Connect.");
  if ((url.port || "5432") !== "5432") errors.push("Persistent local Next.js dashboard must use Supavisor Session Pooler port 5432.");
  if (url.pathname !== "/postgres") errors.push("DATABASE_URL database must be postgres.");

  const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
  if (!["require", "verify-ca", "verify-full"].includes(sslmode ?? "")) errors.push("DATABASE_URL must set sslmode=require, verify-ca, or verify-full.");
  if (!decodeURIComponent(url.password || "")) errors.push("DATABASE_URL must include the automation_web password locally.");
  if (sslmode === "require") notes.push("sslmode=require accepted for HOST PASS; verify-full remains the stronger production target");
}

function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function expectIncludes(source, needle, message) {
  if (!source.includes(needle)) errors.push(message);
}
function expectEnvPresent(env, name) {
  if (!present(env[name])) errors.push(`${name} is required.`);
}
function expectEnvEqual(env, name, expected) {
  if (env[name] !== expected) errors.push(`${name} must be exactly ${expected}.`);
}
function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}
