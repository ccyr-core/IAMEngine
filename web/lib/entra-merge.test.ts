import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClientSystem } from "@prisma/client";
import { mergeEntraIntoM365 } from "./entra-merge";
import { planCase } from "./orchestrator";

function sys(over: Partial<ClientSystem>): ClientSystem {
  return {
    id: "id", clientId: "c", systemKey: "m365", mode: "api", onboardWhen: "always", offboardWhen: "always",
    dependsOn: [], requiresApproval: false, captureEvidence: false, secretNames: ["m365-admin"], config: null, ...over,
  } as unknown as ClientSystem;
}

test("MarketScience: the licence m365 deferred to entra is removed by the merged step", () => {
  const out = mergeEntraIntoM365([
    sys({ systemKey: "m365", config: { offboard: { blockSignIn: true, removeAllGroups: true, removeLicense: { defer: true, removedBy: "entra", note: "not here" } } } }),
    sys({ systemKey: "entra", dependsOn: ["exchange", "m365"], config: { offboard: { removeAppAccess: true, revokeActiveSessions: true, removeLicense: true } } }),
    sys({ systemKey: "exchange" }),
  ]);
  const m = out.find((s) => s.systemKey === "m365")!;
  assert.equal(out.some((s) => s.systemKey === "entra"), false);
  assert.deepEqual((m.config as { offboard: unknown }).offboard, { removeAppAccess: true, revokeActiveSessions: true, removeLicense: true, blockSignIn: true, removeAllGroups: true });
  assert.deepEqual(m.dependsOn, ["exchange"]); // entra's deps carried, minus the pair itself
});

test("Yuma: complementary lane keys are unioned, m365 wins a conflict", () => {
  const out = mergeEntraIntoM365([
    sys({ systemKey: "m365", config: { offboard: { blockSignIn: true, removeAllGroups: true, removeLicense: true } } }),
    sys({ systemKey: "entra", config: { offboard: { disableAccount: true, removeAllGroups: false, revokeMfaSessions: true, resetPassword: { captureForDeliveryInM365Step: true } } } }),
  ]);
  assert.deepEqual((out[0].config as { offboard: unknown }).offboard, {
    disableAccount: true, removeAllGroups: true, revokeMfaSessions: true, resetPassword: { captureForDeliveryInM365Step: true }, blockSignIn: true, removeLicense: true,
  });
});

test("approval, evidence and destructive intent survive if either side had them", () => {
  const [m] = mergeEntraIntoM365([
    sys({ systemKey: "m365", config: { intent: { offboard: "disable" } } }),
    sys({ systemKey: "entra", requiresApproval: true, captureEvidence: true, secretNames: ["entra-extra"], config: { intent: { offboard: "destructive" }, requiresApproval: { offboard: true } } }),
  ]);
  assert.equal(m.requiresApproval, true);
  assert.equal(m.captureEvidence, true);
  assert.deepEqual(m.secretNames, ["m365-admin", "entra-extra"]);
  assert.equal((m.config as { intent: { offboard: string } }).intent.offboard, "destructive");
  assert.deepEqual((m.config as { requiresApproval: unknown }).requiresApproval, { offboard: true });
});

test("a step that waited on entra now waits on m365 (shared and per-lane deps)", () => {
  const out = mergeEntraIntoM365([
    sys({ systemKey: "m365" }), sys({ systemKey: "entra" }),
    sys({ systemKey: "notify", dependsOn: ["entra", "exchange"], config: { dependsOn: { offboard: ["entra"] } } }),
  ]);
  const n = out.find((s) => s.systemKey === "notify")!;
  assert.deepEqual(n.dependsOn, ["m365", "exchange"]);
  assert.deepEqual((n.config as { dependsOn: unknown }).dependsOn, { offboard: ["m365"] });
});

test("entra alone, or m365 alone, is left exactly as it was", () => {
  const onlyEntra = [sys({ systemKey: "entra" })];
  assert.equal(mergeEntraIntoM365(onlyEntra), onlyEntra);
  const onlyM365 = [sys({ systemKey: "m365" })];
  assert.equal(mergeEntraIntoM365(onlyM365), onlyM365);
});

test("only systems in THIS lane merge: entra offboard-only doesn't touch an m365 onboard", () => {
  const systems = [sys({ systemKey: "m365" }), sys({ systemKey: "entra", onboardWhen: "never" })];
  assert.deepEqual(planCase(systems, "onboard", {}).map((j) => j.systemKey), ["m365"]);
  const off = planCase(systems, "offboard", {});
  assert.deepEqual(off.map((j) => j.systemKey), ["m365"]);
});
