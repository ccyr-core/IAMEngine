import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "manager-resolved-by-email",
  date: "2026-09-15",
  time: "15:00",
  title: "The new hire's manager is matched by email, so a long name no longer loses the link",
  items: [
    "Onboarding passed the manager through as the name shown on the ticket. That field has a character limit in ServiceNow, so a long name arrives cut off — and the account lookup then finds nobody",
    "When that happened the step did not fail. It recorded a warning and carried on, so the onboarding finished with no manager set on the account and the case looked clean",
    "The ticket already carried the manager's real email address — it is looked up when the case is imported — and it was simply not the value being used",
    "The manager is now matched on that email, falling back to the name when the contact record has no address on file. Nothing changes for a manager whose name already matched (FR #0000131)",
  ],
};
