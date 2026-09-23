import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "entra-merged-into-m365",
  date: "2026-09-23",
  time: "09:30",
  title: "Microsoft 365 and Entra run as one step",
  items: [
    "When a client has both Microsoft 365 and Entra on an onboard or offboard, the case now has one Microsoft 365 step doing both jobs' work - they were the same code, so every such offboard blocked sign-in, revoked sessions and removed groups twice",
    "Both systems' settings are kept: the merged step gets all of them (Microsoft 365's wins where they disagree), and any approval, evidence snapshot or destructive setting on either side still applies",
    "A licence the Microsoft 365 step used to leave for Entra is now removed by the merged step - it still runs only after Exchange has converted the mailbox",
    "Entra is no longer offered when adding a system; clients that only have Entra keep it and are unchanged, and cases already planned keep their steps",
  ],
};
