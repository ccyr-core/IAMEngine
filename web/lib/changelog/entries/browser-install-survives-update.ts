import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "browser-install-survives-update",
  date: "2026-09-14",
  time: "10:00",
  title: "\"Install browser automation\" is no longer lost when an update lands at the same moment",
  items: [
    "The request is sent to the runner exactly once — the app hands it over and immediately forgets it. The runner acted on it only after checking for a pending self-update or restart, and both of those relaunch the process and never come back. A click that arrived on the same check-in as an update was handed over, never acted on, and gone: no install, no error, and the Agents page stuck on \"installed but this runner still does not report it\"",
    "The request is now taken before either of those, matching how the runner already handles a new access token for the same reason",
    "Ordering alone was not enough. The install runs in the background and dies with the process, so an update seconds later still killed it mid-download. The request is now written to disk when it arrives and picked up again at the next start — so a restart, a self-update or the stall watchdog interrupting a 45-minute download costs time, not the request",
    "It keeps resuming until the sidecar is actually installed, then clears itself. An explicit click still overrides the per-host opt-out, and the reason for a genuine failure is still reported on the runner's row",
    "Runner 1.124.0 needs deploy",
  ],
};
