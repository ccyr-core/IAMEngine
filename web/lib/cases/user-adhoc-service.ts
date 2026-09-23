// Dispatch FR #88's "Correct user" / "Remove user" from an onboard case: one ad-hoc job per directory
// system the onboard actually ran (a line that succeeded — something exists there to fix or remove).
//
// Remove is destructive by definition: every job is approval-gated with an evidence snapshot, so nothing
// is deleted until an operator approves each step on the case, and it's only offered while the onboard
// is recent (REMOVE_USER_WINDOW_DAYS). Each remove job carries every identity the case has given the
// user (knownIdentities), so a correction that half-landed can't make it look in the wrong place.
//
// Correct is not gated — it renames, it doesn't delete. The case payload is NOT changed at dispatch:
// the corrected values ride on the jobs (config) under one correctionId, stamped with the identity the
// account had before, and commitUserCorrectionIfComplete writes them to the case only once every job of
// that correction has succeeded. A failed correction therefore leaves the case describing the account
// as it still is, and can simply be re-run.
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { insertStepSequence } from "../jobs/adhoc";
import {
  REMOVE_USER_KEY, CORRECT_USER_KEY, REMOVE_USER_WINDOW_DAYS, USER_ADHOC_SYSTEM_KEYS, CORRECT_USER_SYSTEM_KEYS,
  identityOf, correctedPayload, knownIdentities, type UserCorrection,
} from "../jobs/user-adhoc";
import { adUpnFor } from "../profiles/ad-domain";
import { jobResultEnvelope } from "../jobs/job-result";
import { resolveActor, type ActorInput } from "../auth/actor";

export type UserAdhocResult =
  | { ok: true; jobs: { id: string; systemKey: string }[] }
  | { ok: false; status: number; error: string };

const RAN = "succeeded";
const IN_FLIGHT = ["pending", "dispatched", "running"];
// The mailbox lives in Exchange Online whenever the onboard ran an M365/Entra line — the m365 step's
// licence creates it, and the plan may have no separate exchange line at all.
const CLOUD_MAILBOX_SOURCES = ["m365", "entra"];

const configOf = (j: { request: unknown }) => ((((j.request ?? {}) as { config?: unknown }).config ?? {}) as Record<string, unknown>);

