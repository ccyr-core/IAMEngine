import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "sharepoint-site-groups",
  date: "2026-09-23",
  time: "10:30",
  title: "SharePoint: site groups are cleaned up on offboard and mirrored on onboard (runner 1.127.0)",
  items: [
    "The SharePoint system now runs as a real step: on offboard it removes the leaver from every SharePoint site group they're in (a site's Owners, Members, Visitors and custom groups), on every site in the tenant",
    "On an onboard that says \"mirror <user>\", it adds the new user to the same site groups as the reference user; groups excluded by the client's mirror policy are skipped",
    "Sites the person never used are skipped quickly, and the tenant's site list is reused for 6 hours rather than re-read on every case; one site failing is reported and the rest still run",
    "It uses the client's existing Microsoft 365 app and certificate (the same Sites.FullControl.All access the OneDrive hand-off already needs)",
  ],
};
