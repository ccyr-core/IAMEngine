// The account the m365/entra step ACTUALLY created for a new hire (FR #118, PR #111 review).
//
// The payload's userPrincipalName is only the PRIMARY candidate. When it already belongs to someone
// else, the m365 executor moves on to the next fallback pattern and creates the hire there — and says
// so in its result (`Upn`). A downstream step that acts on the new hire by reading the payload would act
// on the primary, i.e. on the OTHER person: the sharepoint mirror would have added a stranger to the
// reference user's SharePoint site groups. So the app hands the created account on at claim time, as
// payload.provisionedUpn — the same sibling-result hand-off as writebackEmail.
import { jobResultEnvelope } from "./job-result";

export type SiblingResult = { systemKey: string; status: string; result: unknown };

// The created account's UPN from the case's m365/entra jobs: a SUCCEEDED one whose result carries a
// UPN (PascalCase `Upn`, as the runner emits; lowercase tolerated). m365 wins over entra. null when no
// such result exists — the runner then refuses to guess between candidates rather than pick one.
export function provisionedUpnFrom(siblings: SiblingResult[]): string | null {
  const ordered = [...siblings].sort((a, b) => (a.systemKey === "m365" ? 0 : 1) - (b.systemKey === "m365" ? 0 : 1));
  for (const s of ordered) {
    if (s.status !== "succeeded" || (s.systemKey !== "m365" && s.systemKey !== "entra")) continue;
    const res = (jobResultEnvelope(s.result) ?? {}) as { Upn?: unknown; upn?: unknown };
    const upn = res.Upn ?? res.upn;
    if (typeof upn === "string" && upn.includes("@")) return upn.trim();
  }
  return null;
}
