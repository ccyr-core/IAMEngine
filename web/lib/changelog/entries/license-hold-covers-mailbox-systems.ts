import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "license-hold-covers-mailbox-systems",
  date: "2026-09-15",
  time: "20:00",
  title: "An onboarding with no licence seat no longer runs the steps that need one",
  items: [
    "When there are no free licence seats the new account is created unlicensed, the step warns, and an operator either picks a different licence or orders one. The steps that depend on that licence are meant to wait — but only Mimecast and Spanning ever did (FR #0000133)",
    "Exchange, Teams and SharePoint carried on regardless. An unlicensed account has no mailbox, so mailbox settings, shared-mailbox access, distribution groups and Teams or OneDrive setup were all being attempted against something that does not exist yet",
    "Those three now wait too, and say what they are waiting for. As soon as the licence is assigned and the M365 step re-runs, they release on their own",
    "Steps that do not need a licence are deliberately left alone — an AD account, a laptop and a Zoom seat are all fine to create while the licence is still being ordered",
  ],
};
