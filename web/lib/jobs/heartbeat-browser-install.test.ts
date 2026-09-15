import { test } from "node:test";
import assert from "node:assert/strict";
import { browserInstallPatch } from "./runner-service";

// The sidecar install runs as a BACKGROUND job on the runner, so the app never sees it happen -- it
// only learns the outcome from the next heartbeat. Previously the only signal was whether the
// 'browser' capability turned up, and when it did not there was nothing to read: the runner's reason
// went to its local log and the job's own output was piped to Out-Null. Two installs failed unnoticed
// and 21 browser jobs queued behind them.

test("reporting the browser capability clears a recorded failure", () => {
  // The agent saying it works now outranks a reason it did not, whether or not it also sends one.
  assert.deepEqual(browserInstallPatch(["active-directory", "browser"], null), { browserInstallError: null });
  assert.deepEqual(browserInstallPatch(["browser"], "some stale reason"), { browserInstallError: null });
});

test("a reported failure is recorded", () => {
  const p = browserInstallPatch(["active-directory"], "npm install failed (1): ETIMEDOUT registry.npmjs.org");
  assert.match(String(p.browserInstallError), /ETIMEDOUT/);
});

test("an install still running writes nothing — silence is not failure", () => {
  // No capability yet AND no reason yet is the normal middle of a long download. Writing a failure
  // here would flip the page to an error every heartbeat while the install is fine.
  assert.deepEqual(browserInstallPatch(["active-directory"], null), {});
  assert.deepEqual(browserInstallPatch(null, undefined), {});
});

test("a runaway reason is capped before it reaches the row", () => {
  const p = browserInstallPatch([], "x".repeat(5000));
  assert.equal(String(p.browserInstallError).length, 2000);
});
