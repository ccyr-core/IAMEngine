import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { dispatchUserAdhoc, commitUserCorrectionIfComplete } from "./user-adhoc-service";
import { checkCorrection } from "../jobs/user-adhoc";

type J = { id: string; systemKey: string; status: string; request: unknown };
const DEFAULT_JOBS = (): J[] => [
  { id: "a", systemKey: "active-directory", status: "succeeded", request: { secretNames: ["ad-dc"] } },
  { id: "m", systemKey: "m365", status: "succeeded", request: { secretNames: ["m365-admin"] } },
  { id: "e", systemKey: "entra", status: "succeeded", request: { secretNames: ["m365-admin"] } },
  { id: "x", systemKey: "exchange", status: "succeeded", request: { secretNames: ["m365-admin"] } },
  { id: "g", systemKey: "google-workspace", status: "pending", request: {} },
];

// An in-memory case: dispatched jobs join the case's job list, so a later dispatch / commit sees them.
function stubDb(opts: { action?: string; ageDays?: number; jobs?: J[]; payload?: Record<string, unknown>; client?: { backbone: string | null; identity: unknown } } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const state = {
    payload: opts.payload ?? ({ samAccountName: "jsmyth", userPrincipalName: "jsmyth@acme.com", displayName: "John Smyth" } as Record<string, unknown>),
    jobs: opts.jobs ?? DEFAULT_JOBS(),
  };
  const updateCase = async (args: { data: { payload: Record<string, unknown> } }) => { updates.push(args.data); state.payload = args.data.payload; return {}; };
  const tx = {
    job: {
      findFirst: async () => null,
      aggregate: async () => ({ _max: { sequence: 10 } }),
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        const id = `j${created.length}`;
        state.jobs.push({ id, systemKey: String(args.data.systemKey), status: "pending", request: args.data.request });
        return { id, systemKey: args.data.systemKey };
      },
    },
    caseRequest: { update: updateCase },
  };
  const db = {
    caseRequest: {
      findUnique: async () => ({
        action: opts.action ?? "onboard", createdAt: new Date(Date.now() - (opts.ageDays ?? 1) * 86_400_000), dryRun: false, clientId: "c1",
        client: opts.client ?? { backbone: "ad_synced", identity: {} },
        payload: state.payload,
        jobs: state.jobs,
      }),
      update: updateCase,
    },
    job: { findUnique: async (args: { where: { id: string } }) => { const j = state.jobs.find((x) => x.id === args.where.id); return j ? { caseRequestId: "case", ...j } : null; } },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    auditLog: { create: async () => ({}) },
  } as unknown as PrismaClient;
  const finish = (systemKey: string, status: string) => { const j = state.jobs.find((x) => x.systemKey === systemKey && x.status === "pending")!; j.status = status; return j.id; };
  return { db, created, updates, state, finish };
}
const cfgOf = (c: Record<string, unknown>) => (c.request as { config: Record<string, unknown> }).config;

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

test("correct: jobs carry the previous AND the pending identity; the case payload is untouched at dispatch", async () => {
  const { db, created, updates, state } = stubDb();
  const r = await dispatchUserAdhoc(db, "case", "correct", "t", { lastName: "Smith", email: "jsmith@acme.com" });
  assert.equal(r.ok, true);
  assert.deepEqual(created.map((c) => c.systemKey), ["ad-correct-user", "m365-correct-user", "exchange-correct-user"]);
  const cfg = cfgOf(created[0]);
  assert.equal(cfg.newUpn, "jsmith@acme.com");
  assert.equal(cfg.newSam, "jsmith");
  assert.equal(typeof cfg.correctionId, "string");
  assert.deepEqual(cfg.correction, { lastName: "Smith", email: "jsmith@acme.com" });
  assert.deepEqual(cfg.previousIdentity, { SamAccountName: "jsmyth", UserPrincipalName: "jsmyth@acme.com", DisplayName: "John Smyth", workEmail: null });
  assert.equal((created[0].request as { requiresApproval: boolean }).requiresApproval, false);
  assert.equal(new Set(created.map((c) => cfgOf(c).correctionId)).size, 1, "one correction = one correctionId");
  // Review fix #1: nothing is written to the case until every system has taken the correction.
  assert.equal(updates.length, 0);
  assert.equal(state.payload.userPrincipalName, "jsmyth@acme.com");
});

