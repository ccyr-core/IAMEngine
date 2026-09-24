import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "password-reset-lets-entra-answer",
  date: "2026-09-22",
  time: "14:00",
  title: "A cloud password reset is now attempted for AD-synced users instead of refused on an assumption",
  items: [
    "Generating a password from the Microsoft 365 line of a case refused outright for any AD-synced user, on the assumption that the client has no password write-back. Clients that DO have it were sent to Active Directory for no reason (FR #0000113)",
    "It is now attempted, and Microsoft decides. Where write-back is enabled the reset simply works, and the case records that this client has it — a fact the old behaviour assumed it could never learn",
    "Where it is not enabled, Microsoft refuses in its own words and the case says so, pointing at the Active Directory line exactly as before. Nothing is changed in the tenant by the attempt",
    "Any other failure on a synced user now reports its own error rather than being labelled a write-back problem. Saying which of these happened is the point: the old message named a cause it had never checked",
    "The alternative — reading the tenant's write-back flag directly — needs a Graph permission no client's app registration currently holds, so it would have meant a consent change across every client before it worked anywhere",
    "Deploy runner 1.130.0",
  ],
};
