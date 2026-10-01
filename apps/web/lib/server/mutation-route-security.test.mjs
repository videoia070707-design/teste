import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const API_ROOT = join(WEB_ROOT, "app", "api");

test("workspace-authenticated POST routes require same-origin guard", async () => {
  const routeFiles = await collectRouteFiles(API_ROOT);
  const violations = [];

  for (const file of routeFiles) {
    const source = await readFile(file, "utf8");
    const isPostMutation = /export\s+async\s+function\s+POST\s*\(/.test(source);
    const usesWorkspaceSession = source.includes("requireWorkspaceContext");

    if (!isPostMutation || !usesWorkspaceSession) continue;

    const importsGuard = source.includes("isTrustedMutationRequest");
    const invokesGuard = source.includes("isTrustedMutationRequest(request");
    if (!importsGuard || !invokesGuard) {
      violations.push(relative(WEB_ROOT, file));
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Authenticated POST routes missing same-origin guard: ${violations.join(", ")}`
  );
});

async function collectRouteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectRouteFiles(path));
    } else if (entry.isFile() && entry.name === "route.ts") {
      files.push(path);
    }
  }

  return files;
}
