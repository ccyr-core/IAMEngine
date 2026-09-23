import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "per-case-offboard-actions",
  date: "2026-09-23",
  time: "10:00",
  title: "Offboards: choose delete or keep per case for Google, the mailbox and Spanning (runner 1.127.0)",
  items: [
    "An offboarding case has a new Offboard actions section: for this one case, choose to suspend or delete the Google account, convert the mailbox to shared or let it be deleted, and archive or remove the Spanning licence",
    "Each shows what the case will do now, read the same way the offboard step reads the client's setting, so the client's usual setting is the starting point. Only the choices you change are saved; the rest stay on the client's setting",
    "Letting the mailbox be deleted only applies where the client's licence step already removes the licence; a client set to keep the licence keeps it",
    "After saving, the section says whether the case was actually re-planned, and names the error if the re-plan failed",
    "Choosing to delete or remove makes that step need approval, with the user's current state saved first; steps that already ran can't be changed",
    "A deleted Google account can be restored for 20 days. If a Drive transfer was requested, the Google delete is held and the user is suspended, because deleting before Google finishes the transfer would lose the files",
  ],
};
