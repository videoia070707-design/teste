import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = Number(process.env.G3_CONSOLE_PORT || "4173");
const ROOT = fileURLToPath(new URL("./", import.meta.url));

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"]
]);

const server = http.createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === "/") pathname = "/index.html";

    const relative = normalize(pathname).replace(/^([/\\])+/, "");
    const absolute = join(ROOT, relative);
    if (!absolute.startsWith(ROOT)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    const fileStat = statSync(absolute);
    if (!fileStat.isFile()) throw new Error("NOT_FILE");

    response.writeHead(200, {
      "content-type": contentTypes.get(extname(absolute).toLowerCase()) || "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    });
    createReadStream(absolute).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`G3 Console: http://${HOST}:${PORT}/`);
  console.log("Local-only server. Press Ctrl+C to stop.");
});

server.on("error", (error) => {
  console.error(`Unable to start G3 Console: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
