import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "exchange-role-gap-named",
  date: "2026-09-22",
  time: "18:00",
  title: "Exchange: a missing Exchange role is named, and caught by Test connections (runner 1.127.0)",
  items: [
    "When an Exchange step fails with a cmdlet \"not recognized\" (e.g. Get-MailboxStatistics) after Exchange Online connected, the step now says the app registration's Exchange role doesn't grant it and how to fix it - instead of trying to install a module that is already installed",
    "Test connections now checks every Exchange Online cmdlet the onboard and offboard steps use, and fails with the list of missing ones - so a tenant whose app holds too narrow a role shows up on the client page, not halfway through an offboard",
    "Test connections no longer reports the Exchange Administrator role as confirmed just because the connection succeeded",
  ],
};
