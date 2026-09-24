import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { sweepAssigneesOnce } from "./assignee-sweep";
import type { fetchTaskStates } from "@/lib/servicenow/task-state";

type Row = { id: string; serviceNowCaseNumber: string; snAssignedTo: string | null; snAssignedToEmail: string | null; snAssigneeCheckedAt: Date | null };

beforeEach(() => {
  process.env.SN_INSTANCE_URL = "https://example.service-now.com";
  process.env.SN_USER = "u";
  process.env.SN_PASSWORD = "p";
});

// Stub Prisma client — just the surface the sweep touches, capturing writes and audit rows.
function stubDb(rows: Row[]) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const audits: Array<Record<string, unknown>> = [];
  let findArgs: Record<string, unknown> | undefined;
  const db = {
    caseRequest: {
      findMany: async (args: Record<string, unknown>) => { findArgs = args; return rows; },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => { updates.push({ id: args.where.id, data: args.data }); return {}; },
    },
    auditLog: { create: async (args: { data: Record<string, unknown> }) => { audits.push(args.data); return {}; } },
  } as unknown as PrismaClient;
  return { db, updates, audits, findArgs: () => findArgs };
}

function states(map: Record<string, { assignedTo: string | null; assignedToEmail: string | null }>): typeof fetchTaskStates {
  return (async () => new Map(Object.entries(map).map(([number, a]) => [number, { number, state: "Work in Progress", sysClassName: "", ...a }]))) as typeof fetchTaskStates;
}

const now = new Date("2026-09-22T20:00:00Z");

test("the first read stores the assignee without an audit row (that would be one per backfilled case)", async () => {
  const { db, updates, audits } = stubDb([{ id: "c1", serviceNowCaseNumber: "UM0029001", snAssignedTo: null, snAssignedToEmail: null, snAssigneeCheckedAt: null }]);
  const r = await sweepAssigneesOnce(db, { now, fetchStates: states({ UM0029001: { assignedTo: "Jane Doe", assignedToEmail: "jane@core.tech" } }) });
  assert.deepEqual(r, { checked: 1, changed: 1, notFound: 0 });
  assert.deepEqual(updates[0], { id: "c1", data: { snAssignedTo: "Jane Doe", snAssignedToEmail: "jane@core.tech", snAssigneeCheckedAt: now } });
  assert.equal(audits.length, 0);
});

test("a reassignment in ServiceNow is mirrored and audited", async () => {
  const { db, updates, audits } = stubDb([{ id: "c1", serviceNowCaseNumber: "UM0029001", snAssignedTo: "Jane Doe", snAssignedToEmail: "jane@core.tech", snAssigneeCheckedAt: new Date("2026-09-22T19:00:00Z") }]);
  await sweepAssigneesOnce(db, { now, fetchStates: states({ UM0029001: { assignedTo: "Sam Roe", assignedToEmail: "sam@core.tech" } }) });
  assert.equal(updates[0].data.snAssignedToEmail, "sam@core.tech");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "case.sn_assignee_changed");
  assert.deepEqual(audits[0].detail, { number: "UM0029001", from: "jane@core.tech", to: "sam@core.tech" });
});

test("an unassigned-again ticket clears the assignee (the column must not keep a stale name)", async () => {
  const { db, updates } = stubDb([{ id: "c1", serviceNowCaseNumber: "UM0029001", snAssignedTo: "Jane Doe", snAssignedToEmail: "jane@core.tech", snAssigneeCheckedAt: new Date("2026-09-22T19:00:00Z") }]);
  await sweepAssigneesOnce(db, { now, fetchStates: states({ UM0029001: { assignedTo: null, assignedToEmail: null } }) });
  assert.equal(updates[0].data.snAssignedTo, null);
  assert.equal(updates[0].data.snAssignedToEmail, null);
});

test("an unchanged assignee only bumps the check time, with no audit row", async () => {
  const { db, updates, audits } = stubDb([{ id: "c1", serviceNowCaseNumber: "UM0029001", snAssignedTo: "Jane Doe", snAssignedToEmail: "jane@core.tech", snAssigneeCheckedAt: new Date("2026-09-22T19:00:00Z") }]);
  const r = await sweepAssigneesOnce(db, { now, fetchStates: states({ UM0029001: { assignedTo: "Jane Doe", assignedToEmail: "jane@core.tech" } }) });
  assert.equal(r.changed, 0);
  assert.equal(updates[0].data.snAssigneeCheckedAt, now);
  assert.equal(audits.length, 0);
});

test("a ticket ServiceNow doesn't return keeps its last assignee but still rotates to the back", async () => {
  const { db, updates } = stubDb([{ id: "c1", serviceNowCaseNumber: "UM0029001", snAssignedTo: "Jane Doe", snAssignedToEmail: "jane@core.tech", snAssigneeCheckedAt: null }]);
  const r = await sweepAssigneesOnce(db, { now, fetchStates: states({}) });
  assert.equal(r.notFound, 1);
  assert.deepEqual(updates[0], { id: "c1", data: { snAssigneeCheckedAt: now } });
});

test("open cases, plus completed ones never checked, least-recently-checked first", async () => {
  const { db, findArgs } = stubDb([]);
  await sweepAssigneesOnce(db, { now, fetchStates: states({}) });
  const args = findArgs() as { where: Record<string, unknown>; orderBy: unknown[] };
  assert.deepEqual(args.where.OR, [{ status: { not: "completed" } }, { snAssigneeCheckedAt: null }]);
  assert.equal(args.where.deletedAt, null);
  assert.deepEqual(args.orderBy[0], { snAssigneeCheckedAt: { sort: "asc", nulls: "first" } });
});

test("a ServiceNow failure writes nothing, so every case is retried next sweep", async () => {
  const { db, updates } = stubDb([{ id: "c1", serviceNowCaseNumber: "UM0029001", snAssignedTo: null, snAssignedToEmail: null, snAssigneeCheckedAt: null }]);
  const failing = (async () => { throw new Error("SN down"); }) as unknown as typeof fetchTaskStates;
  await assert.rejects(sweepAssigneesOnce(db, { now, fetchStates: failing }), /SN down/);
  assert.equal(updates.length, 0);
});
