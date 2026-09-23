// Per-case offboard ACTION choices (FR #128): for one case, choose what actually happens to the account
// on the systems clients ask to vary — delete vs suspend in Google, delete vs convert the mailbox in
// Exchange, remove vs archive the Spanning licence. Stored in the payload as `offboardActions` through
// the case fields route (operator-sourced, so a ServiceNow re-pull keeps it) and applied to the planned
// offboard jobs here, AFTER the client's own config — the case's choice wins.
//
// Every "delete"/"remove" choice makes its step DESTRUCTIVE: approval-gated with an evidence snapshot,
// the same guarantees a client-level destructive system gets. The "keep" choices only undo a client
// default that would otherwise delete, and add no gate.
import type { PlannedJob } from "../orchestrator";

export type OffboardActions = {
  "google-workspace"?: "suspend" | "delete";
  exchange?: "convert" | "delete";
  spanning?: "archive" | "remove";
};

export const OFFBOARD_ACTION_CHOICES = {
  "google-workspace": { keep: "suspend", destroy: "delete" },
  exchange: { keep: "convert", destroy: "delete" },
  spanning: { keep: "archive", destroy: "remove" },
} as const;

type SystemWithChoice = keyof typeof OFFBOARD_ACTION_CHOICES;

// Only known systems and known values survive — anything else in the payload is ignored.
export function readOffboardActions(payload: Record<string, unknown>): OffboardActions {
  const raw = payload.offboardActions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, choice] of Object.entries(OFFBOARD_ACTION_CHOICES)) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === choice.keep || v === choice.destroy) out[key] = v as string;
  }
  return out as OffboardActions;
}

const cfgOf = (j: PlannedJob) => ({ ...((j.config as Record<string, unknown> | null) ?? {}) });
const destructive = (j: PlannedJob, config: Record<string, unknown>): PlannedJob =>
  ({ ...j, config, intent: "destructive", requiresApproval: j.mode === "api" ? true : j.requiresApproval, captureEvidence: true });

export function withOffboardActions(jobs: PlannedJob[], payload: Record<string, unknown>): PlannedJob[] {
  const a = readOffboardActions(payload);
  if (Object.keys(a).length === 0) return jobs;
  const deleteMailbox = a.exchange === "delete";
  return jobs.map((j) => {
    const key = j.systemKey as SystemWithChoice | string;
    const cfg = cfgOf(j);
    if (key === "google-workspace" && a["google-workspace"]) {
      if (a["google-workspace"] === "delete") return destructive(j, { ...cfg, deleteUser: true });
      return { ...j, config: { ...cfg, deleteUser: false } };
    }
    if (key === "exchange" && a.exchange) {
      // Not converting leaves a user mailbox; once the licence comes off, Exchange purges it after its
      // 30-day grace — that IS the delete. Keep: convert to shared.
      if (deleteMailbox) return destructive(j, { ...cfg, convertToShared: false });
      return { ...j, config: { ...cfg, convertToShared: true } };
    }
    if ((key === "m365" || key === "entra") && deleteMailbox) {
      // The licence step normally refuses to strip a licence off an unconverted mailbox (that's what
      // protects the mail). On a case that chose to delete the mailbox, that removal is the point.
      const rl = cfg.removeLicense;
      const base = rl && typeof rl === "object" && !Array.isArray(rl) ? (rl as Record<string, unknown>) : {};
      return destructive(j, { ...cfg, removeLicense: { ...base, allowWithoutConvert: true } });
    }
    if (key === "spanning" && a.spanning) {
      if (a.spanning === "remove") {
        const { swapLicense: _s, ...rest } = cfg;
        return destructive(j, { ...rest, removeLicense: true });
      }
      const { removeLicense: _r, unassign: _u, ...rest } = cfg;
      return { ...j, config: { ...rest, swapLicense: { to: "Archive" } } };
    }
    return j;
  });
}
