import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../tools/g3-console");
const htmlPath = resolve(root, "index.html");
const port = Number(process.env.G3_CONSOLE_PORT ?? "3000");

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("G3_CONSOLE_PORT must be an integer between 1024 and 65535.");
}

const html = await readFile(htmlPath);
const headers = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
  "content-security-policy": [
    "default-src 'none'",
    "script-src https://esm.sh",
    "style-src 'unsafe-inline'",
    "connect-src https://cqtrigqlktekczbbsxiy.supabase.co wss://cqtrigqlktekczbbsxiy.supabase.co",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join("; ")
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (request.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/index.html")) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, headers);
  response.end(html);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`G3 Console: http://127.0.0.1:${port}`);
  console.log("Local-only control surface. Keep this terminal open during HOST PASS setup.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
