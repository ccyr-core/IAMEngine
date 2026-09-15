import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "mfa-denial-hint-ranks-causes",
  date: "2026-09-15",
  time: "22:00",
  title: "The \"MFA methods not removed\" warning now says which cause to check, and stops suggesting a fix that cannot work",
  items: [
    "The warning listed two possible causes flatly and suggested re-running the step. Re-running cannot help: the runner signs in to a tenant once and reuses that sign-in, so the retry presents exactly the token that was just refused. Only restarting the runner gets a new one (FR #0000170)",
    "It also gave no sense of which cause is likelier. Across 553 offboards the warning appears on 36, spread over 9 clients — and 8 of those 9 have never once succeeded, which means the permission is genuinely missing for those tenants rather than the sign-in being stale",
    "The warning now says to check the grant first, and that a restart — not a re-run — is what clears the other case",
    "The warning itself was accurate. What was wrong was the advice underneath it",
    "Runner 1.126.0 needs deploy",
  ],
};
