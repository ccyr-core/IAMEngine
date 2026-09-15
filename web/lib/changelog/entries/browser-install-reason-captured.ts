import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "browser-install-reason-captured",
  date: "2026-09-15",
  time: "11:00",
  title: "A failed browser install now reports the actual reason, not \"gave no output\"",
  items: [
    "Last week's change was supposed to make a failed install say why. It reported \"the install job finished without a usable sidecar and gave no output\" instead — every time, whatever went wrong",
    "The reason was being collected and then dropped. The install runs as a background job, and the code read back only the job's return value; the messages explaining the failure travel on separate channels that were never read. The one value it did read was the job's own true/false result, which was then discarded for being false",
    "So the runner had the npm error, the missing Node, the unreachable download — and reported none of them. The fix meant to stop the reason being thrown away threw it away one step further down",
    "It now reads the job's own warning, progress and error channels, including the case where the installer crashes outright, and reports the last few lines of what it actually said",
    "The fallback message for a job that genuinely says nothing no longer sends anyone to runner.log, which cannot contain it — on a Windows host there is no such log at all. It gives the command to run on the host instead",
    "Runner 1.125.0 needs deploy",
  ],
};
