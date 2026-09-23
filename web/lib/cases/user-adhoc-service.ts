// Dispatch FR #88's "Correct user" / "Remove user" from an onboard case: one ad-hoc job per directory
// system the onboard actually ran (a line that succeeded — something exists there to fix or remove).
//
// Remove is destructive by definition: every job is approval-gated with an evidence snapshot, so nothing
// is deleted until an operator approves each step on the case, and it's only offered while the onboard
// is recent (REMOVE_USER_WINDOW_DAYS). Correct is not gated — it renames, it doesn't delete — and it
// also updates the case's own identity fields (operator-sourced, so a ServiceNow re-pull keeps them),
// stamping the OLD identity on each job so the runner can find the account by what it was.
import type { PrismaClient, Prisma } from "@prisma/client";
import { insertStepSequence } from "../jobs/adhoc";
import { REMOVE_USER_KEY, CORRECT_USER_KEY, REMOVE_USER_WINDOW_DAYS, USER_ADHOC_SYSTEM_KEYS, type UserCorrection } from "../jobs/user-adhoc";
import { resolveActor, type ActorInput } from "../auth/actor";

export type UserAdhocResult =
  | { ok: true; jobs: { id: string; systemKey: string }[] }
  | { ok: false; status: number; error: string };

const RAN = "succeeded";
const IN_FLIGHT = ["pending", "dispatched", "running"];

export async function dispatchUserAdhoc(
  db: PrismaClient,
  caseId: string,
  kind: "remove" | "correct",
  actor: ActorInput,
  correction?: UserCorrection,
): Promise<UserAdhocResult> {
  const c = await db.caseRequest.findUnique({
    where: { id: caseId },
    select: { action: true, createdAt: true, dryRun: true, clientId: true, payload: true, jobs: { select: { id: true, systemKey: true, status: true, request: true } } },
  });
  if (!c) return { ok: false, status: 404, error: "case not found" };
  if (c.action !== "onboard") return { ok: false, status: 422, error: "only an onboard case can correct or remove the user it created" };
  if (c.dryRun) return { ok: false, status: 409, error: "this case is in dry-run mode — nothing was created, so there's nothing to correct or remove" };
  if (kind === "remove" && Date.now() - c.createdAt.getTime() > REMOVE_USER_WINDOW_DAYS * 86_400_000) {
    return { ok: false, status: 409, error: `"Remove user" is only offered for ${REMOVE_USER_WINDOW_DAYS} days after the onboard — offboard this user instead` };
  }
  const map = kind === "remove" ? REMOVE_USER_KEY : CORRECT_USER_KEY;
  // One job per TARGET key (m365 and entra share one), from the first line of that system that ran.
  const sources = new Map<string, (typeof c.jobs)[number]>();
  for (const j of c.jobs) {
    const target = map[j.systemKey];
    if (!target || j.status !== RAN || sources.has(target)) continue;
    // A correction with no email change has nothing for Exchange to do.
    if (target === "exchange-correct-user" && !correction?.email) continue;
    sources.set(target, j);
  }
  if (sources.size === 0) return { ok: false, status: 409, error: "no directory step on this case has run yet, so there's no account to act on" };
  // ANY correct/remove job in flight blocks both kinds: a remove queued behind a pending correction would
  // look the account up by the corrected (not-yet-applied) name, miss it, and report nothing to delete.
  const busy = c.jobs.find((j) => USER_ADHOC_SYSTEM_KEYS.includes(j.systemKey) && IN_FLIGHT.includes(j.status));
  if (busy) return { ok: false, status: 409, error: `a ${busy.systemKey} step is already waiting or running on this case — let it finish (or approve it) first` };

  const payload = (c.payload ?? {}) as Record<string, unknown>;
  const previousIdentity = {
    SamAccountName: payload.samAccountName ?? payload.SamAccountName ?? null,
    UserPrincipalName: payload.userPrincipalName ?? payload.UserPrincipalName ?? null,
    DisplayName: payload.displayName ?? payload.DisplayName ?? null,
    workEmail: payload.workEmail ?? null,
  };
  const correctionConfig = correction
    ? { firstName: correction.firstName, lastName: correction.lastName, displayName: correction.displayName, newUpn: correction.email, previousIdentity }
    : {};
  const destructive = kind === "remove";

  const jobs = await db.$transaction(async (tx) => {
    const out: { id: string; systemKey: string }[] = [];
    for (const [target, src] of sources) {
      const srcReq = (src.request ?? {}) as { secretNames?: string[] };
      const sequence = await insertStepSequence(tx, caseId);
      const j = await tx.job.create({
        data: {
          caseRequestId: caseId, systemKey: target, mode: "api", sequence, status: "pending", singleRun: true,
          request: {
            secretNames: srcReq.secretNames ?? [], config: kind === "correct" ? correctionConfig : {}, dependsOn: [],
            requiresApproval: destructive, captureEvidence: destructive, intent: destructive ? "destructive" : null,
          } as Prisma.InputJsonValue,
        },
        select: { id: true, systemKey: true },
      });
      out.push(j);
    }
    if (kind === "correct" && correction) {
      // The case now describes the corrected person. Marked operator-sourced so a re-pull keeps it.
      const next: Record<string, unknown> = { ...payload };
      const touched: string[] = [];
      const set = (k: string, v: unknown) => { next[k] = v; touched.push(k); };
      if (correction.firstName) set("firstName", correction.firstName);
      if (correction.lastName) set("lastName", correction.lastName);
      if (correction.displayName) set("displayName", correction.displayName);
      if (correction.email) {
        set("userPrincipalName", correction.email); set("workEmail", correction.email);
        const local = correction.email.split("@")[0];
        set("mailNickname", local);
        // The username follows along only when it was the old email's local part (the same rule the AD step applies).
        const oldLocal = String(previousIdentity.UserPrincipalName ?? "").split("@")[0];
        if (oldLocal && String(previousIdentity.SamAccountName ?? "").toLowerCase() === oldLocal.toLowerCase()) set("samAccountName", local.slice(0, 20));
      }
      next.fieldSource = { ...((payload.fieldSource ?? {}) as Record<string, string>), ...Object.fromEntries(touched.map((k) => [k, "operator"])) };
      await tx.caseRequest.update({ where: { id: caseId }, data: { payload: next as Prisma.InputJsonValue } });
    }
    return out;
  });

  const who = resolveActor(actor);
  await db.auditLog.create({
    data: {
      actor: who.actor, userId: who.userId, caseRequestId: caseId, clientId: c.clientId,
      action: kind === "remove" ? "case.user.remove_requested" : "case.user.correct_dispatched",
      detail: { jobs: jobs.map((j) => j.systemKey), ...(kind === "correct" ? { correction, previousIdentity } : {}) } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, jobs };
}
