import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Merging to main IS the deploy here: .github/workflows/...AutoDeployTrigger... builds the image and
// ships it to Azure Container Apps on every push. Nothing in that path touched the database, and the
// Dockerfile's CMD went straight to `npm run start` -- so app code that reads a new column went live
// against a database that did not have it yet. web/scripts/migrate-deploy.mjs says exactly this in
// its own header ("not optional and not deferrable ... every page that touches the changed model
// starts throwing") and the pipeline had no way to honour it. On 2026-09-14 Agent.exoPinError and
// Agent.browserInstallError shipped ahead of their migration and the Agents page threw on every load.
//
// The container now migrates before it serves. These tests fail if that ordering is ever lost.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const dockerfile = readFileSync(resolve(ROOT, "Dockerfile"), "utf8");
const entrypoint = readFileSync(resolve(ROOT, "web/scripts/docker-entrypoint.sh"), "utf8");

// Executable lines only. The entrypoint's header comment names both commands while explaining the
// bug, and matching that prose would let the real ordering regress while the test stayed green.
const code = entrypoint
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.trimStart().startsWith("#"))
  .join(" ");

test("the container starts through the entrypoint, not straight into the server", () => {
  const cmd = dockerfile
    .split(/\r?\n/)
    .filter((l) => l.trimStart().startsWith("CMD"))
    .join(" ");
  assert.match(cmd, /docker-entrypoint\.sh/);
});

test("migrations are applied before the server accepts traffic", () => {
  const migrateAt = code.indexOf("prisma migrate deploy");
  const serveAt = code.indexOf("npm run start");
  assert.ok(migrateAt > -1, "the entrypoint must apply migrations");
  assert.ok(serveAt > -1, "the entrypoint must start the server");
  assert.ok(migrateAt < serveAt, "migrating after serving is the bug this prevents");
});

test("a failed migration stops the container instead of serving broken code", () => {
  // Without `set -e` the shell runs on past a failed migration and starts the server anyway --
  // which is precisely the state being fixed, reached by a different route. Container Apps keeps
  // the previous revision serving when the new one never becomes healthy, so failing is correct.
  assert.match(code, /set -e/);
});

test("the server is exec'd so it keeps PID 1 and receives SIGTERM", () => {
  // Container Apps stops a revision with SIGTERM. Left as a child of the shell, the server would
  // not receive it and would be SIGKILLed after the grace period, cutting in-flight requests.
  assert.match(code, /exec npm run start/);
});
