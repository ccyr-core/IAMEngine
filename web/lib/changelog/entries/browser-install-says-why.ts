import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "browser-install-says-why",
  date: "2026-09-10",
  time: "22:00",
  title: "A browser-automation install that fails now says why, on the agent's own row",
  items: [
    "Installing browser automation showed \"installing…\" and then, whatever happened, went quiet. The runner did know what went wrong — it just never told anyone: the install runs as a background job, and the job's output, including the actual reason, was discarded when it finished",
    "So a failed install looked exactly like a slow one. Two of them failed that way on the central runner, in July and August, with 21 browser steps queued behind them and nobody able to see why",
    "The runner now reports the reason on its next check-in, the same way it already reports a failed migration, and the Agents page shows it on that runner's row — the npm error and its output, a missing Node, an unreachable download, whatever it actually was",
    "A correction to yesterday's change: the warning after a long silence fired at 30 minutes, which is too soon. A cold install is three downloads in sequence, each allowed 15 minutes, so it can legitimately run for the best part of an hour. The \"still installing\" message now says that, and the warning waits 50 minutes — and it is only a fallback, since a real failure now reports itself immediately",
    "Reporting the browser capability clears any recorded failure: the runner saying the sidecar works outranks a reason it did not, earlier",
    "Runner 1.121.0 needs deploy",
  ],
};
