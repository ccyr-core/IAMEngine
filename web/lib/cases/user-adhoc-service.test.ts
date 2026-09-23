import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { dispatchUserAdhoc } from "./user-adhoc-service";
import { checkCorrection } from "../jobs/user-adhoc";

type J = { id: string; systemKey: string; status: string; request: unknown };
function stubDb(opts: { action?: string; ageDays?: number; jobs?: J[]; payload?: Record<string, unknown> } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const tx = {
    job: {
      findFirst: async () => null,
      aggregate: async () => ({ _max: { sequence: 10 } }),
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      create: async (args: { data: Record<string, unknown> }) => { created.push(args.data); return { id: `j${created.length}`, systemKey: args.data.systemKey }; },
    },
    caseRequest: { update: async (args: { data: Record<string, unknown> }) => { updates.push(args.data); return {}; } },
  };
  const db = {
    caseRequest: {
      findUnique: async () => ({
        action: opts.action ?? "onboard", createdAt: new Date(Date.now() - (opts.ageDays ?? 1) * 86_400_000), dryRun: false, clientId: "c1",
        payload: opts.payload ?? { samAccountName: "jsmyth", userPrincipalName: "jsmyth@acme.com", displayName: "John Smyth" },
        jobs: opts.jobs ?? [
          { id: "a", systemKey: "active-directory", status: "succeeded", request: { secretNames: ["ad-dc"] } },
          { id: "m", systemKey: "m365", status: "succeeded", request: { secretNames: ["m365-admin"] } },
          { id: "e", systemKey: "entra", status: "succeeded", request: { secretNames: ["m365-admin"] } },
          { id: "x", systemKey: "exchange", status: "succeeded", request: { secretNames: ["m365-admin"] } },
          { id: "g", systemKey: "google-workspace", status: "pending", request: {} },
        ],
      }),
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    auditLog: { create: async () => ({}) },
  } as unknown as PrismaClient;
  return { db, created, updates };
}

test("remove: one approval-gated, evidence-capturing job per system that RAN (m365/entra share one)", async () => {
  const { db, created } = stubDb();
  const r = await dispatchUserAdhoc(db, "case", "remove", "test");
  assert.equal(r.ok, true);
  assert.deepEqual(created.map((c) => c.systemKey), ["ad-remove-user", "m365-remove-user"]); // google never ran; exchange has no remove
  for (const c of created) {
    const req = c.request as { requiresApproval: boolean; captureEvidence: boolean };
    assert.equal(req.requiresApproval, true);
    assert.equal(req.captureEvidence, true);
    assert.equal(c.singleRun, true);
  }
});

test("remove is refused past the window and on anything but an onboard", async () => {
  assert.deepEqual(await dispatchUserAdhoc(stubDb({ ageDays: 45 }).db, "case", "remove", "t"), { ok: false, status: 409, error: '"Remove user" is only offered for 30 days after the onboard — offboard this user instead' });
  const off = await dispatchUserAdhoc(stubDb({ action: "offboard" }).db, "case", "remove", "t");
  assert.equal(off.ok, false);
});

test("correct: jobs carry the previous identity; the case payload takes the corrected one", async () => {
  const { db, created, updates } = stubDb();
  const r = await dispatchUserAdhoc(db, "case", "correct", "t", { lastName: "Smith", email: "jsmith@acme.com" });
  assert.equal(r.ok, true);
  assert.deepEqual(created.map((c) => c.systemKey), ["ad-correct-user", "m365-correct-user", "exchange-correct-user"]);
  const cfg = (created[0].request as { config: Record<string, unknown> }).config;
  assert.equal(cfg.newUpn, "jsmith@acme.com");
  assert.deepEqual(cfg.previousIdentity, { SamAccountName: "jsmyth", UserPrincipalName: "jsmyth@acme.com", DisplayName: "John Smyth", workEmail: null });
  assert.equal((created[0].request as { requiresApproval: boolean }).requiresApproval, false);
  const p = updates[0].payload as Record<string, unknown>;
  assert.equal(p.userPrincipalName, "jsmith@acme.com");
  assert.equal(p.samAccountName, "jsmith"); // followed the old UPN's local part
  assert.equal((p.fieldSource as Record<string, string>).lastName, "operator");
});

test("a correction with no email change doesn't queue Exchange", async () => {
  const { db, created } = stubDb();
  await dispatchUserAdhoc(db, "case", "correct", "t", { firstName: "Jon" });
  assert.equal(created.some((c) => c.systemKey === "exchange-correct-user"), false);
});

test("any correct/remove step in flight blocks both kinds (a remove must never chase a pending rename)", async () => {
  const jobs: J[] = [
    { id: "a", systemKey: "active-directory", status: "succeeded", request: {} },
    { id: "p", systemKey: "ad-correct-user", status: "pending", request: {} },
  ];
  const r = await dispatchUserAdhoc(stubDb({ jobs }).db, "case", "remove", "t");
  assert.equal(r.ok, false);
  assert.equal((r as { status: number }).status, 409);
});

test("checkCorrection trims, requires something, and rejects a malformed email", () => {
  assert.deepEqual(checkCorrection({ firstName: " Jon ", email: "" }), { ok: true, value: { firstName: "Jon" } });
  assert.equal(checkCorrection({}).ok, false);
  assert.equal(checkCorrection({ email: "not-an-email" }).ok, false);
});
