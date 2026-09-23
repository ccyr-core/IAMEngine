// FR #88 — ad-hoc "Correct user" / "Remove user" on an onboard case. Like the password resets these ride
// the Job table without being case work (see adhoc.ts): dispatched on demand, never planned, invisible to
// case status. Each maps a planned directory line to the executor that corrects/removes on that system.
export const REMOVE_USER_KEY: Record<string, string> = {
  "active-directory": "ad-remove-user",
  m365: "m365-remove-user",
  entra: "m365-remove-user", // same module/tenant as m365
  "google-workspace": "google-remove-user",
};

export const CORRECT_USER_KEY: Record<string, string> = {
  "active-directory": "ad-correct-user",
  m365: "m365-correct-user",
  entra: "m365-correct-user",
  exchange: "exchange-correct-user", // the mailbox's primary address is Exchange's to change
  "google-workspace": "google-correct-user",
};

export const USER_ADHOC_SYSTEM_KEYS = [...new Set([...Object.values(REMOVE_USER_KEY), ...Object.values(CORRECT_USER_KEY)])];

// The on-prem ones (routed to the client's own agent, run on the AD module, ad-dc optional).
export const AD_USER_ADHOC_KEYS = ["ad-remove-user", "ad-correct-user"];

// "Remove user" is only offered while the onboard is recent: it exists to undo a hire that fell
// through, not as a general delete button for long-lived accounts.
export const REMOVE_USER_WINDOW_DAYS = 30;

// The identity fields a correction may change, validated before anything is dispatched.
export type UserCorrection = { firstName?: string; lastName?: string; displayName?: string; email?: string };

export function checkCorrection(input: unknown): { ok: true; value: UserCorrection } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "nothing to correct" };
  const o = input as Record<string, unknown>;
  const out: UserCorrection = {};
  for (const k of ["firstName", "lastName", "displayName", "email"] as const) {
    const v = typeof o[k] === "string" ? (o[k] as string).trim() : "";
    if (!v) continue;
    if (v.length > 256) return { ok: false, error: `${k} is too long` };
    out[k] = v;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) return { ok: false, error: "the new email doesn't look like an email address" };
  if (Object.keys(out).length === 0) return { ok: false, error: "enter at least one corrected value" };
  return { ok: true, value: out };
}

// ── Identity bookkeeping for a correction (review fix: the case must not run ahead of the systems) ──
// A correction is only COMMITTED to the case payload once every job it queued has succeeded. Until then
// the case keeps describing the account as it was, and the pending names/email ride on the jobs'
// config — so a failed correction can be re-run (the old identity is still the case's), and a later
// Remove searches both the old and the corrected identity instead of chasing one that was never applied.

export type AdIdentity = { SamAccountName: string | null; UserPrincipalName: string | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// The identity fields a correction reads off (and stamps back onto) the case payload.
export function identityOf(payload: Record<string, unknown>) {
  return {
    SamAccountName: str(payload.samAccountName ?? payload.SamAccountName),
    UserPrincipalName: str(payload.userPrincipalName ?? payload.UserPrincipalName),
    DisplayName: str(payload.displayName ?? payload.DisplayName),
    workEmail: str(payload.workEmail),
  };
}

// The case payload once `correction` has landed everywhere. The username follows the email only when it
// was the old email's local part (the same rule the AD step applies). Marked operator-sourced so a
// ServiceNow re-pull keeps it.
export function correctedPayload(payload: Record<string, unknown>, correction: UserCorrection): Record<string, unknown> {
  const prev = identityOf(payload);
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
    const oldLocal = String(prev.UserPrincipalName ?? "").split("@")[0];
    if (oldLocal && String(prev.SamAccountName ?? "").toLowerCase() === oldLocal.toLowerCase()) set("samAccountName", local.slice(0, 20));
  }
  next.fieldSource = { ...((payload.fieldSource ?? {}) as Record<string, string>), ...Object.fromEntries(touched.map((k) => [k, "operator"])) };
  return next;
}

// Every identity this case has given the user: the payload's own, plus each correction job's previous
// and target identity — whether or not that correction finished. The current payload's comes FIRST, so
// an executor that stops at the first match prefers what the case says now.
export function knownIdentities(payload: Record<string, unknown>, jobs: Array<{ systemKey: string; request: unknown }>): AdIdentity[] {
  const out: AdIdentity[] = [];
  const add = (sam: unknown, upn: unknown) => {
    const s = str(sam); const u = str(upn);
    if (!s && !u) return;
    if (out.some((o) => (o.SamAccountName ?? "").toLowerCase() === (s ?? "").toLowerCase() && (o.UserPrincipalName ?? "").toLowerCase() === (u ?? "").toLowerCase())) return;
    out.push({ SamAccountName: s, UserPrincipalName: u });
  };
  const cur = identityOf(payload);
  add(cur.SamAccountName, cur.UserPrincipalName);
  if (cur.workEmail && cur.workEmail.toLowerCase() !== (cur.UserPrincipalName ?? "").toLowerCase()) add(null, cur.workEmail);
  for (const j of jobs) {
    if (!CORRECT_USER_SYSTEM_KEYS.includes(j.systemKey)) continue;
    const cfg = (((j.request ?? {}) as { config?: unknown }).config ?? {}) as Record<string, unknown>;
    const prev = (cfg.previousIdentity ?? {}) as Record<string, unknown>;
    add(prev.SamAccountName, prev.UserPrincipalName);
    add(cfg.newSam, cfg.newUpn);
  }
  return out;
}

export const CORRECT_USER_SYSTEM_KEYS = [...new Set(Object.values(CORRECT_USER_KEY))];
