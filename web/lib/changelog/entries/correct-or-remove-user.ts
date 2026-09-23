import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "correct-or-remove-user",
  date: "2026-09-23",
  time: "11:00",
  title: "Onboards: correct or remove the user the engine created (runner 1.127.0)",
  items: [
    "An onboarding case's Actions menu now has Correct user: fix a misspelled first/last/display name, or change the username and email, on every system the onboard set up (Active Directory, Microsoft 365, Exchange, Google). The old email is kept as an alias so mail to it still arrives. The case updates to match only once every system has taken the change; if one fails, the case keeps the old details and the correction can simply be run again",
    "A new email also moves the mailbox's primary address in Exchange Online, including for clients whose mailbox comes from the Microsoft 365 licence (no separate Exchange step). On AD-standalone clients with their own AD domain, AD keeps that domain: only the username part changes there",
    "Remove user permanently deletes the account from every system the onboard set up - for a hire that fell through. You type the user's email to confirm; it adds one step per system, and each needs approval before anything is deleted, with the user's groups saved first. It looks for the account under both the old and any corrected name, and a step that finds nothing to delete shows a warning instead of passing quietly",
    "Remove user is only offered for 30 days after the onboard; after that, offboard the user instead. Google keeps a deleted user restorable for 20 days (it can't be purged sooner); AD and Microsoft 365 deletes are permanent",
    "Users synced from AD are changed or removed in AD, and directory sync carries it to Microsoft 365",
  ],
};
