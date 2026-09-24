import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "sharepoint-pnp-out-of-process",
  date: "2026-09-24",
  time: "16:00",
  title: "A SharePoint hand-off can no longer crash the runner (runner 1.142.0)",
  items: [
    "A runner died with a stack overflow inside PnP.PowerShell while connecting to SharePoint to make a leaver's manager site-collection admin on their OneDrive. That kind of crash cannot be caught, so it took the whole runner down mid-job, and the offboard would crash the next runner that picked it up",
    "The SharePoint/OneDrive grant now runs in a separate, short-lived PowerShell process that loads only PnP. If PnP crashes or hangs there, the runner keeps running and the case shows a warning that the grant did not happen, with what to do",
    "The certificate is passed to that process privately, never on its command line, and a grant that takes more than 3 minutes is stopped instead of holding up the job",
  ],
};
