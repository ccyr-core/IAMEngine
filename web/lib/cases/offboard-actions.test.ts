import { test } from "node:test";
import assert from "node:assert/strict";
import { withOffboardActions, readOffboardActions } from "./offboard-actions";
import type { PlannedJob } from "../orchestrator";

const job = (systemKey: string, config: Record<string, unknown> | null = null, mode = "api") =>
  ({ systemKey, sequence: 0, mode, requiresApproval: false, captureEvidence: false, intent: "disable", secretNames: [], dependsOn: [], config }) as unknown as PlannedJob;
const by = (jobs: PlannedJob[], k: string) => jobs.find((j) => j.systemKey === k)!;

test("no choice leaves the plan exactly as the client configured it", () => {
  const jobs = [job("google-workspace"), job("exchange", { convertToShared: true })];
  assert.equal(withOffboardActions(jobs, {}), jobs);
});

test("Google delete: deleteUser, and the step becomes destructive (approval + evidence)", () => {
  const g = by(withOffboardActions([job("google-workspace", { inactiveOu: "/Former" })], { offboardActions: { "google-workspace": "delete" } }), "google-workspace");
  assert.deepEqual(g.config, { inactiveOu: "/Former", deleteUser: true });
  assert.equal(g.intent, "destructive");
  assert.equal(g.requiresApproval, true);
  assert.equal(g.captureEvidence, true);
});

test("Google suspend over a client that deletes: deleteUser false, no gate added", () => {
  const g = by(withOffboardActions([job("google-workspace", { deleteUser: true })], { offboardActions: { "google-workspace": "suspend" } }), "google-workspace");
  assert.deepEqual(g.config, { deleteUser: false });
  assert.equal(g.requiresApproval, false);
});

test("Exchange delete: no convert, and the licence step may strip an unconverted mailbox — both gated", () => {
  const jobs = withOffboardActions(
    [job("exchange", { convertToShared: { skipIfMailboxOverGB: 50 } }), job("m365", { removeLicense: { note: "x" }, blockSignIn: true })],
    { offboardActions: { exchange: "delete" } },
  );
  assert.deepEqual(by(jobs, "exchange").config, { convertToShared: false });
  assert.deepEqual(by(jobs, "m365").config, { removeLicense: { note: "x", allowWithoutConvert: true }, blockSignIn: true });
  assert.equal(by(jobs, "exchange").requiresApproval, true);
  assert.equal(by(jobs, "m365").requiresApproval, true);
});

test("Exchange convert over a client that doesn't: convertToShared true, the licence step untouched", () => {
  const jobs = withOffboardActions([job("exchange", { convertToShared: false }), job("m365", { removeLicense: true })], { offboardActions: { exchange: "convert" } });
  assert.deepEqual(by(jobs, "exchange").config, { convertToShared: true });
  assert.deepEqual(by(jobs, "m365").config, { removeLicense: true });
});

test("Spanning remove frees the seat (destructive); archive swaps to Archive and drops a removal", () => {
  const rm = by(withOffboardActions([job("spanning", { swapLicense: { to: "Archive" } })], { offboardActions: { spanning: "remove" } }), "spanning");
  assert.deepEqual(rm.config, { removeLicense: true });
  assert.equal(rm.intent, "destructive");
  const ar = by(withOffboardActions([job("spanning", { removeLicense: true, unassign: true })], { offboardActions: { spanning: "archive" } }), "spanning");
  assert.deepEqual(ar.config, { swapLicense: { to: "Archive" } });
});

test("unknown systems and values in the payload are ignored", () => {
  assert.deepEqual(readOffboardActions({ offboardActions: { "google-workspace": "nuke", exchange: "delete", zoom: "delete" } }), { exchange: "delete" });
  assert.deepEqual(readOffboardActions({ offboardActions: "delete" }), {});
});

test("a manual step never gets an approval gate (the human doing it is the approval)", () => {
  const g = by(withOffboardActions([job("google-workspace", null, "manual")], { offboardActions: { "google-workspace": "delete" } }), "google-workspace");
  assert.equal(g.requiresApproval, false);
  assert.equal(g.intent, "destructive");
});
