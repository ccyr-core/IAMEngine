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
