import { readFile } from "node:fs/promises";

const PROJECT_ORIGIN = "https://cqtrigqlktekczbbsxiy.supabase.co";
const CONSOLE_PATH = "tools/g3-console/index.html";
const SERVER_PATH = "scripts/g3-console-server.mjs";

const [consoleHtml, serverSource] = await Promise.all([
  readFile(CONSOLE_PATH, "utf8"),
  readFile(SERVER_PATH, "utf8")
]);

const errors = [];

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
  errors.push("G3 local tooling must not hardcode a guessed Supavisor pooler hostname.");
}

if (/META_APP_SECRET\s*=\s*[^\s#]+/i.test(consoleHtml + serverSource)) {
  errors.push("Meta App Secret must never be embedded in local console source.");
}

if (/META_WEBHOOK_VERIFY_TOKEN\s*=\s*[^\s#]+/i.test(consoleHtml + serverSource)) {
  errors.push("Webhook verify token must never be embedded in local console source.");
}

if (errors.length > 0) {
  console.error("G3 local HOST PASS tooling check FAILED:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("G3 local HOST PASS tooling check PASSED.");
console.log("- console origin: localhost / loopback only");
console.log("- backend: Supabase Free Edge control plane");
console.log("- provider secrets: Vault-only");
console.log("- no DATABASE_URL or guessed pooler host required by the G3 Console");
console.log("- this check validates tooling only; it NEVER asserts G3 HOST PASS");
console.log("- live PASS still requires OAuth real + inbound real + outbound real with provider_message_id");

function expectIncludes(source, needle, message) {
  if (!source.includes(needle)) errors.push(message);
}
