// ServiceNow assignee mirror (FR #0000045): who each case's ticket is ASSIGNED TO in ServiceNow,
// shown in the Cases list's "Assigned to" column. The assignment is made in ServiceNow after the
// ticket is imported — the intake poller imports tickets precisely because they're unassigned — so it
// can't be captured at import; it has to be re-read. Driven by runner heartbeats like the procurement
// watch (no cron infra), throttled in-process to one sweep per SWEEP_EVERY_MS.
//
// Which cases: every live (not trashed) case with a ServiceNow number that is still OPEN, plus any
// case never checked at all — the latter is the one-time backfill for completed cases, after which a
// completed case keeps the assignee it closed with. Least-recently-checked first, BATCH per sweep, so
// a backlog drains across sweeps without one sweep making a burst of ServiceNow calls. One batched
// `numberIN…` query per 50 tickets (fetchTaskStates), never one call per case.
//
// Never throws — a ServiceNow outage or an unconfigured env just means the next sweep retries.
import type { PrismaClient } from "@prisma/client";
import { snConfigFromEnv } from "@/lib/servicenow/gateway";
import { assertConfig } from "@/lib/servicenow/http";
import { fetchTaskStates } from "@/lib/servicenow/task-state";

const SWEEP_EVERY_MS = 5 * 60_000;
const BATCH = 200; // 4 ServiceNow calls at 50 per chunk

let lastSweepAt = 0;

type Deps = {
  fetchStates?: typeof fetchTaskStates;
  now?: Date;
};

export type AssigneeSweepResult = { checked: number; changed: number; notFound: number };

// One sweep, unthrottled. Throws only when ServiceNow isn't configured (the caller decides whether to
// surface that); a failed ServiceNow read propagates too, leaving every checkedAt untouched.
export async function sweepAssigneesOnce(db: PrismaClient, deps: Deps = {}): Promise<AssigneeSweepResult> {
  const config = snConfigFromEnv();
  assertConfig(config);
  const fetchStates = deps.fetchStates ?? fetchTaskStates;
  const now = deps.now ?? new Date();

  const cases = await db.caseRequest.findMany({
    where: {
      deletedAt: null,
      serviceNowCaseNumber: { not: null },
      OR: [{ status: { not: "completed" } }, { snAssigneeCheckedAt: null }],
    },
    orderBy: [{ snAssigneeCheckedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    take: BATCH,
    select: { id: true, serviceNowCaseNumber: true, snAssignedTo: true, snAssignedToEmail: true, snAssigneeCheckedAt: true },
  });
  const res: AssigneeSweepResult = { checked: cases.length, changed: 0, notFound: 0 };
  if (cases.length === 0) return res;

  const states = await fetchStates(config, cases.map((c) => c.serviceNowCaseNumber!));

  for (const c of cases) {
    const s = states.get(c.serviceNowCaseNumber!);
    if (!s) {
      // Not in ServiceNow (or not a record-number shape). Keep whatever we last knew, but still stamp
      // the check so this case rotates to the back instead of blocking the batch forever.
      res.notFound++;
      await db.caseRequest.update({ where: { id: c.id }, data: { snAssigneeCheckedAt: now } });
      continue;
    }
    const changed = s.assignedTo !== c.snAssignedTo || s.assignedToEmail !== c.snAssignedToEmail;
    await db.caseRequest.update({
      where: { id: c.id },
      data: { snAssignedTo: s.assignedTo, snAssignedToEmail: s.assignedToEmail, snAssigneeCheckedAt: now },
    });
    if (!changed) continue;
    res.changed++;
    // Audit a REassignment, not the first read — the backfill would otherwise write a row per case.
    if (c.snAssigneeCheckedAt) {
      await db.auditLog.create({
        data: {
          actor: "system:assignee-sweep",
          action: "case.sn_assignee_changed",
          caseRequestId: c.id,
          detail: { number: c.serviceNowCaseNumber, from: c.snAssignedToEmail ?? c.snAssignedTo, to: s.assignedToEmail ?? s.assignedTo },
        },
      });
    }
  }
  return res;
}

// Heartbeat entry point: throttled, and swallows everything.
export async function sweepServiceNowAssignees(db: PrismaClient): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = now;
  await sweepAssigneesOnce(db).catch(() => {});
}
