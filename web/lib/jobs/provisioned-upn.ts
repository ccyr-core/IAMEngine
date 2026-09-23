// The account the m365/entra step ACTUALLY created for a new hire (FR #118, PR #111 review).
//
// The payload's userPrincipalName is only the PRIMARY candidate. When it already belongs to someone
// else, the m365 executor moves on to the next fallback pattern and creates the hire there — and says
// so in its result (`Upn`). A downstream step that acts on the new hire by reading the payload would act
// on the primary, i.e. on the OTHER person: the sharepoint mirror would have added a stranger to the
// reference user's SharePoint site groups. So the app hands the created account on at claim time, as
// payload.provisionedUpn — the same sibling-result hand-off as writebackEmail.
import { jobResultEnvelope } from "./job-result";

// `accepted`: the operator accepted this step's failure (acceptedKeysFor), as the dependency gate reads it.
export type SiblingResult = { systemKey: string; status: string; result: unknown; mode?: string; accepted?: boolean };

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

// A cloud-account job that WILL report the created account: an api m365/entra job that hasn't finished.
// "Finished" is read the way the dependency gate reads it (runner-logic blockingJobs). A job that
// FAILED and wasn't accepted is unfinished: that is how a DECISION_NEEDED username collision
// looks, and the re-run after the decision reports the account. Nothing else ever will. A manual
// checklist item (including one planned manual because its secrets are marked not needed) never
// reports an account, and a scim job is born succeeded with no result. A finished job has already
// reported one or never will (done by hand, skipped, accepted failure, or succeeded without a Upn).
const willReportAccount = (s: SiblingResult): boolean =>
  (s.systemKey === "m365" || s.systemKey === "entra") &&
  (s.mode ?? "api") === "api" &&
  s.status !== "succeeded" && s.status !== "skipped" && s.status !== "manual" &&
  !s.accepted;

// What the sharepoint ONBOARD job is told about the new hire's account (PR #111 reviews 2 and 3).
// `awaitCloudAccount` is true only while a job that will report the account is still unfinished. The
// runner then refuses and says it is waiting, instead of using the payload's primary username, which
// can belong to an existing person (for example while m365 waits on a username-collision decision).
// When no job will ever report it, the runner falls to the username an operator set on the case, then
// the primary if it is the sole candidate. It never refuses forever over something the operator
// can't fix.
export function sharepointOnboardFields(siblings: SiblingResult[]): { provisionedUpn: string | null; awaitCloudAccount: boolean } {
  const provisionedUpn = provisionedUpnFrom(siblings);
  return { provisionedUpn, awaitCloudAccount: !provisionedUpn && siblings.some(willReportAccount) };
}