export async function dispatchUserAdhoc(
  db: PrismaClient,
  caseId: string,
  kind: "remove" | "correct",
  actor: ActorInput,
  correction?: UserCorrection,
): Promise<UserAdhocResult> {
  const c = await db.caseRequest.findUnique({
    where: { id: caseId },
    select: {
      action: true, createdAt: true, dryRun: true, clientId: true, payload: true,
      client: { select: { backbone: true, identity: true } },
      jobs: { select: { id: true, systemKey: true, status: true, request: true, result: true } },
    },
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
  // A cloud mailbox made by the m365 step (no exchange line on the plan) still has to move its primary
  // address — Graph can't set it. Queue the Exchange Online correction off the M365 line's credential;
  // the mailbox may legitimately not exist (an unlicensed user), which that job reports as a warning.
  let mailboxOptional = false;
  if (kind === "correct" && correction?.email && !sources.has("exchange-correct-user")) {
    const m = c.jobs.find((j) => CLOUD_MAILBOX_SOURCES.includes(j.systemKey) && j.status === RAN);
    if (m) { sources.set("exchange-correct-user", m); mailboxOptional = true; }
  }
  if (sources.size === 0) return { ok: false, status: 409, error: "no directory step on this case has run yet, so there's no account to act on" };
  // ANY correct/remove job in flight blocks both kinds: a remove queued behind a pending correction would
  // race the rename, and two corrections at once would each commit over the other.
  const busy = c.jobs.find((j) => USER_ADHOC_SYSTEM_KEYS.includes(j.systemKey) && IN_FLIGHT.includes(j.status));
  if (busy) return { ok: false, status: 409, error: `a ${busy.systemKey} step is already waiting or running on this case — let it finish (or approve it) first` };

  const payload = (c.payload ?? {}) as Record<string, unknown>;
  const previousIdentity = identityOf(payload);
  const correctionId = kind === "correct" ? randomUUID() : null;
  const destructive = kind === "remove";
  const known = knownIdentities(payload, c.jobs);
  // AD-standalone (FR #83/#107): AD has its own UPN suffix, separate from the mail domain. The AD lane
  // gets the corrected local part on THAT suffix — never the cloud domain — and looks the account up by
  // the AD UPN the onboard gave it (the same derivation the claim applies to on-prem lanes).
  const adNow = c.client ? adUpnFor(payload, c.client) : null;

  const configFor = (targetKey: string): Record<string, unknown> => {
    // A remove may find the account under an EARLIER identity of this case — a name that could since
    // belong to someone else. The runner deletes such a fallback match only when it is provably this
    // onboard's account: the Entra object id the m365 step reported, else created no earlier than the case.
    if (kind === "remove") {
      const cfg: Record<string, unknown> = { knownIdentities: known, caseCreatedAt: c.createdAt.toISOString() };
      if (targetKey === "m365-remove-user") {
        const src = sources.get(targetKey);
        const res = (src ? jobResultEnvelope(src.result) : null) as Record<string, unknown> | null;
        const id = res?.UserId ?? res?.userId;
        if (typeof id === "string" && id) cfg.entraUserId = id;
      }
      return cfg;
    }
    const newSam = correction?.email ? identityOf(correctedPayload(payload, correction)).SamAccountName : null;
    const cfg: Record<string, unknown> = {
      correctionId, correction, firstName: correction?.firstName, lastName: correction?.lastName, displayName: correction?.displayName,
      newUpn: correction?.email, newSam, previousIdentity, knownIdentities: known,
    };
    if (targetKey === "ad-correct-user" && adNow) {
      const adSuffix = adNow.upn.split("@")[1];
      cfg.previousIdentity = { ...previousIdentity, UserPrincipalName: adNow.upn };
      if (correction?.email) cfg.newUpn = `${correction.email.split("@")[0]}@${adSuffix}`;
    }
    if (targetKey === "exchange-correct-user" && mailboxOptional) cfg.mailboxOptional = true;
    return cfg;
  };
  // The Exchange correction runs on the central runner against Exchange Online only: a hybrid mailbox is
  // AD's to readdress (the AD step does it), so it must not try to open the client's on-prem session.
  const secretsFor = (targetKey: string, names: string[]) => (targetKey === "exchange-correct-user" ? names.filter((n) => n !== "exchange-onprem") : names);

  const jobs = await db.$transaction(async (tx) => {
    const out: { id: string; systemKey: string }[] = [];
    for (const [targetKey, src] of sources) {
      const srcReq = (src.request ?? {}) as { secretNames?: string[] };
      const sequence = await insertStepSequence(tx, caseId);
      const j = await tx.job.create({
        data: {
          caseRequestId: caseId, systemKey: targetKey, mode: "api", sequence, status: "pending", singleRun: true,
          request: {
            secretNames: secretsFor(targetKey, srcReq.secretNames ?? []), config: configFor(targetKey), dependsOn: [],
            requiresApproval: destructive, captureEvidence: destructive, intent: destructive ? "destructive" : null,
          } as Prisma.InputJsonValue,
        },
        select: { id: true, systemKey: true },
      });
      out.push(j);
    }
    return out;
  });

  const who = resolveActor(actor);
  await db.auditLog.create({
    data: {
      actor: who.actor, userId: who.userId, caseRequestId: caseId, clientId: c.clientId,
      action: kind === "remove" ? "case.user.remove_requested" : "case.user.correct_dispatched",
      detail: { jobs: jobs.map((j) => j.systemKey), ...(kind === "correct" ? { correction, previousIdentity, correctionId } : {}) } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, jobs };
}

// Called from the job-result path when a correction job succeeds: once EVERY job of its correction
// (same correctionId) has succeeded, write the corrected identity to the case payload. Until then the
// case keeps the identity the account still has somewhere. Returns whether it committed.
export async function commitUserCorrectionIfComplete(db: PrismaClient, jobId: string): Promise<boolean> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { caseRequestId: true, systemKey: true, request: true } });
  if (!job || !CORRECT_USER_SYSTEM_KEYS.includes(job.systemKey)) return false;
  const cfg = configOf(job);
  const correctionId = typeof cfg.correctionId === "string" ? cfg.correctionId : null;
  const correction = (cfg.correction ?? null) as UserCorrection | null;
  if (!correctionId || !correction) return false;
  const c = await db.caseRequest.findUnique({
    where: { id: job.caseRequestId },
    select: { clientId: true, payload: true, jobs: { select: { id: true, systemKey: true, status: true, request: true } } },
  });
  if (!c) return false;
  const batch = c.jobs.filter((j) => CORRECT_USER_SYSTEM_KEYS.includes(j.systemKey) && configOf(j).correctionId === correctionId);
  if (batch.length === 0 || batch.some((j) => j.status !== RAN)) return false;
  const next = correctedPayload((c.payload ?? {}) as Record<string, unknown>, correction);
  await db.caseRequest.update({ where: { id: job.caseRequestId }, data: { payload: next as Prisma.InputJsonValue } });
  await db.auditLog.create({
    data: {
      actor: "system:user-correction", caseRequestId: job.caseRequestId, clientId: c.clientId, action: "case.user.correct_committed",
      detail: { correctionId, correction, jobs: batch.map((j) => j.systemKey) } as Prisma.InputJsonValue,
    },
  });
  return true;
}