test("the case takes the corrected identity only once EVERY job of that correction succeeded", async () => {
  const { db, updates, state, finish } = stubDb();
  await dispatchUserAdhoc(db, "case", "correct", "t", { lastName: "Smith", email: "jsmith@acme.com" });
  const ad = finish("ad-correct-user", "succeeded");
  assert.equal(await commitUserCorrectionIfComplete(db, ad), false);
  const m = finish("m365-correct-user", "failed");
  assert.equal(await commitUserCorrectionIfComplete(db, m), false);
  assert.equal(updates.length, 0, "a failed line keeps the case on the old identity");
  const x = finish("exchange-correct-user", "succeeded");
  assert.equal(await commitUserCorrectionIfComplete(db, x), false);
  // The operator re-runs the failed M365 line (same job, same config) and it succeeds.
  state.jobs.find((j) => j.id === m)!.status = "succeeded";
  assert.equal(await commitUserCorrectionIfComplete(db, m), true);
  const p = updates[0].payload as Record<string, unknown>;
  assert.equal(p.userPrincipalName, "jsmith@acme.com");
  assert.equal(p.lastName, "Smith");
  assert.equal(p.samAccountName, "jsmith"); // followed the old UPN's local part
  assert.equal((p.fieldSource as Record<string, string>).lastName, "operator");
});

test("a failed correction can be re-dispatched: it still looks the account up by the identity it had", async () => {
  const { db, created, finish } = stubDb();
  await dispatchUserAdhoc(db, "case", "correct", "t", { email: "jsmith@acme.com" });
  for (const k of ["ad-correct-user", "m365-correct-user", "exchange-correct-user"]) finish(k, "failed");
  const r = await dispatchUserAdhoc(db, "case", "correct", "t", { email: "jsmith@acme.com" });
  assert.equal(r.ok, true);
  const again = cfgOf(created[3]);
  assert.equal((again.previousIdentity as Record<string, unknown>).UserPrincipalName, "jsmyth@acme.com");
  assert.notEqual(again.correctionId, cfgOf(created[0]).correctionId);
});

test("remove after a half-applied correction searches BOTH the old and the corrected identity", async () => {
  const { db, created, finish } = stubDb();
  await dispatchUserAdhoc(db, "case", "correct", "t", { email: "jsmith@acme.com" });
  finish("ad-correct-user", "succeeded"); finish("m365-correct-user", "failed"); finish("exchange-correct-user", "succeeded");
  const r = await dispatchUserAdhoc(db, "case", "remove", "t");
  assert.equal(r.ok, true);
  const rm = created.filter((c) => String(c.systemKey).endsWith("-remove-user"));
  assert.equal(rm.length, 2);
  for (const c of rm) {
    const ids = cfgOf(c).knownIdentities as Array<{ SamAccountName: string | null; UserPrincipalName: string | null }>;
    assert.deepEqual(ids[0], { SamAccountName: "jsmyth", UserPrincipalName: "jsmyth@acme.com" }, "what the case says now comes first");
    assert.ok(ids.some((i) => i.UserPrincipalName === "jsmith@acme.com" && i.SamAccountName === "jsmith"), "the corrected identity is searched too");
  }
});

test("ad-standalone: the AD correction keeps AD's own UPN suffix, never the mail domain", async () => {
  const { db, created } = stubDb({
    client: { backbone: "ad_standalone", identity: { adDomain: "syee.local", usernamePatterns: ["{first}{last}"] } },
    payload: { firstName: "John", lastName: "Smyth", samAccountName: "johnsmyth", userPrincipalName: "johnsmyth@acme.com", displayName: "John Smyth" },
  });
  await dispatchUserAdhoc(db, "case", "correct", "t", { lastName: "Smith", email: "johnsmith@acme.com" });
  const ad = cfgOf(created.find((c) => c.systemKey === "ad-correct-user")!);
  assert.equal(ad.newUpn, "johnsmith@syee.local");
  assert.equal((ad.previousIdentity as Record<string, unknown>).UserPrincipalName, "johnsmyth@syee.local");
  const m = cfgOf(created.find((c) => c.systemKey === "m365-correct-user")!);
  assert.equal(m.newUpn, "johnsmith@acme.com", "the cloud lane keeps the mail domain");
});

test("hybrid: the Exchange correction never brokers the on-prem Exchange session", async () => {
  const jobs = DEFAULT_JOBS();
  jobs[3] = { id: "x", systemKey: "exchange", status: "succeeded", request: { secretNames: ["m365-admin", "exchange-onprem"] } };
  const { db, created } = stubDb({ jobs });
  await dispatchUserAdhoc(db, "case", "correct", "t", { email: "jsmith@acme.com" });
  const x = created.find((c) => c.systemKey === "exchange-correct-user")!;
  assert.deepEqual((x.request as { secretNames: string[] }).secretNames, ["m365-admin"]);
});

test("a cloud client whose mailbox came from the m365 step (no exchange line) still gets the address change", async () => {
  const jobs: J[] = [{ id: "m", systemKey: "m365", status: "succeeded", request: { secretNames: ["m365-admin"] } }];
  const { db, created } = stubDb({ jobs });
  await dispatchUserAdhoc(db, "case", "correct", "t", { email: "jsmith@acme.com" });
  assert.deepEqual(created.map((c) => c.systemKey), ["m365-correct-user", "exchange-correct-user"]);
  const x = created[1];
  assert.deepEqual((x.request as { secretNames: string[] }).secretNames, ["m365-admin"]);
  assert.equal(cfgOf(x).mailboxOptional, true);
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
